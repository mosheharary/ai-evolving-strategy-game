import { describe, expect, it } from "vitest";
import { canBuild, completeTurn, computeFactionEconomy, prepareTurn } from "../src";
import { newGame, playerCapital, run } from "./helpers";

const farmTile = (s: ReturnType<typeof newGame>) => s.map.tiles.find((t) => t.ownerId === "player" && canBuild(s, "player", "farm", t.i) === null)!.i;
const endTurn = (s: ReturnType<typeof newGame>) => completeTurn(prepareTurn(s).state, []).state;

describe("economy", () => {
  it("is deterministic and pure (same state → same economy)", () => {
    const s = newGame();
    expect(computeFactionEconomy(s, "player")).toEqual(computeFactionEconomy(s, "player"));
  });

  it("charges construction cost and adds production once complete", () => {
    const s0 = newGame();
    const before = computeFactionEconomy(s0, "player").income.food;
    const r = run(s0, { type: "BUILD_STRUCTURE", payload: { buildingType: "farm", tile: farmTile(s0) } });
    expect(r.ok).toBe(true);
    expect(r.state.factions[0]!.resources.wood).toBe(s0.factions[0]!.resources.wood - 15);
    // Under construction: no output yet.
    expect(computeFactionEconomy(r.state, "player").income.food).toBe(before);
    const s2 = endTurn(r.state);
    expect(computeFactionEconomy(s2, "player").income.food).toBeGreaterThan(before);
  });

  it("population consumes food and units have upkeep", () => {
    const s = newGame();
    const e = computeFactionEconomy(s, "player");
    const pop = s.settlements.filter((x) => x.ownerId === "player").reduce((a, x) => a + x.population, 0);
    expect(e.upkeep.food).toBeGreaterThanOrEqual(pop);
  });

  it("clamps stockpiles to storage capacity", () => {
    const s = newGame();
    s.factions[0]!.resources.wood = 10_000;
    const next = endTurn(s);
    expect(next.factions[0]!.resources.wood).toBeLessThanOrEqual(computeFactionEconomy(next, "player").storageCap.wood);
  });

  it("population grows with a food surplus", () => {
    let s = newGame();
    s.factions[0]!.resources.food = 140;
    const cap = playerCapital(s);
    cap.growth = 16.9;
    // Give a surplus by temporarily granting a farm-like boost via techs and farms.
    for (let i = 0; i < 2; i++) {
      const t = s.map.tiles.find((x) => x.ownerId === "player" && canBuild(s, "player", "farm", x.i) === null);
      if (t) s = run(s, { type: "BUILD_STRUCTURE", payload: { buildingType: "farm", tile: t.i } }).state;
    }
    for (let i = 0; i < 4; i++) s = endTurn(s);
    expect(playerCapital(s).population).toBeGreaterThan(3);
  });
});
