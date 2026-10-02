import type { DecisionRequest, DiplomaticStance, StrategicAction } from "@echoes/game-types";
import { QUESTION_SCHEMA_VERSION } from "@echoes/game-types";

/**
 * The faction decision question set (prompt id faction_decision, v3).
 * Questions are machine-readable — Choice / Score / Noul — never "what should we do?".
 */
export const FACTION_DECISION_PROMPT = { promptId: "faction_decision", promptVersion: 3, schemaVersion: QUESTION_SCHEMA_VERSION } as const;

export const ACTION_DESCRIPTIONS: Record<StrategicAction, string> = {
  expand: "Expand territory toward valuable resources and settle new land.",
  defend: "Strengthen defenses and garrisons against immediate threats.",
  trade: "Increase diplomatic trade activity and build commercial ties.",
  raid: "Conduct a limited hostile raid against an enemy at war or a hated rival.",
  research: "Prioritize technology development and knowledge.",
  retreat: "Reduce exposure, pull forces back and consolidate territory.",
};

export const STANCE_DESCRIPTIONS: Record<DiplomaticStance, string> = {
  improve_relations: "Make friendly gestures such as gifts.",
  maintain: "Keep the current relationship unchanged.",
  sanction: "Impose economic sanctions.",
  declare_war: "Declare war.",
  seek_peace: "Seek a ceasefire or peace.",
  propose_alliance: "Propose a formal alliance.",
};

export interface QuestionSpec {
  strategicAction: { instructions: string; options: StrategicAction[] } | null;
  stance: { instructions: string; options: DiplomaticStance[] } | null;
  threatLevel: string;
  foodUrgency: string;
  shouldAttack: string;
  proposals: { key: string; proposalId: string; instructions: string }[];
}

export function buildQuestionSpec(req: DecisionRequest): QuestionSpec {
  const p = req.projection;
  const target = p.neighbors.find((n) => n.id === req.candidates.stanceTargetId);
  const targetName = target?.name ?? "their most relevant neighbour";
  return {
    strategicAction: req.candidates.strategicActions.length >= 2
      ? {
        instructions: `You advise ${p.faction.name} (${p.faction.archetype}). Considering its personality, resources, threats and history, choose the strategic action with the best expected outcome this turn.`,
        options: req.candidates.strategicActions,
      }
      : null,
    stance: req.candidates.stances.length >= 2
      ? { instructions: `Which diplomatic stance should ${p.faction.name} take toward ${targetName} this turn?`, options: req.candidates.stances }
      : null,
    threatLevel: `How severe is the immediate strategic threat to ${p.faction.name}?`,
    foodUrgency: `How urgent is ${p.faction.name}'s food situation?`,
    shouldAttack: `Given the current state, should ${p.faction.name} initiate or continue an attack against ${targetName}?`,
    proposals: req.candidates.proposals.map((pr, idx) => ({
      key: `acceptProposal${idx}`,
      proposalId: pr.id,
      instructions: `Should ${p.faction.name} accept the ${pr.type} proposal from ${pr.from === "player" ? "the player's civilization" : pr.from}?`,
    })),
  };
}
