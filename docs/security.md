# Security

This document describes how Echoes of the Frontier protects secrets, the authoritative game
state, and players' data. Every claim references the code that implements it. A
production-hardening checklist is at the end.

Related: [Architecture](architecture.md) · [AI architecture](ai-architecture.md)

---

## 1. Threat model in brief

| Asset | Threat | Primary controls |
|---|---|---|
| Provider API keys (Google, TypeSafe) | Leak via browser bundle, logs, DB, error messages | Server-only env, no client dependency on AI code, pino redaction, sanitised errors |
| Authoritative game state | Cheating (forged resources or outcomes), replay of commands, race conditions | Intent-only commands, Zod validation, engine validation, idempotency, lock, optimistic concurrency |
| Other players' games, saves and assets | IDOR (guessing ids) | Signed player cookie plus per-resource ownership checks that return 404 |
| AI spend | Abuse or runaway loops | Per-turn/game/user budgets, rate limits, circuit breaker, caching |
| Browser | XSS, clickjacking, CSRF | CSP, secure headers, `x-echoes-client` header plus Origin allowlist, SameSite cookies |
| Hidden information | Reading fog-of-war data | Server-side view projection (`projectForPlayer`) |

---

## 2. Secret handling

- **Where keys live.** `GOOGLE_API_KEY` (or the `GEMINI_API_KEY` fallback) and
  `TYPESAFE_API_KEY` are read only by `loadAIConfig` (`packages/ai/src/config.ts`) in the
  **api** and **worker** processes. `docker-compose.yml` passes `.env` (optional) to `api` and
  `worker` only; the `web` container gets no AI variables.
- **Never in the browser bundle.**
  - `apps/web` does not depend on `@echoes/ai`, `@echoes/database` or `@echoes/platform`.
  - It defines no `NEXT_PUBLIC_*` variables. The only server-side env it reads is
    `API_INTERNAL_URL` in `next.config.ts`, for the proxy rewrite.
  - The browser never contacts Google or TypeSafe; the CSP pins `connect-src 'self'`.
- **Never in the database.**
  - Keys are passed explicitly to the SDK constructors (`GoogleAIService`,
    `TypeSafeClient`) and held in memory.
  - `AIRequest` stores provider, model, prompt id and version, a cache-key *hash*, status,
    latency and token counts. It stores no keys and no prompt text.
- **Never in logs or responses.**
  - `describeAIConfig` reports only `googleKeyConfigured` and `typesafeKeyConfigured`
    booleans (used by `/ready` and startup logs).
  - `mapGoogleError` and `mapTypeSafeError` replace provider messages, which might echo
    request details, with short key-free summaries.
  - The TypeSafe SDK runs with `logLevel: "off"`.
  - The orchestrator strips `cacheKey` from its log lines.
- **Defensive log redaction.** `packages/platform/src/logger.ts` configures pino `redact` with
  censor `[redacted]` over these paths:

  ```
  apiKey, *.apiKey, *.*.apiKey, key, *.key,
  GOOGLE_API_KEY, GEMINI_API_KEY, TYPESAFE_API_KEY (and *.-prefixed variants),
  req.headers.authorization, req.headers.cookie, req.headers['x-goog-api-key'],
  req.headers['x-internal-token'], res.headers['set-cookie'],
  headers.authorization, headers.cookie, cookie, password, secret, *.secret
  ```

- **Files.**
  - `.env` is git-ignored and excluded from the Docker build context (`.dockerignore`
    contains `.env` and `.env.*`, except `!.env.example`).
  - `.env.example` contains no real values.
- **`COOKIE_SECRET`** signs the player cookie. The default is a development value, and in
  production `loadPlatformEnv` logs a warning if it is unchanged. **Set a strong random value
  in production** (see the checklist).

## 3. Server-side AI access only

All AI calls originate on the server:

- **TypeSafe** is called during END_TURN inside the API (`AIOrchestrator.decideFactions`).
- **Gemini** text and images are called only by the worker, from BullMQ jobs.

Browser-facing endpoints never forward user text to a model.

- `POST /api/games/:id/assets/request` and `POST /api/games/:id/narratives/faction` accept only
  identifiers (`factionId` / `techId` matching `^[a-z0-9_]+$`). The server checks they are
  valid (the faction exists, the tech is researched) and enqueues a job.
- Model inputs are **structured facts** extracted from the authoritative state
  (`narrative/facts.ts`) and **canonical prompts** (`images/prompts.ts`).
- The only player-chosen strings that can reach a prompt are the civilization name, validated
  by `NewGameRequest` (2–40 characters, `^[\p{L}\p{N} '\-]+$`), and engine-generated names.
- Model-suggested image detail is sanitised: newlines are removed, words requesting text or
  logos are stripped, and the length is capped at 300 characters.

The developer panel and `/internal/ai/*` expose **metrics only**: counts, latencies, token
totals, error kinds and fault flags. They never expose keys, prompts or provider internals.

## 4. Input validation

All client input is parsed with Zod **before** reaching the application layer.

- **Commands** (`packages/game-types/src/commands.ts`).
  - `CommandRequest` = `{ commandId: uuid, turn: int 1..10000 }` ∩ a discriminated union of 12
    command types.
  - Every payload schema is `.strict()`, so unknown keys are rejected.
  - Entity ids must match `^[a-z0-9_-]+$` (1–64 characters), tile indices are integers in
    0..100000, and gift amounts are 1..10000.
  - Resource, building and unit types are enums.
  - **The client sends intent only**, never resource values, stats or outcomes.
- **Identity is server-bound.** `gameId` comes from the route (validated
  `^g[0-9a-f]{16}$`) and `playerId` from the signed cookie. Neither is accepted from the body.
- **Other routes** (`apps/api/src/routes/games.ts`):
  - `NewGameRequest` is strict; difficulty and start preference are enums, and the seed matches
    `^[A-Za-z0-9-]*$` (≤ 40 characters).
  - Save names are 1–80 characters.
  - Save and asset ids must be UUIDs.
  - `EventsQuery` takes a non-negative integer.
  - Internal fault flags are a strict object of booleans.
- **Semantic validation.** The engine re-validates each command against the authoritative state
  (`executeCommand` → `CommandRejected`): ownership of the unit or settlement, moves left, range,
  war status, costs, placement rules, tech prerequisites, unit caps. Illegal commands return
  HTTP 422 with a player-friendly message, and the state is untouched (commands execute on a
  copy).
- **Malformed JSON** gets a 400. `ZodError` gets a 400 with at most 5 issue paths. Payloads that
  are too large get a 413.

## 5. Output validation of AI

AI output is treated as **untrusted input**:

- **Gemini text** is requested as structured JSON (`responseJsonSchema`). It is then parsed with
  `JSON.parse`, validated with the Zod schema (bounded lengths, enum tones), and checked
  semantically (event, quest and faction ids must match the facts). Failure triggers a retry and
  then a local fallback. Faction reactions are filtered to known factions before display.
- **TypeSafe answers** are validated with per-question Zod schemas and `StrategicAnswerSchema`,
  then checked against the offered legal candidates (`toStrategicAnswer`). They are validated
  again in the engine (`validateAnswer`) and then filtered by `DecisionPolicy` confidence
  thresholds. An AI answer can never select an action outside the legal candidate list.
- **Images** are stored with the MIME type returned by the provider (dimensions are read from
  PNG, JPEG or WebP headers) and served with a restrictive CSP (see the Authorization section).
- Narratives and images are presentation only and are **never** part of the authoritative state
  or its hash.

## 6. Authorization

- **Anonymous identity** (`apps/api/src/auth.ts`, `AnonymousCookieAuth`).
  - Every `/api/*` request resolves a player id from the `echoes_pid` cookie. The cookie is
    **signed** with `COOKIE_SECRET` and set with `httpOnly`, `SameSite=Lax`, `path=/` and a
    1-year max age.
  - `secure` is set when `NODE_ENV=production` and `ALLOWED_ORIGINS` contains no `http://`
    origin.
  - A missing, invalid or tampered cookie (failed signature or non-UUID value) creates a new
    anonymous player.
  - The `AuthProvider` interface allows swapping in a real identity provider without touching
    routes.
- **Per-player ownership** (`apps/api/src/services/gameService.ts`).
  - `GameService.live()` loads `Game.playerId` and returns **404** (not 403) when it differs
    from the requester, so other players' game ids cannot be enumerated.
  - Every game route goes through it: view, commands, end-turn, legal actions, events, history,
    summary, assets, narratives, save, and the SSE stream (authorised before the stream opens).
- **Saves.** Every `SaveRepository` query is scoped by `{ id, playerId }`: `get`, `loadState`,
  `delete` and `list`.
- **Assets.** `GET /api/assets/:assetId` serves bytes only if
  `isLinkedToPlayer(assetId, playerId)`, meaning the asset is linked to one of the requester's
  games. Otherwise it returns 404. Responses carry `cache-control: private`,
  `x-content-type-options: nosniff`, and
  `content-security-policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`, so even a
  malicious SVG cannot run script.
- **Storage paths.** `FileSystemAssetStorage` accepts only keys matching
  `^[a-z0-9][a-z0-9/_.-]{0,200}$` without `..`, and verifies that the resolved path stays inside
  the base directory.
- **Demo.** `POST /api/demo/claim` copies the seeded demo into the *requester's* account. It is
  available only when `DEMO_MODE=true`.

## 7. Rate limiting

`@fastify/rate-limit` is registered globally with a **Redis store** (`nameSpace: "echoes-rl:"`),
so limits hold across API instances. Requests are keyed by the player cookie when present, and
by IP otherwise (`trustProxy` is configurable through `TRUST_PROXY`).

| Scope | Limit per minute |
|---|---|
| Global default | 600 |
| `POST /api/games` (create) | 12 |
| `POST /api/games/:id/commands` | 240 |
| `POST /api/games/:id/end-turn` | 30 |
| `POST /api/games/:id/summary` | 6 |
| `POST /api/games/:id/assets/request` | 30 |
| `POST /api/games/:id/narratives/faction` | 20 |
| `GET /api/games/:id/stream` (SSE) | 30 |
| `POST /api/games/:id/save`, `POST /api/saves/:id/load` | 20 |
| `GET /api/assets/:assetId` | 300 |
| `POST /api/demo/claim` | 6 |
| `/health`, `/ready` | not rate-limited |

Exceeding a limit returns `429 { error: { code: "rate_limited" } }`. AI spend has independent
budgets (per turn, game, user and day, plus image limits), enforced in Redis by
`BudgetManager`. See [ai-architecture.md](ai-architecture.md#budgets-cost-control).

## 8. CSRF

`apps/api/src/server.ts` adds an `onRequest` hook for `/api/*` and `/internal/*`. It applies
to every **state-changing** method (POST, PUT, PATCH, DELETE):

1. The request must carry `x-echoes-client: web`. A custom header cannot be sent cross-site
   without a CORS preflight, and the API **never** answers CORS (no CORS plugin is registered).
2. If the browser sends an `Origin` header, it must be in `ALLOWED_ORIGINS` (comma-separated;
   compose sets `http://localhost:3000,http://127.0.0.1:3000`).
3. The player cookie is `SameSite=Lax`, so it is not sent on cross-site sub-requests.

Failures return `403 { error: { code: "csrf" } }`. The web client (`apps/web/src/lib/api.ts`)
sends `x-echoes-client: web` with `credentials: "same-origin"`.

## 9. Secure headers and the CSP

- **API** (`@fastify/helmet`):
  - CSP `default-src 'none'; img-src 'self' data:; frame-ancestors 'none'`;
  - `Cross-Origin-Resource-Policy: same-site`;
  - helmet's other defaults (HSTS, `X-Content-Type-Options`, `X-Frame-Options`, a
    referrer policy, ...).
  - Every response carries `x-request-id`. Incoming request ids are accepted only if they match
    `^[A-Za-z0-9-]{8,64}$`.
- **Web** (`apps/web/next.config.ts`, applied to every path):
  - `Content-Security-Policy`: `default-src 'self'`; `script-src 'self' 'unsafe-inline'`
    (plus `'unsafe-eval'` only in development); `style-src 'self' 'unsafe-inline'`;
    `img-src 'self' data: blob:`; `font-src 'self' data:`; `connect-src 'self'`;
    `worker-src 'self' blob:`; `frame-ancestors 'none'`; `base-uri 'self'`;
    `form-action 'self'`.
  - `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
    `X-Frame-Options: DENY`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
  - `poweredByHeader: false`.

## 10. Body size limits

The Fastify `bodyLimit` is **32 KiB** for all requests, and the custom JSON parser enforces
the same limit. Oversized requests get `413 "Request too large."`. An empty JSON body is
treated as `{}`.

## 11. SQL injection protection

All database access goes through Prisma 7's typed query builder
(`packages/database/src/repositories.ts`), which parameterises every value. There is no
`$queryRawUnsafe` or `$executeRawUnsafe`. The only raw query is the readiness probe
``$queryRaw`SELECT 1` `` (a tagged template with no interpolation). Identifiers that reach queries
are first validated by Zod (UUIDs, `^g[0-9a-f]{16}$`).

## 12. Internal endpoints

`registerInternalRoutes` (`apps/api/src/routes/internal.ts`) registers `/internal/*` **only**
when `DEV_TOOLS_ENABLED=true`. The routes are:

- `GET /internal/ai/telemetry`
- `GET` and `POST /internal/ai/faults`
- `GET /internal/games/:id/decisions`
- `GET /internal/games/:id/replay-verify`

If `INTERNAL_TOKEN` is set, every `/internal/*` request must carry
`x-internal-token: <token>`; otherwise the server answers 404 so the endpoints are not even
revealed. These endpoints are not scoped to a player. They are developer tooling and must be
disabled or token-protected in production. The CSRF hook still applies to their POSTs, and
fault changes are logged at `warn`.

## 13. Fog of war and view filtering

Clients receive `projectForPlayer(state)` (`packages/game-engine/src/view.ts`), never the raw
state:

- **Unexplored tiles** lose their resource, POI, owner, settlement, building, pollution and
  prosperity data.
- **Rival units, settlements and buildings** on unexplored tiles are removed.
- **Rival factions** keep only their memories about the player (last 10), and their research
  is reduced to the known list with no current project or progress.
- **The RNG state is zeroed**, so the client cannot predict future rolls.

The legal-actions endpoint operates on the same projected view.

## 14. Logging and data protection

- **Structured JSON logs** (pino) carry `service`, ISO timestamps and request ids. AI calls and
  turns also carry `correlationId`. Unexpected errors are logged server-side; players get a
  generic 500 with a `requestId` and **no stack traces or provider internals**.
- **Data minimisation.**
  - A `Player` row holds only a random UUID, `createdAt` and `lastSeenAt`. There are no names,
    emails or passwords.
  - Game content is player-chosen fiction (civilization and save names, validated).
- **Cascade deletes.** Deleting a `Player` cascades to games and saves. Deleting a `Game`
  cascades to its snapshots, commands, projections, decisions, narratives and asset links.
  Shared `GeneratedAsset` rows are deduplicated by prompt hash and contain no player data.
- **Integrity.**
  - Snapshots and saves store a `stateHash`; loading a save verifies it.
  - Replay must reproduce `Game.stateHash` exactly, or loading fails loudly.
  - Old saves are migrated step by step, and future or corrupt versions are rejected
    (`migrateSave`).
- **Network exposure (compose).** Postgres (`127.0.0.1:5432`), Redis (`127.0.0.1:6379`) and the
  API (`127.0.0.1:4000`) are bound to localhost only; the worker's health port is not
  published. Only `web` (`3000`) is reachable from the network.
- **Retention.** The server keeps the 12 most recent turn snapshots per game, the 3 most recent
  autosaves per game, and AI telemetry rows indefinitely. Prune `AIRequest` in long-running
  deployments.

---

## 15. Production hardening checklist

- [ ] Set a strong, random **`COOKIE_SECRET`** (≥ 32 bytes). The development default only
      triggers a warning.
- [ ] Serve over **HTTPS** behind a TLS-terminating proxy, and set `ALLOWED_ORIGINS` to the
      exact `https://` origin(s) so cookies get the `Secure` flag.
- [ ] Set **`DEV_TOOLS_ENABLED=false`**, or at minimum set a long random **`INTERNAL_TOKEN`**
      and keep `/internal/*` off the public proxy.
- [ ] Set `DEMO_MODE=false` unless you want public demo cloning.
- [ ] Change the default Postgres credentials (`echoes`/`echoes`), enable TLS to Postgres and
      Redis, and add a Redis password or ACL.
- [ ] Keep Postgres, Redis, API and worker on a private network; expose only the web
      front-end.
- [ ] Store `GOOGLE_API_KEY` and `TYPESAFE_API_KEY` in a secret manager, inject them only into
      api and worker, and rotate them periodically. Use separate keys per environment.
- [ ] Pin `TYPESAFE_MODEL` and the Gemini model names to concrete versions for reproducibility.
- [ ] Review the AI budgets (`MAX_AI_REQUESTS_*`, `MAX_IMAGES_*`) and set provider-side quota
      alerts.
- [ ] Set `TRUST_PROXY` correctly for your proxy chain, so rate-limit keys use the real client
      IP.
- [ ] Replace `FileSystemAssetStorage` with object storage (an S3 or GCS implementation of
      `AssetStorage`) with private ACLs if running more than one host.
- [ ] Replace `AnonymousCookieAuth` with a real `AuthProvider` if accounts are needed.
- [ ] Ship logs to a central store with access controls; keep `LOG_LEVEL=info` or stricter.
- [ ] Set retention for `AIRequest`, `AIDecision` and old saves.
- [ ] Run dependency audits and image scanning in CI (`.github/workflows/ci.yml`). Containers
      run as a non-root user via the multi-stage `Dockerfile`.
- [ ] Back up the `pgdata` volume; treat `redisdata` as rebuildable cache and queue state.
