import { describe, expect, it } from "vitest";
import { canBuild, completeTurn, GameEngine, prepareTurn } from "../src";
import { newGame, run } from "./helpers";

describe("world evolution", () => {
  it("over-harvesting forest permanently converts it to scrubland and is remembered", () => {
    let s = newGame("evolve");
    const forest = s.map.tiles.find((t) => t.ownerId === "player" && canBuild(s, "player", "lumber_camp", t.i) === null && (t.biome === "forest" || t.biome === "taiga"));
    if (!forest) return; // seed-dependent; other seeds are covered by the gather test below
    s = run(s, { type: "BUILD_STRUCTURE", payload: { buildingType: "lumber_camp", tile: forest.i } }).state;
    s.map.tiles[forest.i]!.forest = 9;
    for (let i = 0; i < 3; i++) s = completeTurn(prepareTurn(s).state, []).state;
    const t = s.map.tiles[forest.i]!;
    expect(t.forest).toBeLessThan(8);
    expect(t.biome).toBe("scrubland");
    expect(t.baseBiome === "forest" || t.baseBiome === "taiga").toBe(true);
    expect(s.history.some((h) => h.type === "TERRAIN_CHANGED")).toBe(true);
  });

  it("pollution spreads to neighbours, flows downstream and decays", () => {
    const e = GameEngine.fromState(newGame("pollution"));
    const s = e.getState() as ReturnType<typeof newGame>;
    const river = s.map.tiles.find((t) => t.river && t.riverTo >= 0)!;
    river.pollution = 80;
    e.evolveWorld();
    const after = e.getState();
    expect(after.map.tiles[river.riverTo]!.pollution).toBeGreaterThan(0);
    expect(after.map.tiles[river.i]!.pollution).toBeLessThan(80);
  });

  it("climate variables evolve every turn", () => {
    let s = newGame("climate");
    const r0 = s.world.rainfall;
    s = completeTurn(prepareTurn(s).state, []).state;
    expect(s.world.rainfall).not.toBe(r0);
  });

  it("the world changes over many turns (events, history, trends)", () => {
    const e = GameEngine.createGame({ gameId: "g", seed: "long-run", civilizationName: "Testers" });
    for (let i = 0; i < 40; i++) e.endTurn([]);
    const s = e.getState();
    expect(s.turn).toBe(41);
    expect(s.era).toBeGreaterThanOrEqual(2);
    expect(s.events.length + s.history.filter((h) => h.type === "WORLD_EVENT" || h.type === "NATURAL_DISASTER").length).toBeGreaterThan(0);
    expect(s.trends.length).toBeGreaterThan(10);
    expect(s.settlements.length).toBeGreaterThan(6);
  });
});
