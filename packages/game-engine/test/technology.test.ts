import { describe, expect, it } from "vitest";
import { canResearch, completeTurn, computeFactionEconomy, prepareTurn, TECHS, techModifiers } from "../src";
import { newGame, run } from "./helpers";

describe("technology", () => {
  it("enforces prerequisites and era gating", () => {
    const s = newGame();
    expect(canResearch(s, "player", "irrigation")).toBeNull();
    expect(canResearch(s, "player", "selective_breeding")).toMatch(/Requires/);
    expect(canResearch(s, "player", "steam_power")).toMatch(/Era 2/);
    expect(canResearch(s, "player", "made_up_tech")).toMatch(/Unknown/);
  });

  it("completes research by spending knowledge and records history", () => {
    let s = newGame();
    s = run(s, { type: "RESEARCH_TECH", payload: { techId: "irrigation" } }).state;
    s.factions[0]!.resources.knowledge = 400;
    s = completeTurn(prepareTurn(s).state, []).state;
    expect(s.factions[0]!.research.known).toContain("irrigation");
    expect(s.history.some((h) => h.type === "TECHNOLOGY_RESEARCHED" && h.actorId === "player")).toBe(true);
  });

  it("every technology changes mechanics (no label-only techs)", () => {
    for (const t of TECHS) expect(Object.values(t.effects).some((v) => v !== 0) || t.unlocks.length > 0).toBe(true);
  });

  it("technology alters the economy", () => {
    const s = newGame();
    const before = computeFactionEconomy(s, "player").income.knowledge;
    s.factions[0]!.research.known.push("writing");
    expect(computeFactionEconomy(s, "player").income.knowledge).toBeGreaterThan(before);
    expect(techModifiers(["administration"]).housing).toBe(2);
  });
});
