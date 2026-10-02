import type { GameState, Unit } from "@echoes/game-types";
import { getGrid } from "@echoes/procedural-world";
import { MinHeap } from "@echoes/shared";
import { MOVE_COST, UNITS } from "../content/units";

/**
 * Can `unit` enter tile `i` at all (ignoring move points)?
 * - water is impassable
 * - another unit blocks the tile
 * - foreign settlements cannot be entered (they must be attacked)
 * - military units may only enter foreign territory when at war or allied
 */
export function canEnter(state: GameState, unit: Unit, i: number, occupied: ReadonlySet<number>): boolean {
  const t = state.map.tiles[i];
  if (!t) return false;
  if (!Number.isFinite(MOVE_COST[t.biome])) return false;
  if (occupied.has(i)) return false;
  const settlement = state.settlements.find((s) => s.tile === i);
  if (settlement && settlement.ownerId !== unit.ownerId) return false;
  if (t.ownerId && t.ownerId !== unit.ownerId && UNITS[unit.type].military) {
    const [a, b] = unit.ownerId < t.ownerId ? [unit.ownerId, t.ownerId] : [t.ownerId, unit.ownerId];
    const rel = state.relations.find((r) => r.key === `${a}|${b}`);
    const status = rel?.status ?? "peace";
    if (status !== "war" && status !== "alliance") return false;
  }
  return true;
}

export function occupiedTiles(state: GameState, exceptUnitId?: string): Set<number> {
  const s = new Set<number>();
  for (const u of state.units) if (u.id !== exceptUnitId) s.add(u.tile);
  return s;
}

/**
 * Dijkstra over hex tiles bounded by the unit's remaining moves.
 * Returns map tile → cost. A unit with full moves may always step into one
 * adjacent enterable tile even if its cost exceeds the move allowance.
 */
export function reachableTiles(state: GameState, unit: Unit): Map<number, number> {
  const grid = getGrid(state.map.width, state.map.height);
  const occupied = occupiedTiles(state, unit.id);
  const dist = new Map<number, number>([[unit.tile, 0]]);
  const frontier = new MinHeap();
  frontier.push(0, unit.tile);
  const fullMoves = UNITS[unit.type].moves;
  while (frontier.size > 0) {
    const [cost, cur] = frontier.pop()!;
    if (cost > (dist.get(cur) ?? Infinity)) continue;
    for (const n of grid.neighbors(cur)) {
      if (!canEnter(state, unit, n, occupied)) continue;
      const t = state.map.tiles[n]!;
      const step = MOVE_COST[t.biome];
      let nc = cost + step;
      if (nc > unit.movesLeft) {
        // First-step exception: a fresh unit can always move one hex.
        if (cur === unit.tile && unit.movesLeft === fullMoves && unit.movesLeft > 0) nc = unit.movesLeft;
        else continue;
      }
      if (nc < (dist.get(n) ?? Infinity)) {
        dist.set(n, nc);
        frontier.push(nc, n);
      }
    }
  }
  dist.delete(unit.tile);
  return dist;
}

/** Unbounded shortest path (for AI long-range navigation). Returns tiles excluding start. */
export function findPath(state: GameState, unit: Unit, target: number, maxSteps = 400): number[] | null {
  const grid = getGrid(state.map.width, state.map.height);
  const occupied = occupiedTiles(state, unit.id);
  occupied.delete(target);
  const prev = new Map<number, number>();
  const dist = new Map<number, number>([[unit.tile, 0]]);
  const frontier = new MinHeap();
  frontier.push(0, unit.tile);
  let steps = 0;
  while (frontier.size > 0 && steps++ < maxSteps * 6) {
    const [cost, cur] = frontier.pop()!;
    if (cur === target) break;
    if (cost > (dist.get(cur) ?? Infinity)) continue;
    for (const n of grid.neighbors(cur)) {
      if (n !== target && !canEnter(state, unit, n, occupied)) continue;
      const t = state.map.tiles[n]!;
      const step = MOVE_COST[t.biome];
      if (!Number.isFinite(step)) continue;
      const nc = cost + step;
      if (nc < (dist.get(n) ?? Infinity)) {
        dist.set(n, nc);
        prev.set(n, cur);
        frontier.push(nc, n);
      }
    }
  }
  if (!prev.has(target)) return null;
  const path: number[] = [];
  let c = target;
  while (c !== unit.tile) {
    path.unshift(c);
    const p = prev.get(c);
    if (p === undefined) return null;
    c = p;
  }
  return path;
}
