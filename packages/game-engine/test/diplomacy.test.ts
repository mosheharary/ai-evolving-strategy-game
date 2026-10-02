import { describe, expect, it } from "vitest";
import { EngineContext, legalStatusTransition } from "../src";
import { declareWar, makeCeasefire, tickDiplomacy } from "../src/systems/diplomacy";
import { applyFactionDecisions } from "../src/systems/factionAI";
import { newGame, run } from "./helpers";

describe("diplomacy", () => {
  it("only allows legal status transitions", () => {
    expect(legalStatusTransition("peace", "war")).toBe(true);
    expect(legalStatusTransition("peace", "ceasefire")).toBe(false);
    expect(legalStatusTransition("war", "alliance")).toBe(false);
    expect(legalStatusTransition("war", "ceasefire")).toBe(true);
  });

  it("declaring war lowers opinion and is remembered", () => {
    const s = newGame();
    const r = run(s, { type: "DIPLOMACY_ACTION", payload: { factionId: "saltwind", action: "declare_war" } });
    expect(r.ok).toBe(true);
    const f = r.state.factions.find((x) => x.id === "saltwind")!;
    expect(f.opinions.player).toBeLessThan(-20);
    expect(f.memories.some((m) => m.kind === "attacked_us" && m.aboutId === "player")).toBe(true);
    expect(r.state.history.some((h) => h.type === "PLAYER_DECLARED_WAR")).toBe(true);
  });

  it("gifts improve opinion and transfer resources", () => {
    const s = newGame();
    const r = run(s, { type: "DIPLOMACY_ACTION", payload: { factionId: "lumen", action: "gift", resource: "food", amount: 30 } });
    expect(r.ok).toBe(true);
    expect(r.state.factions[0]!.resources.food).toBe(s.factions[0]!.resources.food - 30);
    expect(r.state.factions.find((x) => x.id === "lumen")!.opinions.player).toBeGreaterThan(s.factions.find((x) => x.id === "lumen")!.opinions.player ?? 0);
  });

  it("rejects gifts the player cannot afford (client cannot invent resources)", () => {
    const s = newGame();
    const r = run(s, { type: "DIPLOMACY_ACTION", payload: { factionId: "lumen", action: "gift", resource: "metal", amount: 9999 } });
    expect(r.ok).toBe(false);
  });

  it("ceasefire blocks war and expires into peace", () => {
    const s = newGame();
    const ctx = new EngineContext(s);
    declareWar(ctx, "player", "ironhold");
    makeCeasefire(ctx, "player", "ironhold");
    expect(declareWar(ctx, "player", "ironhold")).toMatch(/ceasefire/);
    ctx.state.turn += 6;
    tickDiplomacy(ctx);
    expect(ctx.relation("player", "ironhold").status).toBe("peace");
  });

  it("AI factions answer player proposals at end of turn (deterministic fallback)", () => {
    const s0 = newGame();
    const s = run(s0, { type: "DECLARE_TRADE", payload: { factionId: "saltwind" } }).state;
    expect(s.proposals).toHaveLength(1);
    s.factions.find((f) => f.id === "saltwind")!.opinions.player = 60;
    const ctx = new EngineContext(structuredClone(s));
    ctx.state.phase = "FACTION_AI";
    applyFactionDecisions(ctx, []);
    expect(ctx.state.proposals.filter((p) => p.from === "player")).toHaveLength(0);
    expect(ctx.relation("player", "saltwind").trade).toBe(true);
  });
});
