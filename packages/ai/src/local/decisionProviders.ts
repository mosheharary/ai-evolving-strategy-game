import type { DecisionRequest, StrategicAction } from "@echoes/game-types";
import { SeededRandom, round } from "@echoes/shared";
import type { CallContext, DecisionResult, StrategicDecisionProvider } from "../providers/types";

/**
 * DeterministicDecisionProvider — returns no AI answer, so the engine applies its
 * deterministic strategic policy. Identical to the fallback path.
 */
export class DeterministicDecisionProvider implements StrategicDecisionProvider {
  readonly name = "local" as const;
  async decide(_req: DecisionRequest, _ctx: CallContext): Promise<DecisionResult> {
    return { answer: null, model: "deterministic-policy", usage: { inputTokens: 0, outputTokens: 0 }, requestId: null };
  }
}

function softmax(scores: Record<string, number>, temperature: number): Record<string, number> {
  const keys = Object.keys(scores).sort();
  const max = Math.max(...keys.map((k) => scores[k]!));
  const exps = keys.map((k) => Math.exp((scores[k]! - max) / temperature));
  const sum = exps.reduce((a, b) => a + b, 0);
  return Object.fromEntries(keys.map((k, i) => [k, round(exps[i]! / sum, 4)]));
}

/**
 * MockDecisionProvider — a TypeSafe stand-in for offline play. Produces realistic
 * probability distributions (softmax over projection-derived utilities with seeded
 * noise) so the DecisionPolicy's confidence thresholds are genuinely exercised.
 */
export class MockDecisionProvider implements StrategicDecisionProvider {
  readonly name = "mock" as const;

  async decide(req: DecisionRequest, _ctx: CallContext): Promise<DecisionResult> {
    const rng = new SeededRandom(`mock:${req.stateHash}`);
    const p = req.projection;
    const pers = p.faction.personality;
    const atWar = p.neighbors.some((n) => n.status === "war");
    const threat = p.threats.reduce((a, t) => Math.max(a, t.severity), 0);
    const base: Record<StrategicAction, number> = {
      expand: (pers.expansion ?? 0.5) + (p.map.freeSettleSites > 0 ? 0.3 : -1),
      defend: 0.3 + threat * 0.25,
      trade: (pers.mercantile ?? 0.5) + (atWar ? -0.2 : 0.1),
      raid: (pers.aggression ?? 0.5) + (atWar ? 0.5 : -0.4),
      research: (pers.science ?? 0.5) + 0.1,
      retreat: threat >= 4 ? 0.8 : -0.5,
    };
    const scores: Record<string, number> = {};
    for (const a of req.candidates.strategicActions) scores[a] = base[a] + rng.range(-0.35, 0.35);
    const probs = softmax(scores, 0.35);
    const best = Object.entries(probs).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]!;

    let stance = null;
    if (req.candidates.stances.length >= 1) {
      const target = p.neighbors.find((n) => n.id === req.candidates.stanceTargetId);
      const op = target?.opinion ?? 0;
      const st: Record<string, number> = {};
      for (const s of req.candidates.stances) {
        st[s] = (s === "maintain" ? 0.5 : s === "improve_relations" ? 0.3 + op / 200 : s === "sanction" ? -op / 120 : s === "declare_war" ? -op / 80 - 0.4 + (pers.aggression ?? 0) * 0.5 :
          s === "seek_peace" ? 0.2 + threat * 0.15 : s === "propose_alliance" ? op / 100 : 0) + rng.range(-0.2, 0.2);
      }
      const sp = softmax(st, 0.3);
      const sb = Object.entries(sp).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]!;
      stance = { choice: sb[0] as never, confidence: sb[1], probabilities: sp };
    }
    const target = p.neighbors.find((n) => n.id === req.candidates.stanceTargetId);
    const attackP = round(Math.max(0, Math.min(1, 0.15 + (atWar ? 0.35 : 0) + (pers.aggression ?? 0) * 0.3 - (target?.opinion ?? 0) / 300 + rng.range(-0.1, 0.1))), 3);
    const acceptProposals: Record<string, number> = {};
    for (const pr of req.candidates.proposals) {
      const from = p.neighbors.find((n) => n.id === pr.from);
      acceptProposals[pr.id] = round(Math.max(0, Math.min(1, 0.5 + (from?.opinion ?? 0) / 100 + (pr.type === "trade" ? (pers.mercantile ?? 0) * 0.3 : 0) + rng.range(-0.15, 0.15))), 3);
    }
    return {
      answer: {
        factionId: req.factionId,
        strategicAction: { choice: best[0] as StrategicAction, confidence: best[1], probabilities: probs },
        stance,
        threatLevel: { score: Math.min(4, threat), confidence: 0.7 },
        foodUrgency: { score: p.faction.foodPerTurn < 0 ? (p.faction.resources.food ?? 0) < 25 ? 4 : 2 : 0, confidence: 0.75 },
        shouldAttack: { probability: attackP },
        acceptProposals,
        provider: "mock",
        model: "mock-jev",
      },
      model: "mock-jev",
      usage: { inputTokens: 0, outputTokens: 0 },
      requestId: null,
    };
  }
}
