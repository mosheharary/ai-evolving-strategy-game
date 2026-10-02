import type {
  BuildingType,
  DecisionCandidates,
  DecisionRequest,
  DiplomaticStance,
  Faction,
  FactionDecisionInput,
  GameState,
  ResourceType,
  StrategicAction,
  StrategicStateProjection,
  Unit,
  UnitType,
} from "@echoes/game-types";
import { PLAYER_ID, RESOURCE_TYPES, STRATEGIC_ACTIONS } from "@echoes/game-types";
import { getGrid, scoreSite } from "@echoes/procedural-world";
import { hashObject, round } from "@echoes/shared";
import { BUILDINGS } from "../content/buildings";
import { FACTION_TEMPLATES } from "../content/factions";
import { TECH_BY_ID } from "../content/techs";
import { UNITS } from "../content/units";
import type { EngineContext } from "../context";
import { canAttack, resolveAttack } from "./combat";
import { canBuild, canTrain, foundSettlement, placeBuilding, startTraining } from "./construction";
import {
  applyProposal,
  declareWar,
  deterministicAcceptance,
  gift,
  makeCeasefire,
  proposalStillLegal,
  sanction,
} from "./diplomacy";
import { computeFactionEconomy, militaryStrength } from "./economy";
import { findPath, reachableTiles } from "./movement";
import { decide, decideProposal, validateAnswer, type PolicyDecision, type PolicyInputs } from "./policy";
import { availableTechs, startResearch } from "./research";
import { isValidSettleSite } from "./territory";

const MAX_SETTLEMENTS_AI = 6;

function factionDistance(state: GameState, a: string, b: string): number {
  const grid = getGrid(state.map.width, state.map.height);
  const as = state.settlements.filter((s) => s.ownerId === a);
  const bs = state.settlements.filter((s) => s.ownerId === b);
  let best = Infinity;
  for (const x of as) for (const y of bs) best = Math.min(best, grid.distance(x.tile, y.tile));
  return best;
}

function relationOf(state: GameState, a: string, b: string) {
  const [x, y] = a < b ? [a, b] : [b, a];
  return state.relations.find((r) => r.key === `${x}|${y}`);
}

function candidateSettleSites(state: GameState, faction: Faction, limit = 5): number[] {
  const grid = getGrid(state.map.width, state.map.height);
  const own = state.settlements.filter((s) => s.ownerId === faction.id);
  if (own.length === 0) return [];
  const tpl = FACTION_TEMPLATES.find((t) => t.id === faction.id);
  const pref = tpl?.sitePreference ?? "balanced";
  const seen = new Set<number>();
  const scored: [number, number][] = [];
  for (const s of own) {
    for (const i of grid.within(s.tile, 9)) {
      if (seen.has(i)) continue;
      seen.add(i);
      if (grid.distance(s.tile, i) < 4) continue;
      if (!isValidSettleSite(state, i, faction.id)) continue;
      const sc = scoreSite(state.map, i, pref);
      if (Number.isFinite(sc)) scored.push([sc - grid.distance(s.tile, i) * 0.4, i]);
    }
  }
  scored.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  return scored.slice(0, limit).map(([, i]) => i);
}

/** Pick the neighbour the stance question is about: the player if relevant, else the most relevant faction. */
function stanceTarget(state: GameState, f: Faction): string | null {
  const others = state.factions.filter((o) => o.alive && o.id !== f.id);
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const o of others) {
    const dist = factionDistance(state, f.id, o.id);
    const rel = relationOf(state, f.id, o.id);
    const opinion = Math.abs(f.opinions[o.id] ?? 0);
    const score = (rel?.status === "war" ? 50 : 0) + opinion * 0.5 - (Number.isFinite(dist) ? dist : 40) + (o.id === PLAYER_ID ? 8 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = o.id;
    }
  }
  return best;
}

export function legalCandidates(state: GameState, f: Faction): DecisionCandidates {
  const actions: StrategicAction[] = ["defend"];
  const military = state.units.filter((u) => u.ownerId === f.id && UNITS[u.type].military);
  const ownSettlements = state.settlements.filter((s) => s.ownerId === f.id);
  const atWarWith = state.relations.filter((r) => r.status === "war" && (r.a === f.id || r.b === f.id));
  if (ownSettlements.length < MAX_SETTLEMENTS_AI && candidateSettleSites(state, f, 1).length > 0) actions.push("expand");
  const tradePartners = state.factions.filter((o) => {
    if (!o.alive || o.id === f.id) return false;
    const rel = relationOf(state, f.id, o.id);
    return !rel || (rel.status !== "war" && rel.sanctionsBy.length === 0);
  });
  if (tradePartners.length > 0) actions.push("trade");
  const hostile = state.factions.some((o) => o.alive && o.id !== f.id && (f.opinions[o.id] ?? 0) <= -25 && relationOf(state, f.id, o.id)?.status !== "ceasefire");
  if (military.length > 0 && (atWarWith.length > 0 || hostile)) actions.push("raid");
  if (availableTechs(state, f.id).length > 0 || f.research.current) actions.push("research");
  if (atWarWith.length > 0) actions.push("retreat");
  actions.sort((a, b) => STRATEGIC_ACTIONS.indexOf(a) - STRATEGIC_ACTIONS.indexOf(b));

  const target = stanceTarget(state, f);
  const stances: DiplomaticStance[] = [];
  if (target) {
    const rel = relationOf(state, f.id, target);
    const status = rel?.status ?? "peace";
    const opinion = f.opinions[target] ?? 0;
    if (status === "peace") {
      stances.push("improve_relations", "maintain");
      if (!rel?.sanctionsBy.includes(f.id)) stances.push("sanction");
      if (military.length > 0) stances.push("declare_war");
      if (opinion >= 40) stances.push("propose_alliance");
    } else if (status === "war") {
      stances.push("maintain", "seek_peace");
    } else if (status === "ceasefire") {
      stances.push("improve_relations", "maintain", "seek_peace");
    } else {
      stances.push("improve_relations", "maintain");
    }
  }
  const proposals = state.proposals.filter((p) => p.to === f.id).map((p) => ({ id: p.id, from: p.from, type: p.type }));
  return { strategicActions: actions, stances, stanceTargetId: target, proposals };
}

export function buildProjection(state: GameState, f: Faction): StrategicStateProjection {
  const grid = getGrid(state.map.width, state.map.height);
  const econ = computeFactionEconomy(state, f.id);
  const own = state.settlements.filter((s) => s.ownerId === f.id);
  const ownStrength = militaryStrength(state, f.id);
  const neighbors = state.factions
    .filter((o) => o.alive && o.id !== f.id)
    .map((o) => {
      const rel = relationOf(state, f.id, o.id);
      const d = factionDistance(state, f.id, o.id);
      return {
        id: o.id, name: o.id === PLAYER_ID ? state.civilizationName : o.name, isPlayer: o.id === PLAYER_ID,
        status: rel?.status ?? "peace", opinion: round(f.opinions[o.id] ?? 0, 0), militaryStrength: militaryStrength(state, o.id),
        distance: Number.isFinite(d) ? d : 99, trade: rel?.trade ?? false, sanctioning: rel?.sanctionsBy.includes(o.id) ?? false,
      };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5);
  const threats: StrategicStateProjection["threats"] = [];
  for (const u of state.units) {
    if (u.ownerId === f.id || !UNITS[u.type].military) continue;
    const near = own.some((s) => grid.distance(s.tile, u.tile) <= 4);
    if (!near) continue;
    const rel = relationOf(state, f.id, u.ownerId);
    threats.push({ kind: "enemy_units_near", detail: `${UNITS[u.type].name} of ${u.ownerId === PLAYER_ID ? state.civilizationName : u.ownerId} near our settlements (${rel?.status ?? "peace"})`, severity: rel?.status === "war" ? 3 : 1 });
  }
  for (const n of neighbors) {
    if (n.status === "war" && n.militaryStrength > ownStrength * 1.3) threats.push({ kind: "stronger_enemy", detail: `${n.name} outmatches us`, severity: 4 });
  }
  if (econ.net.food < 0) threats.push({ kind: "food_shortage", detail: `food ${econ.net.food}/turn, stock ${round(f.resources.food, 0)}`, severity: f.resources.food < 20 ? 4 : 2 });
  const territory = state.map.tiles.filter((t) => t.ownerId === f.id);
  const nearbyRes = new Set<string>();
  for (const t of territory) if (t.resource) nearbyRes.add(t.resource.type);
  const pollutionNearby = territory.length ? round(territory.reduce((a, t) => a + t.pollution, 0) / territory.length, 1) : 0;
  const forestNearby = territory.length ? round(territory.reduce((a, t) => a + t.forest, 0) / territory.length, 1) : 0;
  const recent = state.history
    .filter((h) => h.turn >= state.turn - 8 && (h.actorId === f.id || h.targetId === f.id || h.importance >= 3))
    .slice(-8)
    .map((h) => `T${h.turn}: ${h.summary}`);
  return {
    turn: state.turn,
    era: state.era,
    faction: {
      id: f.id, name: f.name, archetype: f.archetype,
      personality: Object.fromEntries(Object.entries(f.personality).map(([k, v]) => [k, round(v, 2)])),
      posture: f.posture.action,
      resources: Object.fromEntries(RESOURCE_TYPES.map((r) => [r, round(f.resources[r], 0)])),
      settlements: own.length,
      population: own.reduce((a, s) => a + s.population, 0),
      militaryStrength: ownStrength,
      techCount: f.research.known.length,
      researching: f.research.current ? TECH_BY_ID.get(f.research.current)?.name ?? null : null,
      foodPerTurn: econ.net.food,
      defeatsByPlayer: f.defeatsByPlayer,
    },
    neighbors,
    threats: threats.slice(0, 6),
    map: { territoryTiles: territory.length, freeSettleSites: candidateSettleSites(state, f, 5).length, nearbyResources: [...nearbyRes].sort(), pollutionNearby, forestNearby },
    activeEvents: state.events.filter((e) => e.status === "active").map((e) => ({ type: e.type, severity: e.severity, affectsUs: e.factionIds.includes(f.id) || e.tiles.some((t) => state.map.tiles[t]?.ownerId === f.id) })).slice(0, 5),
    recentHistory: recent,
    pendingProposals: state.proposals.filter((p) => p.to === f.id).map((p) => ({ id: p.id, fromName: p.from === PLAYER_ID ? state.civilizationName : p.from, type: p.type })),
    objectives: f.goals,
  };
}

/** Engine → AI: one request per AI faction, containing only legal options. */
export function buildDecisionRequests(state: GameState): DecisionRequest[] {
  return state.factions
    .filter((f) => f.kind === "ai" && f.alive)
    .map((f) => {
      const projection = buildProjection(state, f);
      const candidates = legalCandidates(state, f);
      return { factionId: f.id, turn: state.turn, stateHash: hashObject({ projection, candidates }), projection, candidates };
    });
}

export function computeUtilities(state: GameState, f: Faction, c: DecisionCandidates): Pick<PolicyInputs, "utilities" | "stanceUtilities" | "forced" | "foodCritical" | "threatCritical"> {
  const p = f.personality;
  const econ = computeFactionEconomy(state, f.id);
  const own = militaryStrength(state, f.id);
  const enemies = state.relations
    .filter((r) => r.status === "war" && (r.a === f.id || r.b === f.id))
    .map((r) => (r.a === f.id ? r.b : r.a));
  const enemyStrength = enemies.reduce((a, e) => Math.max(a, militaryStrength(state, e)), 0);
  const atWar = enemies.length > 0;
  const settlements = state.settlements.filter((s) => s.ownerId === f.id).length;
  const sites = c.strategicActions.includes("expand") ? 1 : 0;
  const foodCritical = econ.net.food < 0 && f.resources.food < 25;
  const threatCritical = atWar && enemyStrength > own * 1.5;
  const lostAdapt = f.defeatsByPlayer >= 3 ? 0.25 : 0;
  const utilities: Record<StrategicAction, number> = {
    expand: p.expansion + (sites ? 0.4 : -2) + (settlements < 3 ? 0.35 : 0) - (atWar ? 0.3 : 0),
    defend: 0.35 + (1 - p.aggression) * 0.2 + (atWar ? 0.35 : 0) + (threatCritical ? 1 : 0) + lostAdapt,
    trade: p.mercantile * 0.95 + (atWar ? -0.3 : 0.1),
    raid: p.aggression * 0.9 + (atWar ? 0.45 : -0.35) + (own > enemyStrength * 1.2 ? 0.25 : -0.4) - lostAdapt,
    research: p.science * 0.95 + 0.1,
    retreat: (threatCritical ? 0.7 : -0.6) + f.settlementsLost * 0.15,
  };
  for (const a of STRATEGIC_ACTIONS) utilities[a] = round(utilities[a], 3);

  const target = c.stanceTargetId;
  const opinion = target ? f.opinions[target] ?? 0 : 0;
  const stanceUtilities: Partial<Record<DiplomaticStance, number>> = {
    improve_relations: 0.3 + p.mercantile * 0.3 + (opinion > 0 ? 0.1 : 0),
    maintain: 0.45,
    sanction: opinion < -30 ? 0.5 + (1 - p.mercantile) * 0.2 : 0.05,
    declare_war: opinion < -45 && own > (target ? militaryStrength(state, target) : 0) * 1.1 ? 0.5 + p.aggression * 0.4 : 0,
    seek_peace: atWar ? 0.3 + (threatCritical ? 0.6 : 0) + (1 - p.aggression) * 0.3 : 0,
    propose_alliance: opinion >= 55 ? 0.6 : 0,
  };
  let forced: StrategicAction | null = null;
  if (threatCritical) forced = "defend";
  else if (atWar && own > enemyStrength * 1.5 && c.strategicActions.includes("raid")) forced = "raid";
  return { utilities, stanceUtilities, forced, foodCritical, threatCritical };
}

// ---------------------------------------------------------------------------- execution

function pickResearch(ctx: EngineContext, f: Faction): void {
  if (f.research.current) return;
  const avail = availableTechs(ctx.state, f.id);
  if (avail.length === 0) return;
  const tpl = FACTION_TEMPLATES.find((t) => t.id === f.id);
  const preferred = (tpl?.preferredTechs ?? []).find((id) => avail.some((a) => a.id === id));
  const choice = preferred ?? avail.slice().sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id))[0]!.id;
  startResearch(ctx, f.id, choice);
}

function tryBuild(ctx: EngineContext, f: Faction, type: BuildingType, reserve = 1): boolean {
  const def = BUILDINGS[type];
  for (const [r, v] of Object.entries(def.cost)) if ((f.resources[r as ResourceType] ?? 0) < (v ?? 0) * reserve) return false;
  const own = ctx.settlementsOf(f.id);
  for (const s of own) {
    const tiles = ctx.grid.within(s.tile, s.radius).filter((i) => ctx.tile(i).settlementId === s.id);
    // Prefer the tile that maximises the building's yield.
    const scored = tiles
      .filter((i) => canBuild(ctx.state, f.id, type, i) === null)
      .map((i) => {
        const t = ctx.tile(i);
        const score = type === "farm" ? t.fertility + (t.river ? 20 : 0)
          : type === "lumber_camp" ? t.forest
            : type === "quarry" ? (t.biome === "hills" ? 30 : 0) + (t.resource?.type === "stone_deposit" ? 50 : 0)
              : type === "mine" ? (t.resource?.type === "iron" || t.resource?.type === "sunstone" ? 60 : 0) + (t.biome === "hills" ? 10 : 0)
                : -ctx.grid.distance(i, s.tile);
        return [score, i] as const;
      })
      .sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    const best = scored[0];
    if (best) {
      placeBuilding(ctx, f.id, type, best[1]);
      return true;
    }
  }
  return false;
}

function tryTrain(ctx: EngineContext, f: Faction, unitType: UnitType): boolean {
  for (const s of ctx.settlementsOf(f.id)) {
    if (canTrain(ctx.state, f.id, s.id, unitType) === null) {
      startTraining(ctx, f.id, s.id, unitType);
      return true;
    }
  }
  return false;
}

function stepToward(ctx: EngineContext, u: Unit, target: number): void {
  if (u.movesLeft <= 0 || u.tile === target) return;
  const path = findPath(ctx.state, u, target);
  if (!path || path.length === 0) return;
  const reach = reachableTiles(ctx.state, u);
  let dest: number | null = null;
  for (const step of path) {
    if (reach.has(step) && step !== target) dest = step;
    else if (step === target && reach.has(step)) dest = step;
    else break;
  }
  if (dest === null) return;
  u.prevTile = u.tile;
  u.tile = dest;
  u.movesLeft = 0;
  u.status = "moved";
  ctx.invalidateUnits();
}

function economyBuild(ctx: EngineContext, f: Faction, d: PolicyDecision, builds: { n: number }): void {
  const econ = computeFactionEconomy(ctx.state, f.id);
  const limit = ctx.state.config.difficulty === "warlord" ? 2 : 1;
  const want: BuildingType[] = [];
  if (d.urgentFood || econ.net.food < 1.5) want.push("farm");
  if (econ.net.wood < 2) want.push("lumber_camp");
  if (econ.net.stone < 1.5) want.push("quarry");
  if (f.research.known.includes("mining") && econ.net.metal < 1) want.push("mine");
  if (f.research.known.includes("writing") && econ.net.knowledge < 4) want.push("laboratory");
  want.push("farm", "lumber_camp");
  for (const type of want) {
    if (builds.n >= limit) return;
    if (tryBuild(ctx, f, type)) builds.n++;
  }
}

function executeAction(ctx: EngineContext, f: Faction, d: PolicyDecision): string {
  const state = ctx.state;
  const builds = { n: 0 };
  const military = ctx.unitsOf(f.id).filter((u) => UNITS[u.type].military);
  const own = ctx.settlementsOf(f.id);
  let summary = "";
  pickResearch(ctx, f);

  if (d.urgentDefense && military.length < own.length * 2) {
    if (!tryTrain(ctx, f, "guard")) tryBuild(ctx, f, "barracks");
  }

  switch (d.action) {
    case "expand": {
      const worker = ctx.unitsOf(f.id).find((u) => u.type === "worker");
      const reserve = d.mode === "conservative" ? 1.5 : 1;
      if (!worker) {
        if (tryTrain(ctx, f, "worker")) summary = "is training settlers for expansion";
        else summary = "gathers resources to expand";
      } else {
        const sites = candidateSettleSites(state, f, 3);
        const site = sites.sort((a, b) => ctx.grid.distance(worker.tile, a) - ctx.grid.distance(worker.tile, b) || a - b)[0];
        if (site !== undefined) {
          if (worker.tile === site && ctx.canAfford(f.id, Object.fromEntries(Object.entries(BUILDINGS.settlement_center.cost).map(([k, v]) => [k, (v ?? 0) * reserve])))) {
            ctx.pay(f.id, BUILDINGS.settlement_center.cost);
            state.units = state.units.filter((u) => u.id !== worker.id);
            ctx.invalidateUnits();
            const s = foundSettlement(ctx, f.id, site);
            summary = `founded ${s.name}`;
          } else {
            stepToward(ctx, worker, site);
            summary = `is pushing settlers toward ${ctx.tile(site).region}`;
          }
        }
      }
      economyBuild(ctx, f, d, builds);
      break;
    }
    case "defend": {
      if (!own.some((s) => ctx.buildingsOf(s.id).some((b) => b.type === "barracks"))) tryBuild(ctx, f, "barracks");
      else if (!tryTrain(ctx, f, f.research.known.includes("archery") && military.length % 2 === 1 ? "ranged" : "guard")) {
        if (f.research.known.includes("fortification")) tryBuild(ctx, f, "wall");
        else tryBuild(ctx, f, "watchtower");
      }
      for (const u of military) {
        const home = own.slice().sort((a, b) => ctx.grid.distance(u.tile, a.tile) - ctx.grid.distance(u.tile, b.tile))[0];
        if (home && ctx.grid.distance(u.tile, home.tile) > 1) stepToward(ctx, u, home.tile);
        else if (u.movesLeft > 0) u.status = "fortified";
      }
      economyBuild(ctx, f, d, builds);
      summary = "is fortifying its holdings";
      break;
    }
    case "trade": {
      const partners = state.factions
        .filter((o) => o.alive && o.id !== f.id)
        .filter((o) => {
          const rel = ctx.relation(f.id, o.id);
          return rel.status !== "war" && !rel.trade && rel.sanctionsBy.length === 0;
        })
        .sort((a, b) => (f.opinions[b.id] ?? 0) - (f.opinions[a.id] ?? 0) || a.id.localeCompare(b.id));
      const partner = partners[0];
      if (partner) {
        if (partner.kind === "player") {
          if (!state.proposals.some((p) => p.from === f.id && p.to === PLAYER_ID)) {
            state.proposals.push({ id: ctx.id("p"), from: f.id, to: PLAYER_ID, type: "trade", turn: state.turn });
            summary = `proposed a trade agreement to ${state.civilizationName}`;
          }
        } else {
          const prop = { id: "tmp", from: f.id, to: partner.id, type: "trade" as const, turn: state.turn };
          if (deterministicAcceptance(ctx, prop) >= 0.5) {
            applyProposal(ctx, prop);
            summary = `opened trade with ${partner.name}`;
          } else summary = `sought trade with ${partner.name} but was refused`;
        }
      } else summary = "is tending its trade routes";
      if (f.research.known.includes("currency")) tryBuild(ctx, f, "market");
      economyBuild(ctx, f, d, builds);
      break;
    }
    case "raid": {
      const enemies = state.relations
        .filter((r) => r.status === "war" && (r.a === f.id || r.b === f.id))
        .map((r) => (r.a === f.id ? r.b : r.a))
        .sort();
      const targetFaction = enemies[0];
      if (!targetFaction) {
        summary = "is massing forces";
        tryTrain(ctx, f, "guard");
        break;
      }
      const targets = ctx.settlementsOf(targetFaction);
      for (const u of military) {
        if (opportunisticAttack(ctx, u, d.mode === "execute")) continue;
        if (d.mode === "conservative") continue; // limited raid: only strike what is in reach
        const t = targets.slice().sort((a, b) => ctx.grid.distance(u.tile, a.tile) - ctx.grid.distance(u.tile, b.tile) || a.tile - b.tile)[0];
        if (t) stepToward(ctx, u, t.tile);
      }
      if (military.length < 3) tryTrain(ctx, f, f.research.known.includes("metallurgy") ? "heavy" : "guard");
      summary = `is raiding ${ctx.factionName(targetFaction)}`;
      break;
    }
    case "research": {
      if (f.research.known.includes("writing")) tryBuild(ctx, f, "laboratory");
      if (f.research.known.includes("masonry")) tryBuild(ctx, f, "workshop", 1.2);
      economyBuild(ctx, f, d, builds);
      summary = f.research.current ? `is researching ${TECH_BY_ID.get(f.research.current)?.name}` : "pursues knowledge";
      break;
    }
    case "retreat": {
      for (const u of military) {
        const home = own.slice().sort((a, b) => ctx.grid.distance(u.tile, a.tile) - ctx.grid.distance(u.tile, b.tile))[0];
        if (home) stepToward(ctx, u, home.tile);
        u.status = "fortified";
      }
      summary = "is pulling back its forces";
      break;
    }
  }

  // Opportunistic defence: any unit adjacent to an enemy at war strikes back.
  if (d.action !== "raid" && d.action !== "retreat") {
    for (const u of ctx.unitsOf(f.id)) opportunisticAttack(ctx, u, false);
  }
  // Scouts wander toward unexplored frontier.
  for (const u of ctx.unitsOf(f.id).filter((x) => x.type === "scout" && x.movesLeft > 0)) {
    const reach = [...reachableTiles(state, u).keys()].sort((a, b) => a - b);
    if (reach.length > 0) {
      u.prevTile = u.tile;
      u.tile = ctx.rng.pick(reach);
      u.movesLeft = 0;
      ctx.invalidateUnits();
    }
  }
  return summary || "holds its course";
}

function opportunisticAttack(ctx: EngineContext, u: Unit, aggressive: boolean): boolean {
  if (!UNITS[u.type].military || u.attacked || u.movesLeft <= 0) return false;
  const range = Math.max(1, UNITS[u.type].range);
  const targets = ctx.grid.within(u.tile, range).filter((i) => i !== u.tile && canAttack(ctx.state, u, i) === null);
  if (targets.length === 0) return false;
  // Prefer units over settlements, weakest first.
  targets.sort((a, b) => {
    const ua = ctx.unitAt(a);
    const ub = ctx.unitAt(b);
    return (ua ? ua.hp : 1000) - (ub ? ub.hp : 1000) || a - b;
  });
  const target = targets[0]!;
  const owner = ctx.faction(u.ownerId);
  const raze = aggressive && owner.personality.aggression > 0.7 && ctx.settlementAt(target)?.ownerId !== PLAYER_ID && ctx.rng.chance(0.3);
  resolveAttack(ctx, u, target, raze);
  return true;
}

function executeStance(ctx: EngineContext, f: Faction, d: PolicyDecision, targetId: string | null): string | null {
  if (!targetId) return null;
  const target = ctx.factionOrNull(targetId);
  if (!target?.alive) return null;
  const state = ctx.state;
  switch (d.stance) {
    case "improve_relations": {
      const richest = RESOURCE_TYPES.filter((r) => r !== "knowledge").sort((a, b) => f.resources[b] - f.resources[a])[0]!;
      const recentGift = state.history.some((h) => h.actorId === f.id && h.targetId === targetId && h.tags.includes("gift") && state.turn - h.turn < 6);
      if (f.resources[richest] > 60 && (f.opinions[targetId] ?? 0) < 45 && !recentGift) {
        gift(ctx, f.id, targetId, richest, 12);
        return `sent a gift to ${ctx.factionName(targetId)}`;
      }
      return null;
    }
    case "sanction":
      return sanction(ctx, f.id, targetId) === null ? `sanctioned ${ctx.factionName(targetId)}` : null;
    case "declare_war":
      return declareWar(ctx, f.id, targetId) === null ? `declared war on ${ctx.factionName(targetId)}` : null;
    case "seek_peace": {
      if (target.kind === "player") {
        if (!state.proposals.some((p) => p.from === f.id && p.to === PLAYER_ID)) {
          state.proposals.push({ id: ctx.id("p"), from: f.id, to: PLAYER_ID, type: "ceasefire", turn: state.turn });
          return `offered ${state.civilizationName} a ceasefire`;
        }
        return null;
      }
      const prop = { id: "tmp", from: f.id, to: targetId, type: "ceasefire" as const, turn: state.turn };
      if (ctx.relation(f.id, targetId).status === "war" && deterministicAcceptance(ctx, prop) >= 0.5) {
        makeCeasefire(ctx, f.id, targetId);
        return `agreed a ceasefire with ${ctx.factionName(targetId)}`;
      }
      return null;
    }
    case "propose_alliance": {
      if (target.kind === "player") {
        if (!state.proposals.some((p) => p.from === f.id && p.to === PLAYER_ID)) {
          state.proposals.push({ id: ctx.id("p"), from: f.id, to: PLAYER_ID, type: "alliance", turn: state.turn });
          return `proposed an alliance to ${state.civilizationName}`;
        }
        return null;
      }
      const prop = { id: "tmp", from: f.id, to: targetId, type: "alliance" as const, turn: state.turn };
      if (deterministicAcceptance(ctx, prop) >= 0.5 && proposalStillLegal(ctx, prop)) {
        applyProposal(ctx, prop);
        return `allied with ${ctx.factionName(targetId)}`;
      }
      return null;
    }
    default:
      return null;
  }
}

function adaptStrategy(ctx: EngineContext, f: Faction): void {
  // A faction repeatedly defeated by the player changes strategy — permanently.
  if (f.defeatsByPlayer >= 3 && f.personality.aggression > 0.45 && !f.goals.includes("fortify_homeland")) {
    f.personality.aggression = round(Math.max(0.15, f.personality.aggression - 0.25), 2);
    f.personality.science = round(Math.min(1, f.personality.science + 0.1), 2);
    f.goals = [...f.goals, "fortify_homeland"];
    ctx.history({
      type: "FACTION_STRATEGY_CHANGED", importance: 3, actorId: f.id, targetId: PLAYER_ID,
      summary: `After repeated defeats by ${ctx.state.civilizationName}, ${f.name} abandons open warfare and turns to fortification and invention.`,
      effects: ["Aggression reduced", "Science focus increased"], tags: ["faction", `faction:${f.id}`, "adaptation"],
    });
  }
  // Ecological factions radicalise against heavy polluters.
  if (f.archetype === "ecological") {
    const player = ctx.factionOrNull(PLAYER_ID);
    const playerPollution = ctx.state.map.tiles.filter((t) => t.ownerId === PLAYER_ID).reduce((a, t) => a + t.pollution, 0);
    if (player && playerPollution > 150 && !f.goals.includes("punish_polluters")) {
      f.goals = [...f.goals, "punish_polluters"];
      f.personality.aggression = round(Math.min(0.9, f.personality.aggression + 0.2), 2);
      ctx.remember(f.id, PLAYER_ID, "polluted_land", -20);
      ctx.history({
        type: "FACTION_STRATEGY_CHANGED", importance: 3, actorId: f.id, targetId: PLAYER_ID,
        summary: `${f.name} declares ${ctx.state.civilizationName}'s industry a wound upon the land and vows to resist it.`,
        effects: ["Verdant aggression increased", "Opinion -20"], tags: ["faction", "ecology", `faction:${f.id}`],
      });
    }
  }
}

export interface FactionPhaseResult {
  actions: { factionId: string; action: StrategicAction; source: "ai" | "fallback"; summary: string }[];
  lines: string[];
}

/** Apply stored/live decisions deterministically. Inputs are validated again here. */
export function applyFactionDecisions(ctx: EngineContext, inputs: readonly FactionDecisionInput[]): FactionPhaseResult {
  const state = ctx.state;
  const result: FactionPhaseResult = { actions: [], lines: [] };
  const factions = state.factions.filter((f) => f.kind === "ai" && f.alive).sort((a, b) => a.id.localeCompare(b.id));
  for (const f of factions) {
    if (!f.alive) continue;
    const candidates = legalCandidates(state, f);
    const input = inputs.find((i) => i.factionId === f.id);
    let answer = input?.answer ?? null;
    let invalid: string | null = input?.fallbackReason ?? (input ? null : "no_decision");
    if (answer) {
      const v = validateAnswer(answer, candidates);
      if (!v.ok) {
        invalid = v.reason;
        answer = null;
      } else answer = v.answer;
    }
    const util = computeUtilities(state, f, candidates);
    const decision = decide({ candidates, ...util, aggression: f.personality.aggression }, answer, state.config.aiPolicy, invalid);

    // Respond to proposals addressed to this faction.
    for (const p of state.proposals.filter((x) => x.to === f.id)) {
      const legal = proposalStillLegal(ctx, p);
      const accept = legal && decideProposal(answer?.acceptProposals[p.id], deterministicAcceptance(ctx, p), state.config.aiPolicy);
      if (accept) {
        applyProposal(ctx, p);
        result.lines.push(`${f.name} accepted the ${p.type} proposal from ${ctx.factionName(p.from)}.`);
      } else {
        result.lines.push(`${f.name} rejected the ${p.type} proposal from ${ctx.factionName(p.from)}.`);
        if (p.from === PLAYER_ID) ctx.remember(f.id, PLAYER_ID, "gift", -1);
      }
    }
    state.proposals = state.proposals.filter((x) => x.to !== f.id);

    const summary = executeAction(ctx, f, decision);
    const stanceSummary = executeStance(ctx, f, decision, candidates.stanceTargetId);
    if (f.posture.action !== decision.action) f.posture = { action: decision.action, sinceTurn: state.turn, conservative: decision.mode === "conservative" };
    else f.posture.conservative = decision.mode === "conservative";
    adaptStrategy(ctx, f);
    state.lastDecisions[f.id] = {
      turn: state.turn, action: decision.action, stance: decision.stance, confidence: round(decision.confidence, 3),
      source: decision.source, mode: decision.mode, reason: decision.reason,
    };
    const full = `${f.name} ${summary}${stanceSummary ? ` and ${stanceSummary}` : ""}.`;
    result.actions.push({ factionId: f.id, action: decision.action, source: decision.source, summary: full });
    if (stanceSummary) result.lines.push(`${f.name} ${stanceSummary}.`);
  }
  return result;
}
