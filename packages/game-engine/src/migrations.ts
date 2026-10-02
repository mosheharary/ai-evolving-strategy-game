import type { GameState } from "@echoes/game-types";
import { SAVE_SCHEMA_VERSION } from "@echoes/game-types";

/**
 * Versioned save migrations. Each step upgrades exactly one version.
 *   v1 → v2: adds medium-term `trends` and director pacing `world.calm`.
 *   v2 → v3: adds diplomatic `proposals`, per-faction `lastDecisions`, tile `prosperity`.
 * Unknown or future versions are rejected — never silently corrupted.
 */

export class SaveMigrationError extends Error {}

type Raw = Record<string, unknown>;
type Migration = (s: Raw) => Raw;

const MIGRATIONS: Record<number, Migration> = {
  1: (s) => {
    const world = (s.world ?? {}) as Raw;
    return { ...s, schemaVersion: 2, trends: s.trends ?? [], world: { ...world, calm: world.calm ?? 0 } };
  },
  2: (s) => {
    const map = s.map as { tiles?: Raw[] } | undefined;
    const tiles = (map?.tiles ?? []).map((t) => ({ ...t, prosperity: t.prosperity ?? 0 }));
    return { ...s, schemaVersion: 3, proposals: s.proposals ?? [], lastDecisions: s.lastDecisions ?? {}, map: { ...map, tiles } };
  },
};

export function migrateSave(raw: unknown): { state: GameState; migratedFrom: number | null } {
  if (!raw || typeof raw !== "object") throw new SaveMigrationError("Save data is not an object.");
  let s = raw as Raw;
  const original = s.schemaVersion;
  if (typeof original !== "number" || !Number.isInteger(original) || original < 1) {
    throw new SaveMigrationError("Save is missing a valid schemaVersion.");
  }
  if (original > SAVE_SCHEMA_VERSION) {
    throw new SaveMigrationError(`Save schema v${original} is newer than this server (v${SAVE_SCHEMA_VERSION}).`);
  }
  let v = original;
  while (v < SAVE_SCHEMA_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new SaveMigrationError(`No migration from v${v}.`);
    s = step(s);
    if (s.schemaVersion !== v + 1) throw new SaveMigrationError(`Migration v${v} produced v${String(s.schemaVersion)}.`);
    v += 1;
  }
  assertShape(s);
  return { state: s as unknown as GameState, migratedFrom: original === SAVE_SCHEMA_VERSION ? null : original };
}

function assertShape(s: Raw): void {
  const required = ["gameId", "seed", "turn", "map", "factions", "settlements", "units", "buildings", "relations", "history", "rng", "world", "config", "victory"];
  for (const k of required) if (!(k in s)) throw new SaveMigrationError(`Save is missing "${k}".`);
  const map = s.map as { tiles?: unknown[]; width?: number; height?: number };
  if (!Array.isArray(map.tiles) || map.tiles.length !== (map.width ?? 0) * (map.height ?? 0)) throw new SaveMigrationError("Save map is corrupt.");
  if (!Array.isArray(s.rng) || (s.rng as unknown[]).length !== 4) throw new SaveMigrationError("Save RNG state is corrupt.");
}
