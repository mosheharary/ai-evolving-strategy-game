import { createDb, GameRepository, NarrativeRepository, PlayerRepository, SaveRepository } from "@echoes/database";
import { buildAI, createLogger, createQueues, createRedis, loadPlatformEnv, publishUpdate, RedisKeyValueStore, RedisLock } from "@echoes/platform";
import { AnonymousCookieAuth } from "./auth";
import { buildServer } from "./server";
import { GameService } from "./services/gameService";
import { UpdateHub } from "./services/sse";

async function main(): Promise<void> {
  const env = loadPlatformEnv();
  const logger = createLogger("api", env.LOG_LEVEL);
  const db = createDb(env.DATABASE_URL);
  const redis = createRedis(env.REDIS_URL, "echoes-api");
  const sub = createRedis(env.REDIS_URL, "echoes-api-sub");
  const store = new RedisKeyValueStore(redis);
  const ai = buildAI({ db, store, logger, assetDir: env.ASSET_STORAGE_DIR });
  const queues = createQueues(env.REDIS_URL);
  const hub = new UpdateHub(sub);
  const saves = new SaveRepository(db);
  const games = new GameService({
    games: new GameRepository(db), saves, narratives: new NarrativeRepository(db), assets: ai.assets, recorder: ai.recorder,
    ai: ai.orchestrator, queues, lock: new RedisLock(redis), publish: (p) => publishUpdate(redis, p), logger,
    config: ai.orchestrator.config.policy,
  });
  const auth = new AnonymousCookieAuth(new PlayerRepository(db), env.NODE_ENV === "production" && !env.ALLOWED_ORIGINS.includes("http://"));
  const app = await buildServer({ env, logger, db, redis, auth, games, hub, ai, saves });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "api.shutdown");
    const force = setTimeout(() => process.exit(1), 10_000);
    try {
      await app.close();
      await queues.close();
      await Promise.allSettled([redis.quit(), sub.quit(), db.$disconnect()]);
    } finally {
      clearTimeout(force);
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ port: env.API_PORT, host: env.API_HOST });
  logger.info({ port: env.API_PORT }, "api.listening");
}

main().catch((e: unknown) => {
  console.error(JSON.stringify({ level: "fatal", msg: "api failed to start", err: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
});
