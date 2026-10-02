import type { FastifyInstance } from "fastify";
import { createDb, GameRepository, NarrativeRepository, PlayerRepository, SaveRepository, type Db } from "@echoes/database";
import { buildAI, createLogger, createQueues, createRedis, loadPlatformEnv, publishUpdate, RedisKeyValueStore, RedisLock } from "@echoes/platform";
import { AnonymousCookieAuth } from "../../apps/api/src/auth";
import { buildServer } from "../../apps/api/src/server";
import { GameService } from "../../apps/api/src/services/gameService";
import { UpdateHub } from "../../apps/api/src/services/sse";

export interface Harness {
  app: FastifyInstance;
  db: Db;
  close(): Promise<void>;
}

/** Real Fastify app wired to real PostgreSQL + Redis (AI in mock mode — no keys needed). */
export async function startHarness(): Promise<Harness> {
  const env = loadPlatformEnv({ ...process.env, LOG_LEVEL: "silent", DEV_TOOLS_ENABLED: "true", ASSET_STORAGE_DIR: "./data/test-assets" });
  const logger = createLogger("test", "silent");
  const db = createDb(env.DATABASE_URL);
  const redis = createRedis(env.REDIS_URL, "test");
  const sub = createRedis(env.REDIS_URL, "test-sub");
  const store = new RedisKeyValueStore(redis);
  const ai = buildAI({ db, store, logger, assetDir: env.ASSET_STORAGE_DIR, env: { ...process.env, AI_MODE: "mock" } });
  await ai.orchestrator.faults.set({ disableGemini: false, disableTypeSafe: false, forceRateLimit: false, forceTimeout: false });
  const queues = createQueues(env.REDIS_URL);
  const saves = new SaveRepository(db);
  const games = new GameService({
    games: new GameRepository(db), saves, narratives: new NarrativeRepository(db), assets: ai.assets, recorder: ai.recorder,
    ai: ai.orchestrator, queues, lock: new RedisLock(redis), publish: (p) => publishUpdate(redis, p), logger, config: ai.orchestrator.config.policy,
  });
  const app = await buildServer({ env, logger, db, redis, auth: new AnonymousCookieAuth(new PlayerRepository(db), false), games, hub: new UpdateHub(sub), ai, saves });
  await app.ready();
  return {
    app, db,
    async close() {
      await app.close();
      await queues.close();
      await Promise.allSettled([redis.quit(), sub.quit(), db.$disconnect()]);
    },
  };
}

/** A cookie-carrying client that sends the CSRF header like the real browser client. */
export function client(app: FastifyInstance) {
  let cookie = "";
  const call = async (method: "GET" | "POST" | "DELETE", url: string, body?: unknown, extraHeaders: Record<string, string> = {}) => {
    const res = await app.inject({
      method, url,
      headers: { ...(cookie ? { cookie } : {}), ...(method === "GET" ? {} : { "content-type": "application/json", "x-echoes-client": "web", origin: "http://localhost:3000" }), ...extraHeaders },
      payload: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
    const set = res.headers["set-cookie"];
    if (set) cookie = (Array.isArray(set) ? set : [set]).map((c) => c.split(";")[0]).join("; ");
    return { status: res.statusCode, json: res.body ? (() => { try { return JSON.parse(res.body); } catch { return res.body; } })() : null, headers: res.headers };
  };
  return { get: (u: string) => call("GET", u), post: (u: string, b?: unknown, h?: Record<string, string>) => call("POST", u, b, h), del: (u: string) => call("DELETE", u), raw: call };
}
