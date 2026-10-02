import type { BuildingType, GameState, UnitType } from "@echoes/game-types";
import { BUILDING_TYPES, PLAYER_ID, UNIT_TYPES } from "@echoes/game-types";
import { getGrid } from "@echoes/procedural-world";
import { UNITS } from "./content/units";
import { canAttack, previewAttack, type CombatPreview } from "./systems/combat";
import { canBuild, canTrain } from "./systems/construction";
import { reachableTiles } from "./systems/movement";
import { availableTechs } from "./systems/research";

export interface UnitLegalActions {
  unitId: string;
  moves: { tile: number; cost: number }[];
  attacks: { tile: number; preview: CombatPreview | null }[];
  canFound: boolean;
  foundError: string | null;
  canGather: boolean;
  canFortify: boolean;
}

export interface TileLegalActions {
  tile: number;
  buildings: { type: BuildingType; error: string | null }[];
}

export interface LegalActions {
  units: UnitLegalActions[];
  research: string[];
  training: { settlementId: string; unitType: UnitType; error: string | null }[];
}

export function unitLegalActions(state: GameState, unitId: string): UnitLegalActions | null {
  const u = state.units.find((x) => x.id === unitId && x.ownerId === PLAYER_ID);
  if (!u) return null;
  const grid = getGrid(state.map.width, state.map.height);
  const moves = [...reachableTiles(state, u).entries()].map(([tile, cost]) => ({ tile, cost })).sort((a, b) => a.tile - b.tile);
  const range = Math.max(1, UNITS[u.type].range);
  const attacks = grid
    .within(u.tile, range)
    .filter((i) => i !== u.tile && canAttack(state, u, i) === null)
    .map((tile) => ({ tile, preview: previewAttack(state, u, tile) }));
  const foundError = u.type === "worker" ? canBuild(state, PLAYER_ID, "settlement_center", u.tile, u.id) : "Only Workers can found settlements.";
  const t = state.map.tiles[u.tile];
  const canGather = u.type === "worker" && u.movesLeft > 0 && !!t && (!!t.resource || t.forest >= 10 || t.fertility > 30 || t.biome === "hills" || t.biome === "desert");
  return { unitId, moves, attacks, canFound: foundError === null, foundError, canGather, canFortify: UNITS[u.type].military && u.movesLeft > 0 };
}

export function tileLegalActions(state: GameState, tile: number): TileLegalActions {
  return {
    tile,
    buildings: BUILDING_TYPES.filter((b) => b !== "settlement_center").map((type) => ({ type, error: canBuild(state, PLAYER_ID, type, tile) })),
  };
}

/** Everything the player may legally do right now — used by the UI and the server. */
export function getLegalActions(state: GameState): LegalActions {
  const units = state.units.filter((u) => u.ownerId === PLAYER_ID).map((u) => unitLegalActions(state, u.id)!).filter(Boolean);
  const training = state.settlements
    .filter((s) => s.ownerId === PLAYER_ID)
    .flatMap((s) => UNIT_TYPES.map((unitType) => ({ settlementId: s.id, unitType, error: canTrain(state, PLAYER_ID, s.id, unitType) })));
  return { units, research: availableTechs(state, PLAYER_ID).map((t) => t.id), training };
}
