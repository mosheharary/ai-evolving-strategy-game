import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getLegalActions, tileLegalActions } from "@echoes/game-engine";
import { client, startHarness, type Harness } from "./setup";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h?.close();
});

describe("API + PostgreSQL + Redis", () => {
  it("health and readiness report dependencies without secrets", async () => {
    const c = client(h.app);
    expect((await c.get("/health")).status).toBe(200);
    const ready = await c.get("/ready");
    expect(ready.status).toBe(200);
    expect(ready.json.checks).toEqual({ postgres: "ok", redis: "ok" });
    expect(JSON.stringify(ready.json)).not.toMatch(/apiKey|AIza|sk-/);
  });

  it("full campaign flow: create → command → end turn → save → load → continue", async () => {
    const c = client(h.app);
    const created = await c.post("/api/games", { civilizationName: "Integration Folk", seed: "integration-1", difficulty: "governor" });
    expect(created.status).toBe(201);
    const id = created.json.gameId as string;

    const view = await c.get(`/api/games/${id}`);
    expect(view.status).toBe(200);
    expect(view.json.state.turn).toBe(1);
    expect(view.json.state.rng).toEqual([0, 0, 0, 0]); // RNG internals never sent to the browser
    const state = view.json.state;

    // Research + build via validated commands.
    const research = await c.post(`/api/games/${id}/commands`, { commandId: randomUUID(), turn: 1, type: "RESEARCH_TECH", payload: { techId: "irrigation" } });
    expect(research.status).toBe(200);
    const farmTile = state.map.tiles.find((t: { ownerId: string | null; i: number }) => t.ownerId === "player" && tileLegalActions(state, t.i).buildings.find((b) => b.type === "farm")?.error === null).i;
    const build = await c.post(`/api/games/${id}/commands`, { commandId: randomUUID(), turn: 1, type: "BUILD_STRUCTURE", payload: { buildingType: "farm", tile: farmTile } });
    expect(build.status).toBe(200);
    expect(build.json.view.state.buildings.some((b: { type: string }) => b.type === "farm")).toBe(true);

    // Illegal command is rejected with a friendly message.
    const bad = await c.post(`/api/games/${id}/commands`, { commandId: randomUUID(), turn: 1, type: "RESEARCH_TECH", payload: { techId: "ascension_project" } });
    expect(bad.status).toBe(422);
    expect(bad.json.error.message).toMatch(/Era/);

    const end = await c.post(`/api/games/${id}/end-turn`, { commandId: randomUUID() });
    expect(end.status).toBe(200);
    expect(end.json.view.state.turn).toBe(2);
    expect(end.json.report.factionActions.length).toBe(5);

    const save = await c.post(`/api/games/${id}/save`, { name: "Integration save" });
    expect(save.status).toBe(201);
    const saveId = save.json.saveId as string;
    expect(save.json).toMatchObject({ turn: 2, seed: "integration-1", civilizationName: "Integration Folk", schemaVersion: 3 });

    await c.post(`/api/games/${id}/end-turn`, { commandId: randomUUID() });
    expect((await c.get(`/api/games/${id}`)).json.state.turn).toBe(3);

    const load = await c.post(`/api/saves/${saveId}/load`);
    expect(load.status).toBe(200);
    expect((await c.get(`/api/games/${id}`)).json.state.turn).toBe(2);

    const cont = await c.post(`/api/games/${id}/end-turn`, { commandId: randomUUID() });
    expect(cont.json.view.state.turn).toBe(3);

    const verify = await c.get(`/internal/games/${id}/replay-verify`);
    expect(verify.json.ok).toBe(true);

    const saves = await c.get("/api/saves");
    expect(saves.json.saves.some((s: { autosave: boolean }) => s.autosave)).toBe(true);
    expect((await c.del(`/api/saves/${saveId}`)).status).toBe(204);
    expect((await c.get(`/api/saves/${saveId}`)).status).toBe(404);
  });

  it("commands are idempotent by commandId", async () => {
    const c = client(h.app);
    const id = (await c.post("/api/games", { civilizationName: "Idem", seed: "idem-1" })).json.gameId;
    const commandId = randomUUID();
    const body = { commandId, turn: 1, type: "DIPLOMACY_ACTION", payload: { factionId: "lumen", action: "gift", resource: "food", amount: 10 } };
    const a = await c.post(`/api/games/${id}/commands`, body);
    const b = await c.post(`/api/games/${id}/commands`, body);
    expect(a.json.duplicate).toBe(false);
    expect(b.json.duplicate).toBe(true);
    expect(b.json.view.state.factions[0].resources.food).toBe(a.json.view.state.factions[0].resources.food);
  });

  it("another player cannot read or command someone else's campaign", async () => {
    const owner = client(h.app);
    const id = (await owner.post("/api/games", { civilizationName: "Owner", seed: "owner-1" })).json.gameId;
    const intruder = client(h.app);
    await intruder.post("/api/session");
    expect((await intruder.get(`/api/games/${id}`)).status).toBe(404);
    expect((await intruder.post(`/api/games/${id}/end-turn`, { commandId: randomUUID() })).status).toBe(404);
  });

  it("rejects CSRF-style requests, oversized bodies and malformed payloads", async () => {
    const c = client(h.app);
    await c.post("/api/session");
    expect((await c.raw("POST", "/api/games", { civilizationName: "X1" }, { "x-echoes-client": "" })).status).toBe(403);
    expect((await c.raw("POST", "/api/games", { civilizationName: "X1" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await c.post("/api/games", { civilizationName: "x".repeat(40_000) })).status).toBe(413);
    expect((await c.post("/api/games", { civilizationName: "<script>" })).status).toBe(400);
  });

  it("works through AI failures (TypeSafe disabled + forced timeout): turns still complete", async () => {
    const c = client(h.app);
    const id = (await c.post("/api/games", { civilizationName: "Resilient", seed: "resilient-1" })).json.gameId;
    await c.post("/internal/ai/faults", { disableTypeSafe: true, forceTimeout: true });
    const end = await c.post(`/api/games/${id}/end-turn`, { commandId: randomUUID() });
    await c.post("/internal/ai/faults", { disableTypeSafe: false, forceTimeout: false });
    expect(end.status).toBe(200);
    expect(end.json.view.state.turn).toBe(2);
  });

  it("persists normalized entities, snapshots, command log and AI decisions", async () => {
    const c = client(h.app);
    const id = (await c.post("/api/games", { civilizationName: "Normal", seed: "normal-1" })).json.gameId;
    await c.post(`/api/games/${id}/end-turn`, { commandId: randomUUID() });
    const [factions, settlements, units, relations, snapshots, commands, decisions, history] = await Promise.all([
      h.db.faction.count({ where: { gameId: id } }), h.db.settlement.count({ where: { gameId: id } }), h.db.unit.count({ where: { gameId: id } }),
      h.db.diplomacyRelation.count({ where: { gameId: id } }), h.db.gameState.count({ where: { gameId: id } }), h.db.gameCommand.findMany({ where: { gameId: id } }),
      h.db.aIDecision.findMany({ where: { gameId: id } }), h.db.historicalEvent.count({ where: { gameId: id } }),
    ]);
    expect(factions).toBe(6);
    expect(settlements).toBeGreaterThanOrEqual(6);
    expect(units).toBeGreaterThan(0);
    expect(relations).toBe(15);
    expect(snapshots).toBe(2);
    expect(commands[0]!.type).toBe("END_TURN");
    expect(Array.isArray(commands[0]!.aiInputs)).toBe(true);
    expect(decisions).toHaveLength(5);
    expect(decisions[0]!.executionResult).not.toBeNull();
    expect(history).toBeGreaterThan(0);
    const legal = getLegalActions((await c.get(`/api/games/${id}`)).json.state);
    expect(legal.units.length).toBeGreaterThan(0);
  });

  it("server-sent events stream is authorised and opens", async () => {
    const c = client(h.app);
    const id = (await c.post("/api/games", { civilizationName: "Streamer", seed: "sse-1" })).json.gameId;
    const intruder = client(h.app);
    await intruder.post("/api/session");
    expect((await intruder.get(`/api/games/${id}/stream`)).status).toBe(404);
  });
});
