"use client";

import type { BuildingType } from "@echoes/game-types";
import { PLAYER_ID } from "@echoes/game-types";
import { canBuild, unitLegalActions } from "@echoes/game-engine";
import { useGame } from "@/store/gameStore";

/**
 * Map click → game intent. Shared by the 3D canvas and by automated tests, so tests
 * exercise exactly the player-facing path (client intent → server-validated command).
 */
export function handleTileClick(tile: number): void {
  const g = useGame.getState();
  const state = g.view?.state;
  if (!state) return;
  if (g.buildMode) {
    const err = canBuild(state, PLAYER_ID, g.buildMode, tile);
    if (err) {
      g.toast("error", err);
      return;
    }
    void g.send({ type: "BUILD_STRUCTURE", payload: { buildingType: g.buildMode, tile } }).then((ok) => {
      if (ok) useGame.getState().setBuildMode(null);
    });
    return;
  }
  const sel = g.selection;
  if (sel?.kind === "unit") {
    const legal = unitLegalActions(state, sel.id);
    if (legal?.attacks.some((a) => a.tile === tile)) {
      void g.send({ type: "ATTACK", payload: { unitId: sel.id, target: tile } });
      return;
    }
    if (legal?.moves.some((m) => m.tile === tile)) {
      void g.send({ type: "MOVE_UNIT", payload: { unitId: sel.id, to: tile } });
      return;
    }
  }
  const unit = state.units.find((u) => u.tile === tile);
  const settlement = state.settlements.find((s) => s.tile === tile);
  if (unit && unit.ownerId === PLAYER_ID && !(sel?.kind === "unit" && sel.id === unit.id)) g.select({ kind: "unit", id: unit.id });
  else if (settlement) g.select({ kind: "settlement", id: settlement.id });
  else if (unit) g.select({ kind: "unit", id: unit.id });
  else g.select({ kind: "tile", tile });
}

export function handleTileContext(tile: number): void {
  const g = useGame.getState();
  if (g.buildMode) return g.setBuildMode(null);
  if (g.selection?.kind === "unit") return handleTileClick(tile);
  g.select(null);
}

/** Test/debug hook (dev builds, or any build with ?debug=1). Exposes only client-side helpers. */
export function installDebugHooks(): void {
  if (typeof window === "undefined") return;
  if (process.env.NODE_ENV === "production" && !window.location.search.includes("debug=1")) return;
  (window as unknown as { __echoes?: unknown }).__echoes = {
    store: useGame,
    clickTile: handleTileClick,
    validBuildTiles: (type: BuildingType): number[] => {
      const s = useGame.getState().view?.state;
      return s ? s.map.tiles.filter((t) => t.ownerId === PLAYER_ID && canBuild(s, PLAYER_ID, type, t.i) === null).map((t) => t.i) : [];
    },
  };
}
