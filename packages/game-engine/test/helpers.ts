import { randomUUID } from "node:crypto";
import type { CommandBody, GameCommand, GameState } from "@echoes/game-types";
import { createGame, executeCommand } from "../src";

export function newGame(seed = "test-seed", opts: Partial<Parameters<typeof createGame>[0]> = {}): GameState {
  return createGame({ gameId: "gtest", seed, civilizationName: "Testers", ...opts });
}

export function cmd(state: GameState, body: CommandBody, commandId: string = randomUUID()): GameCommand {
  return { ...body, commandId, gameId: state.gameId, playerId: "player", turn: state.turn } as GameCommand;
}

export function run(state: GameState, body: CommandBody) {
  return executeCommand(state, cmd(state, body));
}

export const playerCapital = (s: GameState) => s.settlements.find((x) => x.ownerId === "player" && x.isCapital)!;
export const playerUnit = (s: GameState, type: string) => s.units.find((u) => u.ownerId === "player" && u.type === type)!;
