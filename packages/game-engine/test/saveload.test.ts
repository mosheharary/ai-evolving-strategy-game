import { describe, expect, it } from "vitest";
import { SAVE_SCHEMA_VERSION } from "@echoes/game-types";
import { calculateStateHash, migrateSave, SaveMigrationError } from "../src";
import { newGame } from "./helpers";

describe("versioned saves", () => {
  it("current-version saves round-trip unchanged", () => {
    const s = newGame();
    const { state, migratedFrom } = migrateSave(JSON.parse(JSON.stringify(s)));
    expect(migratedFrom).toBeNull();
    expect(calculateStateHash(state)).toBe(calculateStateHash(s));
  });

  it("migrates a v1 save through the pipeline to the current schema", () => {
    const s = JSON.parse(JSON.stringify(newGame())) as Record<string, unknown>;
    s.schemaVersion = 1;
    delete s.trends;
    delete s.proposals;
    delete s.lastDecisions;
    delete (s.world as Record<string, unknown>).calm;
    for (const t of (s.map as { tiles: Record<string, unknown>[] }).tiles) delete t.prosperity;
    const { state, migratedFrom } = migrateSave(s);
    expect(migratedFrom).toBe(1);
    expect(state.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(state.trends).toEqual([]);
    expect(state.proposals).toEqual([]);
    expect(state.world.calm).toBe(0);
    expect(state.map.tiles.every((t) => t.prosperity === 0)).toBe(true);
  });

  it("refuses future or corrupt saves instead of silently corrupting them", () => {
    const s = JSON.parse(JSON.stringify(newGame())) as Record<string, unknown>;
    expect(() => migrateSave({ ...s, schemaVersion: 99 })).toThrow(SaveMigrationError);
    expect(() => migrateSave({ ...s, schemaVersion: undefined })).toThrow(SaveMigrationError);
    expect(() => migrateSave({ ...s, map: { width: 48, height: 48, tiles: [] } })).toThrow(SaveMigrationError);
    expect(() => migrateSave("nope")).toThrow(SaveMigrationError);
  });
});
