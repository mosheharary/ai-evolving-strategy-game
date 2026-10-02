import { describe, expect, it } from "vitest";
import { EngineContext } from "../src";
import { runEventDirector } from "../src/systems/events";
import { evaluateQuests, generateQuests } from "../src/systems/quests";
import { newGame } from "./helpers";

const emptyEvo = { depletedNodes: [], deforested: [], blighted: [], recovered: [], lines: [] };

describe("event director", () => {
  it("drought has a deterministic trigger (rainfall below threshold) and a structured cause", () => {
    const s = newGame("drought");
    s.turn = 10;
    s.world.rainfall = 0.12;
    const ctx = new EngineContext(s);
    runEventDirector(ctx, emptyEvo);
    const d = ctx.state.events.find((e) => e.type === "drought");
    expect(d).toBeDefined();
    expect(d!.cause.rainfall).toBe(0.12);
    expect(d!.effects.some((e) => e.kind === "yield_mult" && e.resource === "food")).toBe(true);
    expect(ctx.state.history.some((h) => h.eventId === d!.id)).toBe(true);
  });

  it("does not fire drought when rainfall is normal", () => {
    const s = newGame("drought");
    s.turn = 10;
    s.world.rainfall = 0.6;
    const ctx = new EngineContext(s);
    runEventDirector(ctx, emptyEvo);
    expect(ctx.state.events.some((e) => e.type === "drought")).toBe(false);
  });

  it("resource depletion causes a resource-collapse event", () => {
    const s = newGame("collapse");
    const ownTile = s.map.tiles.find((t) => t.ownerId === "player")!;
    const ctx = new EngineContext(s);
    runEventDirector(ctx, { ...emptyEvo, depletedNodes: [{ tile: ownTile.i, type: "iron", ownerId: "player" }] });
    expect(ctx.state.events.some((e) => e.type === "resource_collapse" && e.factionIds.includes("player"))).toBe(true);
  });

  it("generates quests with engine-owned requirements and rewards, and completes them", () => {
    const s = newGame("quests");
    const ruin = s.map.tiles.find((t) => t.poi === "ancient_ruin")!;
    ruin.poiDiscovered = true;
    const ctx = new EngineContext(s);
    generateQuests(ctx);
    const q = ctx.state.quests.find((x) => x.type === "discover_site" || x.type === "restore_ruin");
    expect(q).toBeDefined();
    expect(Object.keys(q!.rewards).length).toBeGreaterThan(0);
    if (q!.requirement.kind === "unit_on_tile") {
      const before = ctx.faction("player").resources.knowledge;
      ctx.state.units.find((u) => u.ownerId === "player")!.tile = q!.requirement.tile;
      ctx.invalidateUnits();
      evaluateQuests(ctx);
      expect(q!.status).toBe("completed");
      expect(ctx.faction("player").resources.knowledge).toBeGreaterThan(before);
    }
  });
});
