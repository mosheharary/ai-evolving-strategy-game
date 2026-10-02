import { describe, expect, it } from "vitest";
import type { DecisionCandidates, StrategicAnswer } from "@echoes/game-types";
import { decide, decideProposal, validateAnswer } from "../src";

const candidates: DecisionCandidates = { strategicActions: ["defend", "expand", "raid", "research"], stances: ["maintain", "declare_war", "sanction"], stanceTargetId: "player", proposals: [] };
const utilities = { expand: 0.9, defend: 0.5, trade: 0, raid: 0.2, research: 0.6, retreat: -1 };
const inputs = { candidates, utilities, stanceUtilities: { maintain: 0.5 }, forced: null, aggression: 0.4, foodCritical: false, threatCritical: false };
const cfg = { executeThreshold: 0.8, conservativeThreshold: 0.55 };

const answer = (choice: StrategicAnswer["strategicAction"]["choice"], confidence: number, extra: Partial<StrategicAnswer> = {}): StrategicAnswer => ({
  factionId: "ironhold", strategicAction: { choice, confidence, probabilities: { [choice]: confidence } }, stance: null,
  threatLevel: { score: 1, confidence: 0.5 }, foodUrgency: { score: 0, confidence: 0.5 }, shouldAttack: { probability: 0.1 },
  acceptProposals: {}, provider: "typesafe", model: "jev-1.13.0", ...extra,
});

describe("DecisionPolicy", () => {
  it("high confidence → executes the AI choice", () => {
    const d = decide(inputs, answer("raid", 0.91), cfg, null);
    expect(d).toMatchObject({ action: "raid", mode: "execute", source: "ai" });
  });

  it("medium confidence → conservative variant (raid becomes defend)", () => {
    const d = decide(inputs, answer("raid", 0.7), cfg, null);
    expect(d).toMatchObject({ action: "defend", mode: "conservative", source: "ai" });
  });

  it("low confidence → deterministic fallback (utility argmax)", () => {
    const d = decide(inputs, answer("raid", 0.3), cfg, null);
    expect(d).toMatchObject({ action: "expand", mode: "fallback", source: "fallback" });
  });

  it("no answer (provider down) → deterministic fallback", () => {
    expect(decide(inputs, null, cfg, "typesafe_timeout")).toMatchObject({ action: "expand", mode: "fallback", reason: "typesafe_timeout" });
  });

  it("thresholds are configurable", () => {
    expect(decide(inputs, answer("raid", 0.7), { executeThreshold: 0.6, conservativeThreshold: 0.3 }, null).mode).toBe("execute");
  });

  it("war requires a confident shouldAttack judgement", () => {
    const a = answer("raid", 0.95, { stance: { choice: "declare_war", confidence: 0.95, probabilities: {} }, shouldAttack: { probability: 0.2 } });
    expect(decide(inputs, a, cfg, null).stance).toBe("sanction");
    const b = { ...a, shouldAttack: { probability: 0.9 } };
    expect(decide(inputs, b, cfg, null).stance).toBe("declare_war");
  });

  it("survival hard rules beat AI judgement", () => {
    const d = decide({ ...inputs, forced: "defend", threatCritical: true }, answer("research", 0.99), cfg, null);
    expect(d.action).toBe("defend");
  });

  it("rejects illegal actions, illegal stances, unknown proposals and malformed answers", () => {
    expect(validateAnswer(answer("trade", 0.9), candidates)).toEqual({ ok: false, reason: "illegal_action" });
    expect(validateAnswer(answer("raid", 0.9, { stance: { choice: "propose_alliance", confidence: 1, probabilities: {} } }), candidates)).toEqual({ ok: false, reason: "illegal_stance" });
    expect(validateAnswer(answer("raid", 0.9, { acceptProposals: { p999: 1 } }), candidates)).toEqual({ ok: false, reason: "unknown_proposal" });
    expect(validateAnswer({ factionId: "x", strategicAction: { choice: "build_super_weapon" } }, candidates).ok).toBe(false);
    expect(validateAnswer(answer("raid", 1.7), candidates).ok).toBe(false);
  });

  it("proposal acceptance blends AI probability with deterministic rules", () => {
    expect(decideProposal(0.95, 0, cfg)).toBe(true);
    expect(decideProposal(0.1, 1, cfg)).toBe(false);
    expect(decideProposal(0.6, 0.4, cfg)).toBe(true);
    expect(decideProposal(undefined, 0.6, cfg)).toBe(true);
  });
});
