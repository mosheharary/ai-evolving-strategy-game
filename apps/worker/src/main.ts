import { createServer } from "node:http";
import { Worker, type Job } from "bullmq";
import { ContextCacheManager } from "@echoes/ai";
import { createDb, GameRepository, NarrativeRepository } from "@echoes/database";
import type { GameState } from "@echoes/game-types";
import { eventKey, factionAssetKey, heroAssetKey, techAssetKey } from "@echoes/game-types";
import {
  IMAGE_QUEUE,
  NARRATIVE_QUEUE,
  buildAI,
  createLogger,
  createQueues,
  createRedis,
  imageJobId,
  loadPlatformEnv,
  publishUpdate,
  redisConnection,
  RedisKeyValueStore,
  type ImageJob,
  type NarrativeJob,
} from "@echoes/platform";

/**
 * Worker: asynchronous presentation work (Gemini narrative + images). The game never
 * waits for this — the authoritative turn is already committed when jobs are queued.
 * Results are persisted and pushed to browsers over Redis pub/sub → SSE.
 */

const MAX_EVENT_NARRATIVES_PER_TURN = 4;

async function main(): Promise<void> {
  const env = loadPlatformEnv();
  const logger = createLogger("worker", env.LOG_LEVEL);
  const db = createDb(env.DATABASE_URL);
  const redis = createRedis(env.REDIS_URL, "echoes-worker");
  const store = new RedisKeyValueStore(redis);
  const ai = buildAI({ db, store, logger, assetDir: env.ASSET_STORAGE_DIR });
  const games = new GameRepository(db);
  const narratives = new NarrativeRepository(db);
  const queues = createQueues(env.REDIS_URL);

  const loadState = async (gameId: string): Promise<GameState | null> => (await games.load(gameId))?.state ?? null;
  const ctxFor = (job: { gameId: string; playerId: string; correlationId: string }, state: GameState) => ({ correlationId: job.correlationId, gameId: job.gameId, turn: state.turn, playerId: job.playerId });

  const narrativeWorker = new Worker<NarrativeJob>(
    NARRATIVE_QUEUE,
    async (job: Job<NarrativeJob>) => {
      const data = job.data;
      const state = await loadState(data.gameId);
      if (!state) return { skipped: "game_missing" };
      const ctx = ctxFor(data, state);
      switch (data.kind) {
        case "intro": {
          const r = await ai.narrative.narrateIntro(state, ctx);
          await narratives.upsert(data.gameId, r.view);
          await publishUpdate(redis, { type: "narrative_ready", gameId: data.gameId, key: r.view.key });
          return { key: r.view.key, source: r.view.source };
        }
        case "turn": {
          const summary = (await narratives.get(data.gameId, "summary"))?.body ?? null;
          const events = state.events
            .filter((e) => data.eventIds.includes(e.id))
            .sort((a, b) => Number(b.major) - Number(a.major) || b.severity - a.severity || a.id.localeCompare(b.id))
            .slice(0, MAX_EVENT_NARRATIVES_PER_TURN);
          const cachedContent = await ai.contextCache.getEventNarrativeCache(data.gameId, ContextCacheManager.loreBundle(state, summary));
          const done: string[] = [];
          for (const e of events) {
            if (await narratives.get(data.gameId, eventKey(e))) continue;
            const r = await ai.narrative.narrateEvent(state, e, summary, ctx, cachedContent);
            await narratives.upsert(data.gameId, r.view);
            await publishUpdate(redis, { type: "narrative_ready", gameId: data.gameId, key: r.view.key });
            done.push(r.view.key);
            // Images only for events worth illustrating — never for every minor tick.
            if (e.major || e.type === "discovery" || e.type === "ancient_ruin_discovery") {
              const img: ImageJob = { kind: "event", gameId: data.gameId, playerId: data.playerId, eventId: e.id, sceneDetail: r.visualPrompt, correlationId: data.correlationId };
              await queues.images.add("event", img, { jobId: imageJobId(img) });
            }
          }
          return { narrated: done };
        }
        case "summary": {
          const prev = (await narratives.get(data.gameId, "summary"))?.body ?? null;
          const r = await ai.narrative.summarizeCampaign(state, prev, ctx);
          await narratives.upsert(data.gameId, r.view);
          await publishUpdate(redis, { type: "narrative_ready", gameId: data.gameId, key: r.view.key });
          return { key: r.view.key };
        }
        case "quest": {
          const q = state.quests.find((x) => x.id === data.questId);
          if (!q) return { skipped: "quest_missing" };
          const r = await ai.narrative.narrateQuest(state, q, ctx);
          await narratives.upsert(data.gameId, r.view);
          await publishUpdate(redis, { type: "narrative_ready", gameId: data.gameId, key: r.view.key });
          return { key: r.view.key };
        }
        case "faction": {
          const r = await ai.narrative.narrateFaction(state, data.factionId, ctx);
          await narratives.upsert(data.gameId, r.view);
          await publishUpdate(redis, { type: "narrative_ready", gameId: data.gameId, key: r.view.key });
          return { key: r.view.key };
        }
      }
    },
    { connection: redisConnection(env.REDIS_URL), concurrency: 2 },
  );

  const imageWorker = new Worker<ImageJob>(
    IMAGE_QUEUE,
    async (job: Job<ImageJob>) => {
      const data = job.data;
      const state = await loadState(data.gameId);
      if (!state) return { skipped: "game_missing" };
      const ctx = ctxFor(data, state);
      let key: string;
      let asset;
      switch (data.kind) {
        case "event": {
          const e = state.events.find((x) => x.id === data.eventId);
          if (!e) return { skipped: "event_missing" };
          key = eventKey(e);
          asset = e.type === "discovery" || e.type === "ancient_ruin_discovery"
            ? await ai.images.generateLocationImage(state, e, ctx)
            : await ai.images.generateEventImage(state, e, data.sceneDetail, ctx);
          break;
        }
        case "faction":
          key = factionAssetKey(data.factionId, state.era);
          asset = await ai.images.generateFactionPortrait(state, data.factionId, ctx);
          break;
        case "technology":
          key = techAssetKey(data.techId);
          asset = await ai.images.generateTechnologyImage(state, data.techId, ctx);
          break;
        case "hero": {
          key = heroAssetKey(data.heroKind, data.era);
          const intro = data.heroKind === "intro" ? await narratives.get(data.gameId, "intro") : null;
          asset = await ai.images.generateHeroImage(state, data.heroKind, data.sceneDetail ?? (intro ? intro.title : null), ctx);
          break;
        }
      }
      await ai.assets.link(data.gameId, key, asset.assetId);
      await publishUpdate(redis, { type: "image_ready", gameId: data.gameId, key, assetId: asset.assetId });
      return { key, assetId: asset.assetId, source: asset.source };
    },
    { connection: redisConnection(env.REDIS_URL), concurrency: 1 },
  );

  for (const w of [narrativeWorker, imageWorker]) {
    w.on("completed", (job, result) => logger.info({ queue: w.name, jobId: job.id, kind: job.data.kind, gameId: job.data.gameId, result }, "job.completed"));
    w.on("failed", (job, err) => logger.warn({ queue: w.name, jobId: job?.id, kind: job?.data.kind, gameId: job?.data.gameId, err: err.message }, "job.failed"));
  }

  // Health endpoint for Docker.
  const port = Number(process.env.WORKER_HEALTH_PORT ?? 4100);
  const health = createServer((req, res) => {
    if (req.url === "/health") {
      const ok = narrativeWorker.isRunning() && imageWorker.isRunning();
      res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: ok ? "ok" : "degraded", service: "worker" }));
      return;
    }
    res.writeHead(404).end();
  });
  health.listen(port, "0.0.0.0");
  logger.info({ port }, "worker.started");

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "worker.shutdown");
    const force = setTimeout(() => process.exit(1), 15_000);
    await Promise.allSettled([narrativeWorker.close(), imageWorker.close()]);
    await queues.close();
    health.close();
    await Promise.allSettled([redis.quit(), db.$disconnect()]);
    clearTimeout(force);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((e: unknown) => {
  console.error(JSON.stringify({ level: "fatal", msg: "worker failed to start", err: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
});
