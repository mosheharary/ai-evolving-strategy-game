# Echoes of the Frontier

A browser-based, turn-based 3D strategy game. You lead **the last surviving civilization** on
a procedurally generated hex frontier, competing and negotiating with five AI factions that
have distinct personalities and long memories. The world reacts to what you do: forests
fall and regrow, pollution runs down rivers, deposits are exhausted, droughts and plagues
follow from real conditions, and razed towns are remembered by their descendants.

- **Deterministic, server-authoritative engine.** Every mechanic is a pure TypeScript
  function, so any campaign can be replayed bit-for-bit.
- **TypeSafe System One** makes strategic decisions for AI factions, choosing only from legal
  options and filtered through confidence thresholds.
- **Google Gemini** writes the chronicle (structured, facts-only narrative) and paints event
  and portrait art.
- **Fully playable without any API keys.** Local mock providers and a deterministic fallback
  policy take over automatically.
- Stack: Next.js 16 + React 19 + Three.js (react-three-fiber) · Fastify 5 · PostgreSQL 17
  (Prisma 7) · Redis 7 (BullMQ) · pnpm monorepo.

---

## Quick start

Requirements: Docker with Compose v2.

```bash
git clone https://github.com/mosheharary/ai-evolving-strategy-game.git
cd ai-evolving-strategy-game
cp .env.example .env   # optional: add GOOGLE_API_KEY / TYPESAFE_API_KEY for live AI
docker compose up --build
```

Then open **http://localhost:3000**.

Compose starts PostgreSQL and Redis, runs the database migrations and seeds the demo campaign
(the one-shot `migrate` service), and then starts the API, the worker and the web app, each
with a health check. The first game is playable immediately, with no keys and no
configuration.

```bash
docker compose down        # stop (keeps your games)
docker compose down -v     # stop AND delete volumes: pgdata (games), redisdata (queues/cache), assets (generated images)
```

## Configuring AI keys

AI keys are optional. Copy the example file and fill in whichever keys you have:

```bash
cp .env.example .env
```

```dotenv
GOOGLE_API_KEY=...        # Gemini narrative + images (GEMINI_API_KEY is accepted as a fallback)
TYPESAFE_API_KEY=...      # TypeSafe System One strategic decisions
TYPESAFE_MODEL=jev-latest # alias; pin e.g. jev-1.13.0 for reproducible deployments
AI_MODE=auto
```

Then restart with `docker compose up --build`. Compose passes `.env` **only** to the `api` and
`worker` containers. Keys never reach the browser, the database or the logs (see
[docs/security.md](docs/security.md)).

Other useful settings (all are listed in [`.env.example`](.env.example)):

- model names: `GOOGLE_TEXT_MODEL`, `GOOGLE_IMAGE_MODEL`, `GOOGLE_IMAGE_HERO_MODEL`;
- cost budgets: `MAX_AI_REQUESTS_PER_TURN`, `MAX_AI_REQUESTS_PER_GAME`,
  `MAX_AI_REQUESTS_PER_USER_PER_DAY`, `MAX_IMAGES_PER_TURN`, `MAX_IMAGES_PER_GAME`;
- decision thresholds: `AI_EXECUTE_THRESHOLD` (default 0.8) and `AI_CONSERVATIVE_THRESHOLD`
  (0.55);
- Gemini context caching: `GOOGLE_CONTEXT_CACHE` (off by default).

### Running without keys

`AI_MODE` is resolved separately for each provider:

| `AI_MODE` | Behaviour |
|---|---|
| `auto` (default) | Each provider runs **live** if its key is present, otherwise **mock** |
| `live` | Same as `auto`; a provider with a missing key degrades to mock |
| `mock` | No external calls. Realistic probabilistic faction decisions, template prose, procedural SVG art |
| `deterministic` | No external calls. Faction decisions always use the engine's deterministic fallback policy |

Whatever the mode, a failing provider (timeout, 429, outage, budget exhausted) falls back
automatically and the game continues. The **AI** indicator in the top bar shows each
provider's status.

---

## Local development without Docker

Requirements: Node.js ≥ 22, pnpm 11 (`corepack enable`), and Docker (only for Postgres and
Redis).

```bash
pnpm install
pnpm db:generate                     # generate the Prisma client (packages/database/src/generated)
docker compose up -d postgres redis  # infrastructure only, on 127.0.0.1:5432 / :6379
pnpm db:migrate                      # prisma migrate deploy
pnpm seed                            # demo campaign (idempotent)
```

The defaults already point at `localhost` Postgres and Redis. The API and worker `dev`
scripts load the repository-root `.env` automatically (`--env-file-if-exists`), and a
relative `ASSET_STORAGE_DIR` is resolved against the repository root, so both processes
share one asset directory.

Run each app in its own terminal:

```bash
pnpm --filter @echoes/api dev      # Fastify API      → http://localhost:4000 (/health, /ready)
pnpm --filter @echoes/worker dev   # BullMQ worker    → health on :4100
pnpm --filter @echoes/web dev      # Next.js web app  → http://localhost:3000
```

The web dev server proxies `/api/*` and `/internal/*` to `API_INTERNAL_URL`
(default `http://localhost:4000`).

## Tests and quality checks

| Command | What it runs |
|---|---|
| `pnpm test` | Unit tests (Vitest `unit` project: `packages/*/test`, `apps/*/test`) |
| `pnpm test:integration` | Integration tests (`tests/integration`, `AI_MODE=mock`). **Requires Postgres and Redis** (`docker compose up -d postgres redis`, then `pnpm db:migrate`) |
| `pnpm test:all` | Both Vitest projects |
| `pnpm test:e2e` | Playwright end-to-end tests (`tests/e2e`) |
| `pnpm typecheck` | `tsc` in every workspace package |
| `pnpm lint` | ESLint (typescript-eslint) |
| `pnpm replay:verify` | `scripts/replay-verify.ts`: replays stored command logs (with stored AI decisions, no AI calls) and checks state hashes |

CI (`.github/workflows/ci.yml`) runs install, lint, typecheck, unit and integration tests,
build, and a Docker build, all with mock AI providers and no live credentials.

---

## Playing

Start a **New Game** (civilization name, difficulty Settler / Governor / Warlord, start
preference, optional seed) or click **Open Demo Campaign**. Your goal is to reach one of the
victories: Dominion, Prosperity, Scientific Ascension, Ecological Restoration, Diplomatic
Federation, or Legacy by turn 100. See [docs/game-design.md](docs/game-design.md) for all
rules.

### Controls

| Input | Action |
|---|---|
| `W A S D` / arrow keys | Pan the camera |
| `Q` / `E` | Rotate |
| `+` / `−` / mouse wheel | Zoom |
| Drag / right-drag | Pan / rotate |
| Click | Select; with a unit selected, move or attack |
| Right-click | Move selected unit / cancel |
| `Tab` / `Shift+Tab`, `N` | Cycle units |
| `F` | Focus selection |
| `B` / `R` / `T` / `H` | Build / Research / Diplomacy (Treaties) / History |
| `1`–`5` | Overlays: territory, resources, movement, danger, diplomacy |
| `Shift+Enter` | End turn |
| `Esc` | Close / cancel |
| `?` | Help |

Settings include shadows, reduced motion and high contrast.

### How saves work

- **Autosave** happens after every turn and after major events, major diplomacy and
  discoveries. The 3 most recent autosaves per campaign are kept.
- **Manual saves** can be created from the Saves panel. Saves belong to your browser session
  (an anonymous, signed cookie).
- **Integrity.** Each save stores a compact gzip snapshot with its schema version, app version,
  command sequence and state hash. The hash is verified on load. Older save versions are
  migrated step by step, and corrupt or future versions are rejected rather than loaded.
- **Loading** a save starts a new timeline from that state. History before it stays intact,
  and replay verification starts from the new root.
- **Live campaigns** persist continuously: every command is appended to an event-sourced log,
  and each turn writes a snapshot. Closing the browser or restarting containers loses nothing
  (unless you run `docker compose down -v`).

### Demo campaign

The seed script (`packages/database/prisma/seed.ts`, run automatically by the `migrate`
container, or manually with `pnpm seed`) creates **"Demo: The Hearthborn of the River Valley"**
(seed `demo-frontier-1`). It is advanced 12 turns through the real command log, with
deterministic AI, so the world already has history and faction behaviour. **Open Demo
Campaign** on the main menu copies it into your session (enabled while `DEMO_MODE=true`).

### Developer AI failure controls

Click the **AI** button in the top bar to open the developer panel (available while
`DEV_TOOLS_ENABLED=true`). From it you can:

- see provider status (online, degraded, offline or mock) and 24-hour telemetry: requests,
  failures, latency, tokens, decisions, fallbacks, images generated and recent errors;
- simulate failures with **Disable Gemini**, **Disable TypeSafe**, **Force rate limit (429)**
  and **Force timeout**, and watch the game continue on fallbacks;
- **Verify replay**: replay the campaign from its timeline root with stored AI decisions and
  confirm the state hash is identical.

The same controls exist as `GET/POST /internal/ai/faults`, `GET /internal/ai/telemetry`,
`GET /internal/games/:id/decisions` and `GET /internal/games/:id/replay-verify`. Set
`INTERNAL_TOKEN` to require an `x-internal-token` header, and set `DEV_TOOLS_ENABLED=false` in
production.

---

## Project structure

```
apps/
  web/            Next.js UI (app/, src/ui panels, src/three renderer, src/store, src/lib api + SSE)
  api/            Fastify API (routes, auth, GameService, SSE hub)
  worker/         BullMQ workers for Gemini narrative and image jobs
packages/
  shared/         SeededRandom, canonical JSON + sha256, small utilities
  game-types/     Domain types, Zod command schemas, AI decision contracts
  procedural-world/  Hex grid, noise, deterministic world generation
  game-engine/    Pure deterministic engine: content, systems, turn pipeline, replay, fog of war
  ai/             AIOrchestrator, Gemini + TypeSafe providers, local fallbacks, resilience, storage
  database/       Prisma schema + migrations, repositories, save codec, demo seed
  platform/       Env parsing, pino logger, Redis store/lock/pub-sub, BullMQ queues, AI wiring
tests/            Integration (tests/integration) and Playwright e2e (tests/e2e) tests
scripts/          Tooling such as replay-verify.ts
docs/             Architecture, AI, game design and security documentation
Dockerfile        Multi-stage build (targets: migrate, api, worker, web)
docker-compose.yml
```

## Documentation

- [Architecture](docs/architecture.md): system diagram, packages, turn pipeline, commands and
  concurrency, persistence, replay, SSE, the asset pipeline, rendering.
- [AI architecture](docs/ai-architecture.md): TypeSafe decisions, DecisionPolicy, Gemini text and
  images, prompt versioning, caching, retries, circuit breaker, budgets, AI memory.
- [Game design](docs/game-design.md): game loop, map generation, factions, economy, technologies,
  buildings, units, combat, diplomacy, events, evolution, quests, eras, victory, difficulty.
- [Security](docs/security.md): secrets, validation, authorization, rate limiting, CSRF,
  headers, fog of war, and a production hardening checklist.

## Repository notes

- Secrets are never committed: `.env` is gitignored; only `.env.example` (placeholders) is tracked.
- Generated files are not tracked (`node_modules`, `.next`, `dist`, the Prisma client in
  `packages/database/src/generated`, test reports, `data/`). Run `pnpm install && pnpm db:generate`
  after cloning for local development; the Docker build does this automatically.
- `prompt.md` is the original product specification this project was built against.
