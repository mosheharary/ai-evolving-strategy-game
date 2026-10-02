import { z } from "zod";
import { DIPLOMATIC_STANCES, STRATEGIC_ACTIONS } from "./state";
import type { DiplomaticStance, DiplomaticStatus, StrategicAction } from "./state";

/**
 * Contract between the GameEngine and any StrategicDecisionProvider.
 * The engine produces DecisionRequests containing only *legal* candidates;
 * providers return StrategicAnswers which are validated before the engine's
 * DecisionPolicy turns them into concrete, rule-checked actions.
 */

export const QUESTION_SCHEMA_VERSION = "faction_decision_v3";

export interface StrategicStateProjection {
  turn: number;
  era: number;
  faction: {
    id: string;
    name: string;
    archetype: string;
    personality: Record<string, number>;
    posture: string;
    resources: Record<string, number>;
    settlements: number;
    population: number;
    militaryStrength: number;
    techCount: number;
    researching: string | null;
    foodPerTurn: number;
    defeatsByPlayer: number;
  };
  neighbors: {
    id: string;
    name: string;
    isPlayer: boolean;
    status: DiplomaticStatus;
    opinion: number;
    militaryStrength: number;
    distance: number;
    trade: boolean;
    sanctioning: boolean;
  }[];
  threats: { kind: string; detail: string; severity: number }[];
  map: { territoryTiles: number; freeSettleSites: number; nearbyResources: string[]; pollutionNearby: number; forestNearby: number };
  activeEvents: { type: string; severity: number; affectsUs: boolean }[];
  recentHistory: string[];
  pendingProposals: { id: string; fromName: string; type: string }[];
  objectives: string[];
}

export interface DecisionCandidates {
  strategicActions: StrategicAction[];
  stances: DiplomaticStance[];
  /** The faction the stance question is about (usually the most relevant neighbour). */
  stanceTargetId: string | null;
  proposals: { id: string; from: string; type: string }[];
}

export interface DecisionRequest {
  factionId: string;
  turn: number;
  stateHash: string;
  projection: StrategicStateProjection;
  candidates: DecisionCandidates;
}

const prob = z.number().min(0).max(1);

export const ChoiceAnswerSchema = z.object({
  choice: z.string(),
  confidence: prob,
  probabilities: z.record(z.string(), prob),
});

export const StrategicAnswerSchema = z.object({
  factionId: z.string(),
  strategicAction: ChoiceAnswerSchema.extend({ choice: z.enum(STRATEGIC_ACTIONS) }),
  stance: ChoiceAnswerSchema.extend({ choice: z.enum(DIPLOMATIC_STANCES) }).nullable(),
  /** Expected score on 0..4 rubric (minimal..critical). */
  threatLevel: z.object({ score: z.number().min(0).max(4), confidence: prob }),
  foodUrgency: z.object({ score: z.number().min(0).max(4), confidence: prob }),
  shouldAttack: z.object({ probability: prob }),
  acceptProposals: z.record(z.string(), prob),
  provider: z.enum(["typesafe", "mock"]),
  model: z.string(),
});
export type StrategicAnswer = z.infer<typeof StrategicAnswerSchema>;

/** Stored with the END_TURN command so that replay never re-calls an AI provider. */
export interface FactionDecisionInput {
  factionId: string;
  answer: StrategicAnswer | null;
  fallbackReason: string | null;
}
