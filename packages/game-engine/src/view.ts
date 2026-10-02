import type { GameState } from "@echoes/game-types";

/**
 * Fog-of-war projection sent to the browser. The client is never the authority,
 * but it also should not receive information the player has not uncovered.
 */
export function projectForPlayer(state: GameState): GameState {
  const view = structuredClone(state);
  const explored = new Set<number>();
  for (const t of view.map.tiles) {
    if (t.explored) {
      explored.add(t.i);
      continue;
    }
    t.resource = null;
    t.poi = null;
    t.poiDiscovered = false;
    t.ownerId = null;
    t.settlementId = null;
    t.buildingId = null;
    t.pollution = 0;
    t.prosperity = 0;
  }
  view.units = view.units.filter((u) => u.ownerId === "player" || explored.has(u.tile));
  view.settlements = view.settlements.filter((s) => s.ownerId === "player" || explored.has(s.tile));
  view.buildings = view.buildings.filter((b) => b.ownerId === "player" || explored.has(b.tile));
  // Rival internals are summarised, not exposed.
  for (const f of view.factions) {
    if (f.kind === "player") continue;
    f.memories = f.memories.filter((m) => m.aboutId === "player").slice(-10);
    f.research = { known: f.research.known, current: null, progress: 0 };
  }
  view.rng = [0, 0, 0, 0];
  return view;
}
