import type { KeyValueStore } from "@echoes/ai";
import type { ServerPush } from "@echoes/game-types";
import { Redis } from "ioredis";

export function createRedis(url: string, name: string): Redis {
  return new Redis(url, { connectionName: name, maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: false });
}

/** Redis-backed KeyValueStore for AI budgets, cache and developer fault flags. */
export class RedisKeyValueStore implements KeyValueStore {
  constructor(private readonly redis: Redis) {}

  get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) await this.redis.set(key, value, "EX", Math.max(1, Math.round(ttlSeconds)));
    else await this.redis.set(key, value);
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, Math.max(1, Math.round(ttlSeconds)));
    return n;
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }
}

/** Per-game mutex (SET NX PX) so two END_TURNs can never interleave across processes. */
export class RedisLock {
  constructor(private readonly redis: Redis) {}

  async withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
    const token = `${process.pid}:${Date.now()}:${Math.random()}`;
    const ok = await this.redis.set(`lock:${key}`, token, "PX", ttlMs, "NX");
    if (ok !== "OK") return null;
    try {
      return await fn();
    } finally {
      // Release only if we still own the lock.
      await this.redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, `lock:${key}`, token);
    }
  }
}

export const gameChannel = (gameId: string): string => `game-updates:${gameId}`;

export async function publishUpdate(redis: Redis, push: ServerPush): Promise<void> {
  await redis.publish(gameChannel(push.gameId), JSON.stringify(push));
}
