# syntax=docker/dockerfile:1.7
# Multi-stage build for every service. Targets: api, worker, web, migrate.
#   - deterministic install (pnpm --frozen-lockfile)
#   - workspace TypeScript bundled at build time; runtime images carry production deps only
#   - non-root user, tini as PID 1 for proper signal handling, health endpoints

ARG NODE_IMAGE=node:22-alpine

# ---------------------------------------------------------------- base
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
WORKDIR /repo

# ---------------------------------------------------------------- deps (cached on manifests only)
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/game-types/package.json packages/game-types/
COPY packages/procedural-world/package.json packages/procedural-world/
COPY packages/game-engine/package.json packages/game-engine/
COPY packages/ai/package.json packages/ai/
COPY packages/database/package.json packages/database/
COPY packages/platform/package.json packages/platform/
COPY tests/package.json tests/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ---------------------------------------------------------------- build
FROM deps AS build
# Next.js resolves rewrites at build time: the web container proxies /api to the api service.
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
COPY . .
RUN pnpm --filter @echoes/database generate \
 && pnpm --filter @echoes/api build \
 && pnpm --filter @echoes/worker build \
 && pnpm --filter @echoes/web build
# Production-only dependency trees for the Node services (no dev deps, no workspace sources).
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm deploy --legacy --filter @echoes/api --prod /out/api \
 && pnpm deploy --legacy --filter @echoes/worker --prod /out/worker \
 && cp -r apps/api/dist /out/api/dist \
 && cp -r apps/worker/dist /out/worker/dist \
 && sh scripts/prune-runtime.sh /out/api \
 && sh scripts/prune-runtime.sh /out/worker

# ---------------------------------------------------------------- runtime base
FROM ${NODE_IMAGE} AS runtime
RUN apk add --no-cache tini && mkdir -p /data/assets && chown -R node:node /data
ENV NODE_ENV=production
WORKDIR /app
USER node
ENTRYPOINT ["/sbin/tini", "--"]

# ---------------------------------------------------------------- api
FROM runtime AS api
COPY --from=build --chown=node:node /out/api /app
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=4s --retries=5 CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/main.js"]

# ---------------------------------------------------------------- worker
FROM runtime AS worker
COPY --from=build --chown=node:node /out/worker /app
HEALTHCHECK --interval=10s --timeout=4s --retries=5 CMD node -e "fetch('http://127.0.0.1:4100/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/main.js"]

# ---------------------------------------------------------------- web (Next.js standalone output)
FROM runtime AS web
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone /app
COPY --from=build --chown=node:node /repo/apps/web/.next/static /app/apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public /app/apps/web/public
ENV PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=4s --retries=5 CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

# ---------------------------------------------------------------- migrate (one-shot: migrations + idempotent demo seed)
FROM build AS migrate
RUN chown -R node:node /repo/packages/database
USER node
WORKDIR /repo/packages/database
ENTRYPOINT []
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && ./node_modules/.bin/tsx prisma/seed.ts"]
