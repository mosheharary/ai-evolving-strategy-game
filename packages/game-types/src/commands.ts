import { z } from "zod";
import { BUILDING_TYPES, RESOURCE_TYPES, UNIT_TYPES } from "./state";

/**
 * Client → server commands. The client only expresses *intent*; it never sends
 * resource values, unit stats or outcomes. The server validates each command
 * against the authoritative state before the GameEngine executes it.
 */

const tileIndex = z.number().int().min(0).max(100_000);
const entityId = z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i);

export const MoveUnitPayload = z.object({ unitId: entityId, to: tileIndex }).strict();
export const AttackPayload = z.object({ unitId: entityId, target: tileIndex, raze: z.boolean().optional() }).strict();
export const BuildStructurePayload = z
  .object({ buildingType: z.enum(BUILDING_TYPES), tile: tileIndex, workerId: entityId.optional() })
  .strict();
export const GatherResourcePayload = z.object({ unitId: entityId }).strict();
export const TrainUnitPayload = z.object({ settlementId: entityId, unitType: z.enum(UNIT_TYPES) }).strict();
export const ResearchTechPayload = z.object({ techId: entityId }).strict();
export const DeclareTradePayload = z.object({ factionId: entityId }).strict();
export const DIPLOMACY_ACTIONS = [
  "gift",
  "propose_alliance",
  "propose_peace",
  "propose_ceasefire",
  "declare_war",
  "sanction",
  "lift_sanction",
  "espionage",
] as const;
export type DiplomacyActionType = (typeof DIPLOMACY_ACTIONS)[number];
export const DiplomacyActionPayload = z
  .object({
    factionId: entityId,
    action: z.enum(DIPLOMACY_ACTIONS),
    resource: z.enum(RESOURCE_TYPES).optional(),
    amount: z.number().int().min(1).max(10_000).optional(),
  })
  .strict();
export const ClaimTerritoryPayload = z.object({ tile: tileIndex }).strict();
export const RespondProposalPayload = z.object({ proposalId: entityId, accept: z.boolean() }).strict();
export const FortifyUnitPayload = z.object({ unitId: entityId }).strict();
export const EndTurnPayload = z.object({}).strict();

export const CommandBody = z.discriminatedUnion("type", [
  z.object({ type: z.literal("MOVE_UNIT"), payload: MoveUnitPayload }),
  z.object({ type: z.literal("ATTACK"), payload: AttackPayload }),
  z.object({ type: z.literal("BUILD_STRUCTURE"), payload: BuildStructurePayload }),
  z.object({ type: z.literal("GATHER_RESOURCE"), payload: GatherResourcePayload }),
  z.object({ type: z.literal("TRAIN_UNIT"), payload: TrainUnitPayload }),
  z.object({ type: z.literal("RESEARCH_TECH"), payload: ResearchTechPayload }),
  z.object({ type: z.literal("DECLARE_TRADE"), payload: DeclareTradePayload }),
  z.object({ type: z.literal("DIPLOMACY_ACTION"), payload: DiplomacyActionPayload }),
  z.object({ type: z.literal("CLAIM_TERRITORY"), payload: ClaimTerritoryPayload }),
  z.object({ type: z.literal("FORTIFY_UNIT"), payload: FortifyUnitPayload }),
  z.object({ type: z.literal("RESPOND_PROPOSAL"), payload: RespondProposalPayload }),
  z.object({ type: z.literal("END_TURN"), payload: EndTurnPayload }),
]);
export type CommandBody = z.infer<typeof CommandBody>;
export type CommandType = CommandBody["type"];

/** Envelope submitted over the API. gameId/playerId are bound server-side from the route/session. */
export const CommandRequest = z.intersection(
  z.object({
    commandId: z.string().uuid(),
    turn: z.number().int().min(1).max(10_000),
  }),
  CommandBody,
);
export type CommandRequest = z.infer<typeof CommandRequest>;

export type GameCommand = CommandBody & {
  commandId: string;
  gameId: string;
  playerId: string;
  turn: number;
};

export type MoveCommand = Extract<GameCommand, { type: "MOVE_UNIT" }>;
export type AttackCommand = Extract<GameCommand, { type: "ATTACK" }>;
export type BuildCommand = Extract<GameCommand, { type: "BUILD_STRUCTURE" }>;
export type ResearchCommand = Extract<GameCommand, { type: "RESEARCH_TECH" }>;
export type DiplomacyCommand = Extract<GameCommand, { type: "DIPLOMACY_ACTION" }>;
export type EndTurnCommand = Extract<GameCommand, { type: "END_TURN" }>;

export const NewGameRequest = z
  .object({
    civilizationName: z.string().trim().min(2).max(40).regex(/^[\p{L}\p{N} '-]+$/u),
    gameName: z.string().trim().min(1).max(60).optional(),
    difficulty: z.enum(["settler", "governor", "warlord"]).default("governor"),
    seed: z
      .string()
      .trim()
      .max(40)
      .regex(/^[A-Za-z0-9-]*$/)
      .optional(),
    startPreference: z.enum(["balanced", "coastal", "river", "highlands", "forest"]).default("balanced"),
  })
  .strict();
export type NewGameRequest = z.infer<typeof NewGameRequest>;
