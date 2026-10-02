import type { GameState, VictoryType } from "@echoes/game-types";
import { PLAYER_ID } from "@echoes/game-types";
import { isWater } from "@echoes/procedural-world";
import { clamp, round } from "@echoes/shared";
import { ERA_FORCE_AFTER, ERA_NAMES, ERA_REQUIREMENTS } from "../content/factions";
import { TECHS } from "../content/techs";
import type { EngineContext } from "../context";
import { createEvent } from "./events";

/** Deterministic victory progress (0..1) for each path. Never depends on AI prose. */
export function victoryProgress(state: GameState): Record<VictoryType, number> {
  const player = state.factions.find((f) => f.id === PLAYER_ID);
  const known = new Set(player?.research.known ?? []);
  const totalSettlements = state.settlements.length;
  const mine = state.settlements.filter((s) => s.ownerId === PLAYER_ID);
  const pop = mine.reduce((a, s) => a + s.population, 0);
  const tradeLinks = state.relations.filter((r) => r.trade && (r.a === PLAYER_ID || r.b === PLAYER_ID)).length;
  const prosperityTiles = state.map.tiles.filter((t) => t.ownerId === PLAYER_ID).reduce((a, t) => a + t.prosperity, 0);
  const aiAlive = state.factions.filter((f) => f.kind === "ai" && f.alive).length;
  const alliances = state.relations.filter((r) => r.status === "alliance" && (r.a === PLAYER_ID || r.b === PLAYER_ID)).length;
  const land = state.map.tiles.filter((t) => !isWater(t.biome));
  const habitat = land.reduce((a, t) => a + t.habitat, 0) / Math.max(1, land.length);
  const scienceTechs = TECHS.filter((t) => t.branch === "science");

  const dominion = aiAlive === 0 ? 1 : clamp(mine.length / Math.max(1, Math.ceil(totalSettlements * 0.6)), 0, 1);
  const prosperityScore = pop + prosperityTiles / 25 + tradeLinks * 10 + (player?.resources.influence ?? 0) / 10;
  const prosperity = Math.min(clamp(prosperityScore / 160, 0, 1), clamp(mine.length / 6, 0, 1) * 0.5 + 0.5);
  const ascension = known.has("ascension_project") ? 1 : clamp(scienceTechs.filter((t) => known.has(t.id)).length / (scienceTechs.length + 1), 0, 0.99);
  const restoration = clamp(
    (known.has("gaia_accord") ? 0.4 : 0) + clamp(1 - state.world.globalPollution / 15, 0, 1) * 0.2 + clamp(habitat / 75, 0, 1) * 0.2 + clamp(state.world.forestCover / 0.25, 0, 1) * 0.2,
    0, known.has("gaia_accord") ? 1 : 0.95,
  );
  const federation = clamp((known.has("federation_charter") ? 0.4 : 0) + (alliances / 3) * 0.6, 0, known.has("federation_charter") ? 1 : 0.95);
  return {
    dominion: round(dominion, 3),
    prosperity: round(prosperity, 3),
    ascension: round(ascension, 3),
    restoration: round(restoration, 3),
    federation: round(federation, 3),
  };
}

export function checkVictory(ctx: EngineContext): string[] {
  const state = ctx.state;
  const lines: string[] = [];
  state.victory.progress = victoryProgress(state);
  if (state.victory.winner) return lines;
  const playerSettlements = ctx.settlementsOf(PLAYER_ID).length;
  const playerWorkers = ctx.unitsOf(PLAYER_ID).filter((u) => u.type === "worker").length;
  if (playerSettlements === 0 && playerWorkers === 0) {
    state.victory.winner = { factionId: "none", type: "defeat", turn: state.turn };
    lines.push("Your civilization has fallen.");
    ctx.history({ type: "VICTORY", importance: 3, actorId: null, targetId: PLAYER_ID, summary: `${state.civilizationName} has fallen. The frontier forgets no one, but it moves on.`, tags: ["endgame"] });
    return lines;
  }
  const order: VictoryType[] = ["ascension", "restoration", "federation", "dominion", "prosperity"];
  for (const v of order) {
    if (state.victory.progress[v] >= 1) {
      state.victory.winner = { factionId: PLAYER_ID, type: v, turn: state.turn };
      lines.push(`Victory: ${v}!`);
      ctx.history({ type: "VICTORY", importance: 3, actorId: PLAYER_ID, targetId: null, summary: `${state.civilizationName} achieved a ${v} victory in year ${state.turn}.`, tags: ["endgame", `victory:${v}`] });
      return lines;
    }
  }
  if (state.turn >= state.config.maxTurns) {
    state.victory.winner = { factionId: PLAYER_ID, type: "legacy", turn: state.turn };
    lines.push("The age ends. Your legacy is written.");
    ctx.history({ type: "VICTORY", importance: 3, actorId: PLAYER_ID, targetId: null, summary: `After ${state.turn} years, ${state.civilizationName}'s legacy is sealed.`, tags: ["endgame", "legacy"] });
  }
  return lines;
}

/** Advance eras when the player has earned it — or when the world has simply moved on. */
export function checkEraAdvance(ctx: EngineContext): string[] {
  const state = ctx.state;
  const lines: string[] = [];
  if (state.era >= ERA_REQUIREMENTS.length) return lines;
  const req = ERA_REQUIREMENTS[state.era]!; // requirement for the next era
  const player = ctx.factionOrNull(PLAYER_ID);
  const techs = player?.research.known.length ?? 0;
  const earned = state.turn >= req.turn && techs >= req.techs;
  const forced = state.turn >= req.turn + ERA_FORCE_AFTER;
  if (!earned && !forced) return lines;
  state.era += 1;
  const name = ERA_NAMES[state.era - 1]!;
  lines.push(`A new era dawns: Era ${state.era} — ${name}.`);
  // Every era strengthens AI factions slightly and brings new threats.
  for (const f of state.factions) {
    if (f.kind === "ai" && f.alive) ctx.grant(f.id, { food: 20, wood: 20, stone: 15, metal: 10 });
  }
  const capital = ctx.settlementsOf(PLAYER_ID)[0];
  createEvent(ctx, {
    type: "era_dawn", severity: 0.6, duration: 0, centerTile: capital?.tile ?? 0, tiles: [], factionIds: [PLAYER_ID],
    cause: { era: state.era, eraName: name, techs, forced },
    consequences: ["New technologies become available", "Rival factions grow stronger", "The world grows more volatile"],
    effects: [], immediate: [], major: true, palette: "gold",
    summary: `Era ${state.era}: ${name}. ${forced && !earned ? "The world moves on, whether or not your people are ready." : "Your civilization steps into a new age."}`,
  });
  ctx.history({ type: "ERA_ADVANCED", importance: 3, actorId: PLAYER_ID, targetId: null, summary: `The Era of ${name} begins.`, tags: ["era", `era:${state.era}`] });
  return lines;
}
