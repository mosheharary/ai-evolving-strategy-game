import { describe, expect, it } from "vitest";
import { EngineContext, canAttack, previewAttack } from "../src";
import { resolveAttack } from "../src/systems/combat";
import { declareWar } from "../src/systems/diplomacy";
import { newGame, playerUnit } from "./helpers";
import { getGrid, isWater } from "@echoes/procedural-world";

function duelSetup(seed = "combat") {
  const s = newGame(seed);
  const guard = playerUnit(s, "guard");
  const grid = getGrid(48, 48);
  const spot = grid.neighbors(guard.tile).find((n) => !isWater(s.map.tiles[n]!.biome) && !s.units.some((u) => u.tile === n) && !s.settlements.some((x) => x.tile === n))!;
  const enemy = s.units.find((u) => u.ownerId === "ironhold" && u.type === "guard")!;
  enemy.tile = spot;
  return { s, guard, enemy, spot };
}

describe("deterministic combat", () => {
  it("requires war", () => {
    const { s, guard, spot } = duelSetup();
    expect(canAttack(s, guard, spot)).toMatch(/war/);
  });

  it("produces identical outcomes from identical state + seed", () => {
    const outcomes = [0, 1].map(() => {
      const { s, guard, spot } = duelSetup();
      const ctx = new EngineContext(s);
      declareWar(ctx, "player", "ironhold");
      expect(canAttack(s, guard, spot)).toBeNull();
      const r = resolveAttack(ctx, ctx.unit(guard.id)!, spot);
      return { damage: r.damage, counter: r.counter, rng: ctx.commit().rng };
    });
    expect(outcomes[0]).toEqual(outcomes[1]);
    expect(outcomes[0]!.damage).toBeGreaterThan(0);
  });

  it("applies terrain, fortification and technology modifiers", () => {
    const { s, guard, enemy, spot } = duelSetup();
    const ctx = new EngineContext(s);
    declareWar(ctx, "player", "ironhold");
    const base = previewAttack(s, guard, spot)!;
    enemy.status = "fortified";
    const fortified = previewAttack(s, guard, spot)!;
    expect(fortified.defensePower).toBeGreaterThan(base.defensePower);
    s.factions.find((f) => f.id === "player")!.research.known.push("bronze_working");
    const tech = previewAttack(s, guard, spot)!;
    expect(tech.attackPower).toBeGreaterThan(fortified.attackPower);
  });

  it("removes destroyed units and records history", () => {
    const { s, guard, enemy, spot } = duelSetup();
    const ctx = new EngineContext(s);
    declareWar(ctx, "player", "ironhold");
    ctx.unit(enemy.id)!.hp = 1;
    const r = resolveAttack(ctx, ctx.unit(guard.id)!, spot);
    expect(r.defenderDestroyed).toBe(true);
    expect(ctx.state.units.some((u) => u.id === enemy.id)).toBe(false);
    expect(ctx.state.history.some((h) => h.type === "UNIT_DEFEATED")).toBe(true);
    expect(ctx.faction("ironhold").defeatsByPlayer).toBe(1);
  });
});
