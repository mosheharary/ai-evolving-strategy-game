import { randomUUID } from "node:crypto";
import { completeTurn, createGame, executeCommand, getLegalActions, prepareTurn, tileLegalActions } from "@echoes/game-engine";
import type { GameCommand, GameState } from "@echoes/game-types";
import { PLAYER_ID } from "@echoes/game-types";
import { createDb } from "../src/client";
import { GameRepository, PlayerRepository } from "../src/repositories";

/**
 * Seed: a demo campaign advanced a dozen turns through the real command log
 * (player orders + END_TURN with deterministic AI), so the world already has
 * history, evolution and faction behaviour to explore. Idempotent.
 */
const DEMO_GAME_ID = "g00000000000de300";

async function main(): Promise<void> {
  const db = createDb(process.env.DATABASE_URL ?? "postgresql://echoes:echoes@localhost:5432/echoes");
  const games = new GameRepository(db);
  try {
    if (await db.game.findUnique({ where: { id: DEMO_GAME_ID } })) {
      console.log(JSON.stringify({ level: "info", msg: "seed: demo campaign already present", gameId: DEMO_GAME_ID }));
      return;
    }
    const playerId = await new PlayerRepository(db).ensure(null);
    let state: GameState = createGame({ gameId: DEMO_GAME_ID, seed: "demo-frontier-1", civilizationName: "The Hearthborn", difficulty: "governor", startPreference: "river" });
    await games.create(playerId, state, "Demo: The Hearthborn of the River Valley");
    let seq = 0;
    const apply = async (body: Omit<GameCommand, "commandId" | "gameId" | "playerId" | "turn">): Promise<void> => {
      const cmd = { ...body, commandId: randomUUID(), gameId: DEMO_GAME_ID, playerId: PLAYER_ID, turn: state.turn } as GameCommand;
      const r = executeCommand(state, cmd);
      if (!r.ok) return;
      state = r.state;
      seq = await games.appendCommand({ gameId: DEMO_GAME_ID, expectedSeq: seq, command: cmd, aiInputs: null, state, snapshot: false });
    };
    for (let t = 0; t < 12; t++) {
      const legal = getLegalActions(state);
      if (!state.factions.find((f) => f.id === PLAYER_ID)!.research.current && legal.research[0]) {
        await apply({ type: "RESEARCH_TECH", payload: { techId: legal.research.includes("irrigation") ? "irrigation" : legal.research[0] } } as never);
      }
      // Build one farm / lumber camp per turn where legal.
      const capital = state.settlements.find((s) => s.ownerId === PLAYER_ID)!;
      const territory = state.map.tiles.filter((x) => x.settlementId === capital.id).map((x) => x.i);
      for (const type of t % 2 === 0 ? (["farm", "lumber_camp"] as const) : (["lumber_camp", "farm"] as const)) {
        const tile = territory.find((i) => tileLegalActions(state, i).buildings.find((b) => b.type === type)?.error === null);
        if (tile !== undefined) {
          await apply({ type: "BUILD_STRUCTURE", payload: { buildingType: type, tile } } as never);
          break;
        }
      }
      // Scout explores.
      const scout = state.units.find((u) => u.ownerId === PLAYER_ID && u.type === "scout");
      const moves = scout ? legal.units.find((u) => u.unitId === scout.id)?.moves ?? [] : [];
      const far = moves.sort((a, b) => b.cost - a.cost || a.tile - b.tile)[t % Math.max(1, moves.length)];
      if (scout && far) await apply({ type: "MOVE_UNIT", payload: { unitId: scout.id, to: far.tile } } as never);
      // End turn with deterministic AI (stored as empty decisions → engine fallback policy).
      const prepared = prepareTurn(state);
      const inputs = prepared.requests.map((r) => ({ factionId: r.factionId, answer: null, fallbackReason: "seed_deterministic" }));
      const completed = completeTurn(prepared.state, inputs);
      const cmd: GameCommand = { commandId: randomUUID(), gameId: DEMO_GAME_ID, playerId: PLAYER_ID, turn: state.turn, type: "END_TURN", payload: {} };
      state = completed.state;
      seq = await games.appendCommand({ gameId: DEMO_GAME_ID, expectedSeq: seq, command: cmd, aiInputs: inputs, state, snapshot: true });
    }
    console.log(JSON.stringify({ level: "info", msg: "seed: demo campaign created", gameId: DEMO_GAME_ID, turn: state.turn, commands: seq }));
  } finally {
    await db.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(JSON.stringify({ level: "error", msg: "seed failed", err: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
});
