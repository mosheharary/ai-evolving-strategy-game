import type { DecisionRequest, FactionDecisionInput, GameState, Resources, TurnReport } from "@echoes/game-types";
import { PLAYER_ID, RESOURCE_TYPES } from "@echoes/game-types";
import { clamp, round } from "@echoes/shared";
import { BUILDINGS } from "./content/buildings";
import { TECH_BY_ID } from "./content/techs";
import { UNITS } from "./content/units";
import { EngineContext } from "./context";
import { spawnUnit } from "./systems/construction";
import { tickDiplomacy } from "./systems/diplomacy";
import { computeFactionEconomy, emptyResources, settlementHousing } from "./systems/economy";
import { activeGrowthMult, activeStabilityDelta, createEvent, runEventDirector } from "./systems/events";
import { evolveWorld } from "./systems/evolution";
import { applyFactionDecisions, buildDecisionRequests } from "./systems/factionAI";
import { evaluateQuests, generateQuests } from "./systems/quests";
import { progressResearch } from "./systems/research";
import { updatePlayerVision } from "./systems/territory";
import { checkEraAdvance, checkVictory } from "./systems/victory";
import { techModifiers } from "./content/techs";

/**
 * Turn state machine:
 *
 *   PLANNING ─(player commands)→ PLAYER_ACTIONS ─END_TURN→ RESOLUTION → FACTION_AI
 *     → WORLD_EVOLUTION → EVENTS → NARRATIVE → TURN_COMPLETE → PLANNING (turn + 1)
 *
 * The pipeline is split at FACTION_AI so the server can obtain (or replay) AI
 * decisions between the two pure halves:
 *   prepareTurn(state)            → state in FACTION_AI + DecisionRequests
 *   completeTurn(state, inputs)   → state in PLANNING (next turn) + TurnReport
 */

export interface PreparedTurn {
  state: GameState;
  requests: DecisionRequest[];
}

export interface CompletedTurn {
  state: GameState;
  report: TurnReport;
}

function resolveFaction(ctx: EngineContext, factionId: string, lines: string[]): void {
  const state = ctx.state;
  const f = ctx.faction(factionId);
  if (!f.alive) return;
  const econ = computeFactionEconomy(state, factionId);
  const mods = econ.modifiers;
  let starving = false;
  for (const r of RESOURCE_TYPES) {
    const next = f.resources[r] + econ.net[r];
    if (r === "food" && next < 0) starving = true;
    f.resources[r] = round(clamp(next, 0, econ.storageCap[r]), 2);
  }
  const energyShort = f.resources.energy <= 0 && econ.net.energy < 0;

  // Construction.
  for (const b of state.buildings) {
    if (b.ownerId !== factionId || b.turnsRemaining <= 0) continue;
    b.turnsRemaining -= 1;
    if (b.turnsRemaining === 0 && factionId === PLAYER_ID) lines.push(`${BUILDINGS[b.type].name} completed.`);
  }

  const own = ctx.settlementsOf(factionId);
  const capital = own.find((s) => s.isCapital) ?? own[0];
  const growthMult = (1 + mods.growthMult) * activeGrowthMult(ctx, factionId);
  const foodShare = econ.net.food / Math.max(1, own.length);
  const eventStability = activeStabilityDelta(ctx, factionId);
  const atWar = state.relations.some((r) => r.status === "war" && (r.a === factionId || r.b === factionId));
  for (const s of own) {
    // Training.
    if (s.training) {
      s.training.turnsRemaining -= 1;
      if (s.training.turnsRemaining <= 0) {
        const id = spawnUnit(ctx, factionId, s.training.unitType, s.tile);
        if (id && factionId === PLAYER_ID) lines.push(`${s.name} trained a ${UNITS[s.training.unitType].name}.`);
        s.training = id ? null : { ...s.training, turnsRemaining: 1 };
      }
    }
    // Growth.
    const housing = settlementHousing(state, s, mods);
    if (!starving && foodShare > 0) {
      s.growth = round(s.growth + foodShare * growthMult, 2);
      const threshold = 8 + s.population * 3;
      if (s.growth >= threshold) {
        if (s.population < housing) {
          s.population += 1;
          s.growth = 0;
          if (factionId === PLAYER_ID) lines.push(`${s.name} grows to ${s.population} population.`);
        } else s.growth = threshold;
      }
    }
    // Stability.
    const territory = state.map.tiles.filter((t) => t.settlementId === s.id);
    const pollution = territory.reduce((a, t) => a + t.pollution, 0) / Math.max(1, territory.length);
    const garrison = state.units.some((u) => u.ownerId === factionId && UNITS[u.type].military && ctx.grid.distance(u.tile, s.tile) <= 1);
    const distance = capital && capital.id !== s.id ? ctx.grid.distance(capital.tile, s.tile) : 0;
    const target = 62 + mods.stability + (s.isCapital ? 12 : 0) - pollution * 0.4 - Math.max(0, s.population - housing) * 6 -
      (atWar ? 6 : 0) - distance * 0.7 + (garrison ? 10 : 0) + eventStability - (starving ? 15 : 0) - (energyShort ? 5 : 0) + Math.min(10, s.population);
    const delta = clamp(target - s.stability, -6, 6);
    s.stability = round(clamp(s.stability + delta, 0, 100), 1);
    // Recovery.
    const wall = state.buildings.some((b) => b.settlementId === s.id && b.type === "wall" && b.turnsRemaining === 0);
    s.maxHp = 100 + (wall ? 40 : 0) + s.population * 4;
    s.hp = Math.min(s.maxHp, s.hp + 10);
  }
  if (starving && own.length > 0) {
    const largest = own.slice().sort((a, b) => b.population - a.population || a.id.localeCompare(b.id))[0]!;
    if (largest.population > 1) {
      largest.population -= 1;
      largest.stability = Math.max(0, largest.stability - 8);
      if (factionId === PLAYER_ID) lines.push(`Famine! ${largest.name} loses population.`);
    }
  }

  // Research.
  for (const techId of progressResearch(ctx, factionId)) {
    if (factionId === PLAYER_ID) lines.push(`Research complete: ${TECH_BY_ID.get(techId)?.name}.`);
  }

  // Unit recovery (units that did not fight heal).
  for (const u of ctx.unitsOf(factionId)) {
    if (u.attacked) continue;
    const t = ctx.tile(u.tile);
    const inOwn = t.ownerId === factionId;
    const barracks = inOwn && state.buildings.some((b) => b.settlementId === t.settlementId && b.type === "barracks" && b.turnsRemaining === 0);
    const heal = barracks ? 20 : inOwn ? 10 : 4;
    u.hp = Math.min(u.maxHp, u.hp + heal);
    u.morale = round(clamp(u.morale + (u.morale < 70 ? 3 : -1) + (mods.morale > 0 ? 1 : 0), 0, 100), 1);
  }
}

export function prepareTurn(state: GameState): PreparedTurn {
  if (state.phase !== "PLANNING" && state.phase !== "PLAYER_ACTIONS") throw new Error(`prepareTurn: invalid phase ${state.phase}`);
  if (state.victory.winner) throw new Error("prepareTurn: campaign is over");
  const draft = structuredClone(state);
  const ctx = new EngineContext(draft);
  draft.phase = "RESOLUTION";
  const player = ctx.faction(PLAYER_ID);
  const lines: string[] = [];
  // Remember turn-start resources for the summary.
  draft.lastReport = { turn: draft.turn, resourceDelta: { ...player.resources }, lines, focusTiles: [], eventIds: [], factionActions: [] };
  for (const u of draft.units) u.prevTile = u.tile;
  for (const f of draft.factions.slice().sort((a, b) => (a.id === PLAYER_ID ? -1 : b.id === PLAYER_ID ? 1 : a.id.localeCompare(b.id)))) {
    resolveFaction(ctx, f.id, lines);
  }
  updatePlayerVision(ctx);
  draft.phase = "FACTION_AI";
  const committed = ctx.commit();
  return { state: committed, requests: buildDecisionRequests(committed) };
}

export function completeTurn(state: GameState, inputs: readonly FactionDecisionInput[]): CompletedTurn {
  if (state.phase !== "FACTION_AI") throw new Error(`completeTurn: invalid phase ${state.phase}`);
  const draft = structuredClone(state);
  const ctx = new EngineContext(draft);
  const startResources: Resources = draft.lastReport?.resourceDelta ?? emptyResources();
  const lines = [...(draft.lastReport?.lines ?? [])];
  const focus: number[] = [];

  // FACTION_AI
  const factionPhase = applyFactionDecisions(ctx, inputs);
  lines.push(...factionPhase.lines);

  // WORLD_EVOLUTION
  draft.phase = "WORLD_EVOLUTION";
  const evo = evolveWorld(ctx);
  tickDiplomacy(ctx);
  if (evo.deforested.some((i) => ctx.tile(i).ownerId === PLAYER_ID)) lines.push("Forests in your territory have been cleared.");

  // EVENTS
  draft.phase = "EVENTS";
  const before = new Set(draft.events.map((e) => e.id));
  runEventDirector(ctx, evo);
  // Technological breakthroughs (era II+ techs researched this turn).
  const breakthrough = draft.history.find((h) => h.type === "TECHNOLOGY_RESEARCHED" && h.turn === draft.turn && (TECH_BY_ID.get(h.tags.find((t) => t.startsWith("tech:"))?.slice(5) ?? "")?.era ?? 0) >= 2);
  if (breakthrough && breakthrough.actorId) {
    const tech = TECH_BY_ID.get(breakthrough.tags.find((t) => t.startsWith("tech:"))!.slice(5))!;
    const actor = breakthrough.actorId;
    const home = ctx.settlementsOf(actor)[0];
    if (home && !draft.events.some((e) => e.type === "tech_breakthrough" && draft.turn - e.turn < 6)) {
      createEvent(ctx, {
        type: "tech_breakthrough", severity: 0.5, duration: 3, centerTile: home.tile, tiles: [home.tile], factionIds: [actor],
        cause: { faction: actor, technology: tech.id, technologyName: tech.name, branch: tech.branch },
        consequences: [tech.description, `${ctx.factionName(actor)} knowledge +15% for 3 turns`],
        effects: [{ kind: "yield_mult", resource: "knowledge", mult: 1.15, factionId: actor, tiles: "all" }],
        immediate: [], major: actor === PLAYER_ID, palette: "arcane",
        summary: `Breakthrough: ${ctx.factionName(actor)} masters ${tech.name}.`,
      });
    }
  }
  generateQuests(ctx);
  lines.push(...evaluateQuests(ctx));
  lines.push(...checkEraAdvance(ctx));
  lines.push(...checkVictory(ctx));
  // AI proposals to the player expire after 3 turns.
  draft.proposals = draft.proposals.filter((p) => p.to !== PLAYER_ID || draft.turn - p.turn < 3);

  const newEvents = draft.events.filter((e) => !before.has(e.id) || e.turn === draft.turn);
  for (const e of newEvents) {
    if (e.turn !== draft.turn) continue;
    lines.push(e.major ? `Major event: ${e.type.replace(/_/g, " ")} in ${e.region}.` : `Event: ${e.type.replace(/_/g, " ")} in ${e.region}.`);
    focus.push(e.visual.focusTile);
  }

  // NARRATIVE — presentation is generated asynchronously outside the engine.
  draft.phase = "NARRATIVE";

  // TURN_COMPLETE
  draft.phase = "TURN_COMPLETE";
  const player = ctx.faction(PLAYER_ID);
  const delta = emptyResources();
  for (const r of RESOURCE_TYPES) delta[r] = round(player.resources[r] - startResources[r], 1);
  const report: TurnReport = {
    turn: draft.turn,
    resourceDelta: delta,
    lines,
    focusTiles: [...new Set(focus)].slice(0, 4),
    eventIds: draft.events.filter((e) => e.turn === draft.turn).map((e) => e.id),
    factionActions: factionPhase.actions,
  };
  draft.lastReport = report;

  // Medium-term trends.
  const econ = computeFactionEconomy(draft, PLAYER_ID);
  const playerTiles = draft.map.tiles.filter((t) => t.ownerId === PLAYER_ID);
  draft.trends.push({
    turn: draft.turn,
    food: econ.net.food,
    knowledge: econ.net.knowledge,
    military: round(draft.units.filter((u) => u.ownerId === PLAYER_ID && UNITS[u.type].military).length, 0),
    pollution: round(playerTiles.reduce((a, t) => a + t.pollution, 0), 1),
    population: ctx.settlementsOf(PLAYER_ID).reduce((a, s) => a + s.population, 0),
    territory: playerTiles.length,
  });
  if (draft.trends.length > 30) draft.trends.splice(0, draft.trends.length - 30);

  // Long-term memory: keep notable/epochal history forever, prune minor entries.
  draft.history = draft.history.filter((h) => h.importance >= 2 || draft.turn - h.turn <= 12);
  if (draft.history.length > 600) draft.history = draft.history.slice(-600);

  // Next turn.
  draft.turn += 1;
  for (const u of draft.units) {
    const def = UNITS[u.type];
    const owner = draft.factions.find((f) => f.id === u.ownerId);
    u.movesLeft = def.moves + (owner && techModifiers(owner.research.known).vision > 0 && (u.type === "scout" || u.type === "explorer") ? 1 : 0);
    u.attacked = false;
    u.status = u.status === "fortified" ? "fortified" : "idle";
  }
  draft.phase = "PLANNING";
  return { state: ctx.commit(), report };
}
