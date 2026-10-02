import { describe, expect, it } from "vitest";
import { MOVE_COST, reachableTiles } from "../src";
import { newGame, playerUnit, run } from "./helpers";
import { isWater } from "@echoes/procedural-world";

describe("movement", () => {
  it("never reaches water or occupied tiles and respects move points", () => {
    const s = newGame("movement");
    const scout = playerUnit(s, "scout");
    const reach = reachableTiles(s, scout);
    expect(reach.size).toBeGreaterThan(0);
    for (const [tile, cost] of reach) {
      expect(isWater(s.map.tiles[tile]!.biome)).toBe(false);
      expect(s.units.some((u) => u.tile === tile && u.id !== scout.id)).toBe(false);
      expect(cost).toBeLessThanOrEqual(scout.movesLeft);
    }
  });

  it("moves via a validated command and spends move points", () => {
    const s = newGame("movement");
    const scout = playerUnit(s, "scout");
    const [to, cost] = [...reachableTiles(s, scout).entries()].sort((a, b) => a[1] - b[1])[0]!;
    const r = run(s, { type: "MOVE_UNIT", payload: { unitId: scout.id, to } });
    expect(r.ok).toBe(true);
    const moved = r.state.units.find((u) => u.id === scout.id)!;
    expect(moved.tile).toBe(to);
    expect(moved.movesLeft).toBe(scout.movesLeft - cost);
  });

  it("rejects moves out of reach", () => {
    const s = newGame("movement");
    const scout = playerUnit(s, "scout");
    const far = s.map.tiles.find((t) => !isWater(t.biome) && !reachableTiles(s, scout).has(t.i) && t.i !== scout.tile)!;
    const r = run(s, { type: "MOVE_UNIT", payload: { unitId: scout.id, to: far.i } });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/reach/);
  });

  it("has costlier rough terrain", () => {
    expect(MOVE_COST.mountain).toBeGreaterThan(MOVE_COST.forest);
    expect(MOVE_COST.forest).toBeGreaterThan(MOVE_COST.plains);
  });
});
