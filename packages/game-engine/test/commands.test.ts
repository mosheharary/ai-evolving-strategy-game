import { describe, expect, it } from "vitest";
import { CommandRequest, PLAYER_ID } from "@echoes/game-types";
import { executeCommand, projectForPlayer } from "../src";
import { cmd, newGame, playerCapital, playerUnit, run } from "./helpers";

describe("command validation", () => {
  it("rejects stale commands from a previous turn", () => {
    const s = newGame();
    const c = { ...cmd(s, { type: "FORTIFY_UNIT", payload: { unitId: playerUnit(s, "guard").id } }), turn: 0 };
    expect(executeCommand(s, c).error).toMatch(/Stale/);
  });

  it("schema rejects attempts to submit resource values or unknown fields", () => {
    const base = { commandId: crypto.randomUUID(), turn: 1 };
    expect(CommandRequest.safeParse({ ...base, type: "BUILD_STRUCTURE", payload: { buildingType: "farm", tile: 5, cost: 0 } }).success).toBe(false);
    expect(CommandRequest.safeParse({ ...base, type: "SET_RESOURCES", payload: { food: 9999 } }).success).toBe(false);
    expect(CommandRequest.safeParse({ ...base, type: "RESEARCH_TECH", payload: { techId: "irrigation" } }).success).toBe(true);
  });

  it("cannot command another faction's units", () => {
    const s = newGame();
    const enemy = s.units.find((u) => u.ownerId !== PLAYER_ID)!;
    expect(run(s, { type: "FORTIFY_UNIT", payload: { unitId: enemy.id } }).ok).toBe(false);
  });

  it("cannot build outside territory or on water", () => {
    const s = newGame();
    const outside = s.map.tiles.find((t) => t.ownerId === null && t.biome === "plains")!;
    expect(run(s, { type: "BUILD_STRUCTURE", payload: { buildingType: "farm", tile: outside.i } }).ok).toBe(false);
    const water = s.map.tiles.find((t) => t.biome === "ocean")!;
    expect(run(s, { type: "BUILD_STRUCTURE", payload: { buildingType: "farm", tile: water.i } }).error).toMatch(/water/);
  });

  it("founding a settlement consumes the worker and claims territory", () => {
    const s = newGame("found");
    const worker = playerUnit(s, "worker");
    const cap = playerCapital(s);
    // Teleport the worker to a valid distant site for the test.
    const site = s.map.tiles.find((t) => t.ownerId === null && (t.biome === "plains" || t.biome === "grassland") && Math.abs(t.col - (cap.tile % 48)) + Math.abs(t.row - Math.floor(cap.tile / 48)) > 8 && !s.units.some((u) => u.tile === t.i))!;
    worker.tile = site.i;
    const r = run(s, { type: "BUILD_STRUCTURE", payload: { buildingType: "settlement_center", tile: site.i, workerId: worker.id } });
    expect(r.ok).toBe(true);
    expect(r.state.settlements.filter((x) => x.ownerId === PLAYER_ID)).toHaveLength(2);
    expect(r.state.units.some((u) => u.id === worker.id)).toBe(false);
    expect(r.state.map.tiles[site.i]!.ownerId).toBe(PLAYER_ID);
  });

  it("player view hides unexplored information", () => {
    const s = newGame();
    const v = projectForPlayer(s);
    const hidden = v.map.tiles.filter((t) => !t.explored);
    expect(hidden.length).toBeGreaterThan(1000);
    expect(hidden.every((t) => t.resource === null && t.ownerId === null && t.poi === null)).toBe(true);
    expect(v.units.every((u) => u.ownerId === PLAYER_ID || v.map.tiles[u.tile]!.explored)).toBe(true);
  });
});
