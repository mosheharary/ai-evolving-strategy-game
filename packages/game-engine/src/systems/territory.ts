import type { GameState, Settlement } from "@echoes/game-types";
import { PLAYER_ID } from "@echoes/game-types";
import { getGrid, isWater } from "@echoes/procedural-world";
import { techModifiers } from "../content/techs";
import { UNITS } from "../content/units";
import type { EngineContext } from "../context";

/** Assign unowned tiles within a settlement's radius to it. Never steals owned tiles. */
export function claimTerritory(ctx: EngineContext, s: Settlement): number[] {
  const claimed: number[] = [];
  for (const i of ctx.grid.within(s.tile, s.radius)) {
    const t = ctx.tile(i);
    if (t.ownerId === null) {
      t.ownerId = s.ownerId;
      t.settlementId = s.id;
      claimed.push(i);
    }
  }
  const center = ctx.tile(s.tile);
  center.ownerId = s.ownerId;
  center.settlementId = s.id;
  return claimed;
}

/** Re-home all territory of a settlement to a new owner (capture). */
export function transferTerritory(ctx: EngineContext, s: Settlement, newOwner: string): void {
  for (const t of ctx.state.map.tiles) {
    if (t.settlementId === s.id) t.ownerId = newOwner;
  }
  for (const b of ctx.state.buildings) {
    if (b.settlementId === s.id) b.ownerId = newOwner;
  }
}

export function releaseTerritory(ctx: EngineContext, settlementId: string): void {
  for (const t of ctx.state.map.tiles) {
    if (t.settlementId === settlementId) {
      t.settlementId = null;
      t.ownerId = null;
    }
  }
}

/** Mark tiles explored for the human player around their units, settlements and watchtowers. */
export function updatePlayerVision(ctx: EngineContext): number[] {
  const state = ctx.state;
  const player = ctx.factionOrNull(PLAYER_ID);
  const extra = techModifiers(player?.research.known ?? []).vision;
  const newly: number[] = [];
  const reveal = (center: number, radius: number): void => {
    for (const i of ctx.grid.within(center, radius)) {
      const t = ctx.tile(i);
      if (!t.explored) {
        t.explored = true;
        newly.push(i);
      }
    }
  };
  for (const u of state.units) if (u.ownerId === PLAYER_ID) reveal(u.tile, UNITS[u.type].vision + extra);
  for (const s of state.settlements) if (s.ownerId === PLAYER_ID) reveal(s.tile, s.radius + 1);
  for (const b of state.buildings) if (b.ownerId === PLAYER_ID && b.type === "watchtower" && b.turnsRemaining === 0) reveal(b.tile, 4);
  return newly;
}

/** A valid site for a new settlement: land, unowned or own, distance ≥ 4 from other settlements. */
export function isValidSettleSite(state: GameState, tileIndex: number, factionId: string): boolean {
  const t = state.map.tiles[tileIndex];
  if (!t || isWater(t.biome) || t.biome === "mountain" || t.biome === "snow") return false;
  if (t.ownerId !== null && t.ownerId !== factionId) return false;
  if (t.buildingId) return false;
  const grid = getGrid(state.map.width, state.map.height);
  return state.settlements.every((s) => grid.distance(s.tile, tileIndex) >= 4);
}

export function territoryRadius(state: GameState, factionId: string): number {
  const f = state.factions.find((x) => x.id === factionId);
  return 2 + Math.min(1, techModifiers(f?.research.known ?? []).radius);
}
