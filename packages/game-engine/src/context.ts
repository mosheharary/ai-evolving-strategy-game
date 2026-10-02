import type {
  Building,
  DiplomacyRelation,
  Faction,
  GameState,
  HistoryEntry,
  MemoryKind,
  Resources,
  Settlement,
  Tile,
  Unit,
} from "@echoes/game-types";
import { RESOURCE_TYPES } from "@echoes/game-types";
import { getGrid, type HexGrid } from "@echoes/procedural-world";
import { SeededRandom, clamp, round } from "@echoes/shared";

/**
 * EngineContext wraps a *draft* copy of GameState for one engine operation.
 * Only engine systems receive a context; nothing outside the engine mutates state.
 * The RNG stream is restored from and written back to the state, so every
 * operation is a deterministic function of (state, input).
 */
export class EngineContext {
  readonly state: GameState;
  readonly rng: SeededRandom;
  readonly grid: HexGrid;
  private unitByTile: Map<number, Unit> | null = null;

  constructor(state: GameState) {
    this.state = state;
    this.rng = new SeededRandom(state.rng);
    this.grid = getGrid(state.map.width, state.map.height);
  }

  /** Persist RNG position back into the state. Call once at the end of the operation. */
  commit(): GameState {
    this.state.rng = [...this.rng.getState()] as [number, number, number, number];
    return this.state;
  }

  id(prefix: string): string {
    const n = this.state.nextId++;
    return `${prefix}${n}`;
  }

  tile(i: number): Tile {
    const t = this.state.map.tiles[i];
    if (!t) throw new Error(`tile ${i} out of range`);
    return t;
  }

  tileOrNull(i: number): Tile | null {
    return this.state.map.tiles[i] ?? null;
  }

  faction(id: string): Faction {
    const f = this.state.factions.find((x) => x.id === id);
    if (!f) throw new Error(`unknown faction ${id}`);
    return f;
  }

  factionOrNull(id: string | null): Faction | null {
    if (!id) return null;
    return this.state.factions.find((x) => x.id === id) ?? null;
  }

  aliveFactions(): Faction[] {
    return this.state.factions.filter((f) => f.alive);
  }

  invalidateUnits(): void {
    this.unitByTile = null;
  }

  unitAt(i: number): Unit | null {
    if (!this.unitByTile) {
      this.unitByTile = new Map();
      for (const u of this.state.units) this.unitByTile.set(u.tile, u);
    }
    return this.unitByTile.get(i) ?? null;
  }

  unit(id: string): Unit | null {
    return this.state.units.find((u) => u.id === id) ?? null;
  }

  settlementAt(i: number): Settlement | null {
    return this.state.settlements.find((s) => s.tile === i) ?? null;
  }

  settlement(id: string): Settlement | null {
    return this.state.settlements.find((s) => s.id === id) ?? null;
  }

  buildingAt(i: number): Building | null {
    const t = this.tileOrNull(i);
    if (!t?.buildingId) return null;
    return this.state.buildings.find((b) => b.id === t.buildingId) ?? null;
  }

  settlementsOf(factionId: string): Settlement[] {
    return this.state.settlements.filter((s) => s.ownerId === factionId);
  }

  unitsOf(factionId: string): Unit[] {
    return this.state.units.filter((u) => u.ownerId === factionId);
  }

  buildingsOf(settlementId: string): Building[] {
    return this.state.buildings.filter((b) => b.settlementId === settlementId);
  }

  // ---------------------------------------------------------------- resources

  canAfford(factionId: string, cost: Partial<Resources>): boolean {
    const f = this.faction(factionId);
    return RESOURCE_TYPES.every((r) => (f.resources[r] ?? 0) >= (cost[r] ?? 0));
  }

  pay(factionId: string, cost: Partial<Resources>): void {
    const f = this.faction(factionId);
    for (const r of RESOURCE_TYPES) f.resources[r] = round(f.resources[r] - (cost[r] ?? 0));
  }

  grant(factionId: string, amount: Partial<Resources>): void {
    const f = this.faction(factionId);
    for (const r of RESOURCE_TYPES) f.resources[r] = round(Math.max(0, f.resources[r] + (amount[r] ?? 0)));
  }

  // ---------------------------------------------------------------- diplomacy

  relation(a: string, b: string): DiplomacyRelation {
    const [x, y] = a < b ? [a, b] : [b, a];
    const key = `${x}|${y}`;
    let rel = this.state.relations.find((r) => r.key === key);
    if (!rel) {
      rel = {
        key, a: x, b: y, status: "peace", sinceTurn: this.state.turn, trade: false,
        sanctionsBy: [], ceasefireUntil: null, wars: 0, treaties: 0,
      };
      this.state.relations.push(rel);
      this.state.relations.sort((p, q) => p.key.localeCompare(q.key));
    }
    return rel;
  }

  atWar(a: string, b: string): boolean {
    if (a === b) return false;
    return this.relation(a, b).status === "war";
  }

  /** Apply an opinion change from `factionId` toward `towardId`, recording a memory. */
  remember(factionId: string, towardId: string, kind: MemoryKind, weight: number): void {
    const f = this.factionOrNull(factionId);
    if (!f || f.kind === "player" || factionId === towardId) return;
    const scaled = round(weight * (0.6 + f.personality.memory * 0.6), 1);
    f.opinions[towardId] = clamp(round((f.opinions[towardId] ?? 0) + scaled, 1), -100, 100);
    f.memories.push({ turn: this.state.turn, aboutId: towardId, kind, weight: scaled });
    if (f.memories.length > 40) f.memories.splice(0, f.memories.length - 40);
  }

  // ---------------------------------------------------------------- history

  history(entry: Omit<HistoryEntry, "id" | "turn" | "tags" | "effects" | "eventId" | "actorId" | "targetId" | "tile"> & Partial<HistoryEntry>): HistoryEntry {
    const full: HistoryEntry = {
      id: this.id("h"),
      turn: this.state.turn,
      actorId: null,
      targetId: null,
      tile: null,
      effects: [],
      tags: [],
      eventId: null,
      ...entry,
    };
    this.state.history.push(full);
    return full;
  }

  factionName(id: string | null): string {
    if (!id) return "no one";
    if (id === "player") return this.state.civilizationName;
    return this.factionOrNull(id)?.name ?? id;
  }
}
