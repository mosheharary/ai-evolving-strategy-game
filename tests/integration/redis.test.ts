import { afterAll, describe, expect, it } from "vitest";
import { BudgetManager, ResponseCache } from "@echoes/ai";
import { createRedis, RedisKeyValueStore, RedisLock } from "@echoes/platform";

const redis = createRedis(process.env.REDIS_URL ?? "redis://localhost:6379", "redis-test");
afterAll(async () => {
  await redis.quit();
});

describe("Redis adapters", () => {
  it("lock prevents concurrent turn processing for the same game", async () => {
    const lock = new RedisLock(redis);
    const key = `test-${Date.now()}`;
    let inner: unknown = "unset";
    const outer = await lock.withLock(key, 5000, async () => {
      inner = await lock.withLock(key, 5000, async () => "second");
      return "first";
    });
    expect(outer).toBe("first");
    expect(inner).toBeNull();
    expect(await lock.withLock(key, 5000, async () => "again")).toBe("again");
  });

  it("budgets are shared across processes via Redis counters", async () => {
    const store = new RedisKeyValueStore(redis);
    const b = new BudgetManager(store, { perTurn: 2, perGame: 100, perUserPerDay: 100, imagesPerTurn: 1, imagesPerGame: 5 });
    const scope = { gameId: `g-${Date.now()}`, turn: 1, playerId: "p", kind: "text" as const };
    await b.consume(scope);
    await b.consume(scope);
    await expect(b.consume(scope)).rejects.toMatchObject({ kind: "budget" });
  });

  it("response cache round-trips JSON", async () => {
    const c = new ResponseCache(new RedisKeyValueStore(redis), 60);
    const key = `k-${Date.now()}`;
    await c.set(key, { value: { a: 1 }, model: "m" });
    expect(await c.get(key)).toEqual({ value: { a: 1 }, model: "m" });
  });
});
