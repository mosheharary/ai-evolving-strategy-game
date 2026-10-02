import type {
  AIPolicyConfig,
  DecisionCandidates,
  DiplomaticStance,
  StrategicAction,
  StrategicAnswer,
} from "@echoes/game-types";
import { STRATEGIC_ACTIONS } from "@echoes/game-types";
import { StrategicAnswerSchema } from "@echoes/game-types";

/**
 * DecisionPolicy — turns (legal candidates + deterministic utilities + optional AI
 * probabilities) into a single validated decision. The AI provider can never
 * select anything outside the candidate list, and low-confidence answers fall
 * back to the deterministic policy.
 *
 *   confidence ≥ executeThreshold                → execute AI choice
 *   conservativeThreshold ≤ confidence < execute → conservative variant
 *   confidence < conservativeThreshold           → deterministic fallback
 */

export interface PolicyDecision {
  action: StrategicAction;
  stance: DiplomaticStance;
  mode: "execute" | "conservative" | "fallback";
  source: "ai" | "fallback";
  confidence: number;
  attackApproved: boolean;
  urgentDefense: boolean;
  urgentFood: boolean;
  reason: string;
}

export interface PolicyInputs {
  candidates: DecisionCandidates;
  utilities: Record<StrategicAction, number>;
  stanceUtilities: Partial<Record<DiplomaticStance, number>>;
  /** Deterministic hard-rule overrides (e.g. overwhelming threat → defend). */
  forced: StrategicAction | null;
  aggression: number;
  foodCritical: boolean;
  threatCritical: boolean;
}

export const CONSERVATIVE_VARIANT: Record<StrategicAction, StrategicAction> = {
  expand: "expand",
  defend: "defend",
  trade: "trade",
  raid: "defend",
  research: "research",
  retreat: "defend",
};

export function argmaxAction(utilities: Record<StrategicAction, number>, legal: readonly StrategicAction[]): StrategicAction {
  let best: StrategicAction = legal[0] ?? "defend";
  let bestV = -Infinity;
  for (const a of STRATEGIC_ACTIONS) {
    if (!legal.includes(a)) continue;
    const v = utilities[a];
    if (v > bestV) {
      bestV = v;
      best = a;
    }
  }
  return best;
}

function argmaxStance(utilities: Partial<Record<DiplomaticStance, number>>, legal: readonly DiplomaticStance[]): DiplomaticStance {
  let best: DiplomaticStance = legal.includes("maintain") ? "maintain" : legal[0] ?? "maintain";
  let bestV = -Infinity;
  for (const s of legal) {
    const v = utilities[s] ?? 0;
    if (v > bestV) {
      bestV = v;
      best = s;
    }
  }
  return best;
}

/** Schema + semantic validation of an AI answer against the legal candidates. */
export function validateAnswer(answer: unknown, candidates: DecisionCandidates): { ok: true; answer: StrategicAnswer } | { ok: false; reason: string } {
  const parsed = StrategicAnswerSchema.safeParse(answer);
  if (!parsed.success) return { ok: false, reason: "schema_invalid" };
  const a = parsed.data;
  if (!candidates.strategicActions.includes(a.strategicAction.choice)) return { ok: false, reason: "illegal_action" };
  if (a.stance && !candidates.stances.includes(a.stance.choice)) return { ok: false, reason: "illegal_stance" };
  for (const pid of Object.keys(a.acceptProposals)) {
    if (!candidates.proposals.some((p) => p.id === pid)) return { ok: false, reason: "unknown_proposal" };
  }
  return { ok: true, answer: a };
}

export function decide(inputs: PolicyInputs, rawAnswer: StrategicAnswer | null, config: AIPolicyConfig, invalidReason: string | null): PolicyDecision {
  const { candidates, utilities } = inputs;
  const fallbackAction = inputs.forced && candidates.strategicActions.includes(inputs.forced)
    ? inputs.forced
    : argmaxAction(utilities, candidates.strategicActions);
  const fallbackStance = argmaxStance(inputs.stanceUtilities, candidates.stances);

  if (!rawAnswer) {
    return {
      action: fallbackAction, stance: fallbackStance, mode: "fallback", source: "fallback", confidence: 1,
      attackApproved: inputs.aggression > 0.6 && fallbackStance === "declare_war",
      urgentDefense: inputs.threatCritical, urgentFood: inputs.foodCritical,
      reason: invalidReason ?? "deterministic policy",
    };
  }

  const answer = rawAnswer;
  const conf = answer.strategicAction.confidence;
  let action: StrategicAction;
  let mode: PolicyDecision["mode"];
  if (inputs.forced && inputs.forced !== answer.strategicAction.choice && inputs.threatCritical) {
    // Hard rules beat AI judgement when survival is at stake.
    action = inputs.forced;
    mode = "fallback";
  } else if (conf >= config.executeThreshold) {
    action = answer.strategicAction.choice;
    mode = "execute";
  } else if (conf >= config.conservativeThreshold) {
    action = CONSERVATIVE_VARIANT[answer.strategicAction.choice];
    if (!candidates.strategicActions.includes(action)) action = fallbackAction;
    mode = "conservative";
  } else {
    action = fallbackAction;
    mode = "fallback";
  }

  let stance = fallbackStance;
  if (answer.stance && candidates.stances.includes(answer.stance.choice)) {
    const sc = answer.stance.confidence;
    if (sc >= config.executeThreshold) stance = answer.stance.choice;
    else if (sc >= config.conservativeThreshold) {
      stance = answer.stance.choice === "declare_war" ? (candidates.stances.includes("sanction") ? "sanction" : "maintain") : answer.stance.choice;
    }
  }
  // War requires both the stance and a confident "should attack" judgement.
  const attackP = answer.shouldAttack.probability;
  const attackApproved = attackP >= config.executeThreshold || (attackP >= config.conservativeThreshold && inputs.aggression > 0.6);
  if (stance === "declare_war" && !attackApproved) stance = candidates.stances.includes("sanction") ? "sanction" : "maintain";

  return {
    action,
    stance,
    mode,
    source: mode === "fallback" ? "fallback" : "ai",
    confidence: conf,
    attackApproved,
    urgentDefense: inputs.threatCritical || answer.threatLevel.score >= 3,
    urgentFood: inputs.foodCritical || answer.foodUrgency.score >= 3,
    reason:
      mode === "execute" ? `AI chose ${answer.strategicAction.choice} (confidence ${conf.toFixed(2)})`
        : mode === "conservative" ? `AI leaned ${answer.strategicAction.choice} (confidence ${conf.toFixed(2)}); executing cautious ${action}`
          : `AI confidence ${conf.toFixed(2)} too low; deterministic ${action}`,
  };
}

/** Proposal acceptance blending AI probability with the deterministic rule. */
export function decideProposal(aiProbability: number | undefined, deterministicP: number, config: AIPolicyConfig): boolean {
  if (aiProbability === undefined) return deterministicP >= 0.5;
  if (aiProbability >= config.executeThreshold) return true;
  if (aiProbability <= 1 - config.executeThreshold) return false;
  if (aiProbability >= config.conservativeThreshold) return deterministicP >= 0.35;
  return deterministicP >= 0.5;
}
