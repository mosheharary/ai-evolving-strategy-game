import type { DecisionRequest, FactionDecisionInput, GameCommand, GameState, TurnReport } from "@echoes/game-types";
import { executeCommand, type CommandResult } from "./commands";
import { EngineContext } from "./context";
import { createGame, type CreateGameOptions } from "./create";
import { calculateStateHash } from "./hash";
import { getLegalActions, type LegalActions } from "./legal";
import { evolveWorld, type EvolutionResult } from "./systems/evolution";
import { completeTurn, prepareTurn } from "./turn";

/**
 * GameEngine — the pure, deterministic domain simulation. It has no dependency on
 * React, Three.js, PostgreSQL, Google or TypeSafe. Adapters around it provide
 * persistence and AI decisions; the engine alone defines reality.
 */
export class GameEngine {
  private state: GameState;

  private constructor(state: GameState) {
    this.state = state;
  }

  static createGame(opts: CreateGameOptions): GameEngine {
    return new GameEngine(createGame(opts));
  }

  static fromState(state: GameState): GameEngine {
    return new GameEngine(structuredClone(state));
  }

  getState(): Readonly<GameState> {
    return this.state;
  }

  executeCommand(command: GameCommand): CommandResult {
    const r = executeCommand(this.state, command);
    if (r.ok) this.state = r.state;
    return r;
  }

  /** RESOLUTION phase; returns the decision requests for AI factions. */
  prepareTurn(): DecisionRequest[] {
    const p = prepareTurn(this.state);
    this.state = p.state;
    return p.requests;
  }

  /** FACTION_AI → … → TURN_COMPLETE using supplied (live or stored) AI decisions. */
  resolveTurn(inputs: readonly FactionDecisionInput[]): TurnReport {
    const c = completeTurn(this.state, inputs);
    this.state = c.state;
    return c.report;
  }

  /** Convenience for tests/replay: full turn with the given (possibly empty) decisions. */
  endTurn(inputs: readonly FactionDecisionInput[] = []): TurnReport {
    this.prepareTurn();
    return this.resolveTurn(inputs);
  }

  /** Run only the world-evolution step (exposed for testing and tooling). */
  evolveWorld(): EvolutionResult {
    const draft = structuredClone(this.state);
    const ctx = new EngineContext(draft);
    const r = evolveWorld(ctx);
    this.state = ctx.commit();
    return r;
  }

  getLegalActions(): LegalActions {
    return getLegalActions(this.state);
  }

  calculateStateHash(): string {
    return calculateStateHash(this.state);
  }
}
