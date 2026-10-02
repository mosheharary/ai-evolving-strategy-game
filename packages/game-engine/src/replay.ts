import type { FactionDecisionInput, GameCommand, GameState } from "@echoes/game-types";
import { executeCommand } from "./commands";
import { calculateStateHash } from "./hash";
import { completeTurn, prepareTurn } from "./turn";

/**
 * A logged command. END_TURN entries carry the AI decisions that were used at the
 * time, so replay NEVER re-calls an AI provider.
 */
export interface LoggedCommand {
  seq: number;
  command: GameCommand;
  aiInputs: FactionDecisionInput[] | null;
}

export interface ReplayResult {
  state: GameState;
  stateHash: string;
  applied: number;
  rejected: { seq: number; error: string }[];
}

export function replay(initial: GameState, log: readonly LoggedCommand[]): ReplayResult {
  let state = initial;
  const rejected: ReplayResult["rejected"] = [];
  let applied = 0;
  for (const entry of [...log].sort((a, b) => a.seq - b.seq)) {
    if (entry.command.type === "END_TURN") {
      const prepared = prepareTurn(state);
      state = completeTurn(prepared.state, entry.aiInputs ?? []).state;
      applied++;
      continue;
    }
    const r = executeCommand(state, entry.command);
    if (r.ok) {
      state = r.state;
      applied++;
    } else rejected.push({ seq: entry.seq, error: r.error ?? "rejected" });
  }
  return { state, stateHash: calculateStateHash(state), applied, rejected };
}
