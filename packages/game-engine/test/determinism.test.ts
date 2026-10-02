import { describe, expect, it } from "vitest";
import type { FactionDecisionInput, GameCommand, GameState, StrategicAnswer } from "@echoes/game-types";
import { buildDecisionRequests, calculateStateHash, completeTurn, createGame, executeCommand, getLegalActions, prepareTurn, replay, type LoggedCommand } from "../src";

/**
 * MANDATORY ACCEPTANCE TEST: same seed + same commands + same stored AI decisions
 * ⇒ identical authoritative state hash. Also: replay never needs AI providers.
 */

function syntheticAnswers(state: GameState, turn: number): FactionDecisionInput[] {
  // Stand-in for stored TypeSafe answers: varied confidences exercise all policy branches.
  return buildDecisionRequests(state).map((r, i) => {
    const choice = r.candidates.strategicActions[(turn + i) % r.candidates.strategicActions.length]!;
    const conf = [0.92, 0.66, 0.4][(turn + i) % 3]!;
    const answer: StrategicAnswer = {
      factionId: r.factionId,
      strategicAction: { choice, confidence: conf, probabilities: Object.fromEntries(r.candidates.strategicActions.map((a) => [a, a === choice ? conf : (1 - conf) / Math.max(1, r.candidates.strategicActions.length - 1)])) },
      stance: r.candidates.stances.length ? { choice: r.candidates.stances[turn % r.candidates.stances.length]!, confidence: 0.85, probabilities: {} } : null,
      threatLevel: { score: (turn % 5), confidence: 0.7 },
      foodUrgency: { score: 1, confidence: 0.7 },
      shouldAttack: { probability: (turn % 4) / 4 },
      acceptProposals: Object.fromEntries(r.candidates.proposals.map((p) => [p.id, 0.9])),
      provider: "typesafe",
      model: "jev-1.13.0",
    };
    return { factionId: r.factionId, answer: i % 4 === 3 ? null : answer, fallbackReason: i % 4 === 3 ? "typesafe_timeout" : null };
  });
}

function playScript(seed: string, turns: number): { state: GameState; log: LoggedCommand[] } {
  let state = createGame({ gameId: "gdet", seed, civilizationName: "Determinists", difficulty: "warlord" });
  const log: LoggedCommand[] = [];
  let seq = 0;
  for (let t = 0; t < turns; t++) {
    const legal = getLegalActions(state);
    const commands: GameCommand[] = [];
    if (legal.research[0] && !state.factions[0]!.research.current) commands.push({ type: "RESEARCH_TECH", payload: { techId: legal.research[t % legal.research.length]! }, commandId: `c${t}a`, gameId: "gdet", playerId: "player", turn: state.turn } as GameCommand);
    const mover = legal.units.find((u) => u.moves.length > 0);
    if (mover) commands.push({ type: "MOVE_UNIT", payload: { unitId: mover.unitId, to: mover.moves[t % mover.moves.length]!.tile }, commandId: `c${t}b`, gameId: "gdet", playerId: "player", turn: state.turn } as GameCommand);
    for (const c of commands) {
      const r = executeCommand(state, c);
      if (r.ok) {
        state = r.state;
        log.push({ seq: ++seq, command: c, aiInputs: null });
      }
    }
    const prepared = prepareTurn(state);
    const inputs = syntheticAnswers(prepared.state, t);
    state = completeTurn(prepared.state, inputs).state;
    log.push({ seq: ++seq, command: { type: "END_TURN", payload: {}, commandId: `e${t}`, gameId: "gdet", playerId: "player", turn: prepared.state.turn } as GameCommand, aiInputs: inputs });
  }
  return { state, log };
}

describe("deterministic simulation", () => {
  it("same seed + same commands + same stored AI decisions → identical state hash", () => {
    const a = playScript("determinism-1", 15);
    const b = playScript("determinism-1", 15);
    expect(calculateStateHash(a.state)).toBe(calculateStateHash(b.state));
    expect(a.state.turn).toBe(16);
  });

  it("replaying the command log from the initial state reproduces the hash exactly", () => {
    const { state, log } = playScript("determinism-2", 12);
    const initial = createGame({ gameId: "gdet", seed: "determinism-2", civilizationName: "Determinists", difficulty: "warlord" });
    const r = replay(initial, log);
    expect(r.rejected).toEqual([]);
    expect(r.stateHash).toBe(calculateStateHash(state));
  });

  it("different stored AI decisions produce a different world (AI matters, but only via inputs)", () => {
    const { log } = playScript("determinism-3", 6);
    const initial = createGame({ gameId: "gdet", seed: "determinism-3", civilizationName: "Determinists", difficulty: "warlord" });
    const altered = log.map((e) => (e.aiInputs ? { ...e, aiInputs: e.aiInputs.map((i) => ({ ...i, answer: null, fallbackReason: "altered" })) } : e));
    expect(replay(initial, altered).stateHash).not.toBe(replay(initial, log).stateHash);
  });

  it("engine operations never mutate their input state", () => {
    const s = createGame({ gameId: "g", seed: "pure", civilizationName: "Pure" });
    const h = calculateStateHash(s);
    const prepared = prepareTurn(s);
    completeTurn(prepared.state, []);
    expect(calculateStateHash(s)).toBe(h);
  });
});
