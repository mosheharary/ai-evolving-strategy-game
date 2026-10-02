import { describe, expect, it } from "vitest";
import { canonicalStringify, hashObject, MinHeap, SeededRandom } from "../src";

describe("SeededRandom (deterministic randomness)", () => {
  it("produces the identical stream for the same seed", () => {
    const a = new SeededRandom("frontier");
    const b = new SeededRandom("frontier");
    expect(Array.from({ length: 50 }, () => a.next())).toEqual(Array.from({ length: 50 }, () => b.next()));
  });

  it("diverges for different seeds", () => {
    const a = new SeededRandom("seed-a");
    const b = new SeededRandom("seed-b");
    expect(a.next()).not.toEqual(b.next());
  });

  it("restores exactly from serialised state (save/load of RNG)", () => {
    const a = new SeededRandom("resume");
    for (let i = 0; i < 17; i++) a.next();
    const snapshot = a.getState();
    const expected = [a.next(), a.next(), a.next()];
    const b = new SeededRandom(snapshot);
    expect([b.next(), b.next(), b.next()]).toEqual(expected);
  });

  it("respects ranges and weighted picks", () => {
    const r = new SeededRandom("ranges");
    for (let i = 0; i < 1000; i++) {
      const v = r.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      const f = r.next();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 2000; i++) counts[r.weighted(["a", "b"] as const, [9, 1])]++;
    expect(counts.a).toBeGreaterThan(counts.b * 4);
  });
});

describe("canonical hashing", () => {
  it("is independent of key order", () => {
    expect(canonicalStringify({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(canonicalStringify({ a: [2, { c: 4, d: 3 }], b: 1 }));
    expect(hashObject({ x: 1, y: 2 })).toBe(hashObject({ y: 2, x: 1 }));
  });
  it("detects any change", () => {
    expect(hashObject({ x: 1 })).not.toBe(hashObject({ x: 2 }));
  });
  it("rejects non-finite numbers", () => {
    expect(() => canonicalStringify({ x: Number.NaN })).toThrow();
  });
});

describe("MinHeap", () => {
  it("pops in priority order with deterministic tie-breaks", () => {
    const h = new MinHeap();
    for (const [p, v] of [[3, 1], [1, 9], [1, 2], [2, 5]] as const) h.push(p, v);
    expect([h.pop(), h.pop(), h.pop(), h.pop()]).toEqual([[1, 2], [1, 9], [2, 5], [3, 1]]);
  });
});
