import { resourceLabel } from "../content/labels";
import type { EventEffect, Faction, Settlement, WorldEvent, WorldEventType } from "@echoes/game-types";
import { PLAYER_ID } from "@echoes/game-types";
import { isWater } from "@echoes/procedural-world";
import { clamp, round } from "@echoes/shared";
import { FACTION_TEMPLATES } from "../content/factions";
import type { EngineContext } from "../context";
import { foundSettlement } from "./construction";
import { isValidSettleSite, transferTerritory } from "./territory";
import type { EvolutionResult } from "./evolution";

/**
 * Event Director: deterministic world state → interesting conditions → event class →
 * deterministic mechanics. Every event carries a structured `cause` so that the
 * narrative layer can explain *why* it happened — surprise, not randomness.
 */

const SEVERITY_MULT = { settler: 0.8, governor: 1, warlord: 1.25 } as const;

interface Draft {
  type: WorldEventType;
  severity: number;
  duration: number;
  centerTile: number;
  tiles: number[];
  factionIds: string[];
  cause: WorldEvent["cause"];
  consequences: string[];
  effects: EventEffect[];
  immediate: string[];
  major: boolean;
  palette: WorldEvent["visual"]["palette"];
  historyType?: "NATURAL_DISASTER" | "WORLD_EVENT";
  summary: string;
}

export function createEvent(ctx: EngineContext, d: Draft): WorldEvent {
  const state = ctx.state;
  const severity = round(clamp(d.severity * SEVERITY_MULT[state.config.difficulty], 0.05, 1), 2);
  const e: WorldEvent = {
    id: ctx.id("e"), type: d.type, turn: state.turn, severity, duration: d.duration, endsTurn: state.turn + d.duration,
    centerTile: d.centerTile, tiles: [...new Set(d.tiles)].sort((a, b) => a - b), region: ctx.tile(d.centerTile).region,
    factionIds: [...new Set(d.factionIds)].sort(), cause: d.cause, consequences: d.consequences, effects: d.effects,
    immediate: d.immediate, major: d.major, visual: { palette: d.palette, focusTile: d.centerTile }, status: d.duration > 0 ? "active" : "resolved",
  };
  state.events.push(e);
  ctx.history({
    type: d.historyType ?? "WORLD_EVENT", importance: d.major ? 3 : 2, actorId: null, targetId: d.factionIds[0] ?? null,
    tile: d.centerTile, summary: d.summary, effects: [...d.immediate, ...d.consequences], tags: ["event", `event:${d.type}`, `region:${e.region}`],
    eventId: e.id,
  });
  state.world.calm = 0;
  return e;
}

const active = (ctx: EngineContext, type: WorldEventType): boolean => ctx.state.events.some((e) => e.type === type && e.status === "active");
const recent = (ctx: EngineContext, type: WorldEventType, turns: number): boolean => ctx.state.events.some((e) => e.type === type && ctx.state.turn - e.turn < turns);

function regionTiles(ctx: EngineContext, region: string): number[] {
  return ctx.state.map.tiles.filter((t) => t.region === region && !isWater(t.biome)).map((t) => t.i);
}

function factionsInTiles(ctx: EngineContext, tiles: number[]): string[] {
  const s = new Set<string>();
  for (const i of tiles) {
    const o = ctx.tile(i).ownerId;
    if (o) s.add(o);
  }
  return [...s].sort();
}

// ------------------------------------------------------------------ detectors

function detectDrought(ctx: EngineContext): Draft | null {
  const w = ctx.state.world;
  if (w.rainfall >= 0.3 || active(ctx, "drought") || recent(ctx, "drought", 6)) return null;
  // The driest populated region suffers most.
  const regions = [...new Set(ctx.state.map.tiles.map((t) => t.region))].sort();
  let worst = regions[0]!;
  let worstScore = Infinity;
  for (const r of regions) {
    const tiles = ctx.state.map.tiles.filter((t) => t.region === r && !isWater(t.biome));
    if (tiles.length < 20) continue;
    const m = tiles.reduce((a, t) => a + t.moisture, 0) / tiles.length - (tiles.some((t) => t.ownerId) ? 0.2 : 0);
    if (m < worstScore) {
      worstScore = m;
      worst = r;
    }
  }
  const tiles = regionTiles(ctx, worst);
  const severity = 0.35 + (0.3 - w.rainfall) * 2;
  const mult = round(1 - 0.25 * severity, 2);
  const factions = factionsInTiles(ctx, tiles);
  return {
    type: "drought", severity, duration: 4, centerTile: tiles[Math.floor(tiles.length / 2)] ?? 0, tiles, factionIds: factions,
    cause: { rainfall: w.rainfall, threshold: 0.3, warming: w.warming, region: worst },
    consequences: [`Food from farms in ${worst} ${Math.round((1 - mult) * 100)}% lower`, "Migration pressure rises among nomads"],
    effects: [{ kind: "yield_mult", resource: "food", mult, factionId: null, tiles: "affected" }, { kind: "stability", delta: -4, factionId: null }],
    immediate: [], major: severity > 0.5, palette: "fire", historyType: "NATURAL_DISASTER",
    summary: `Drought grips ${worst}. Rainfall has fallen to ${Math.round(w.rainfall * 100)}% of normal.`,
  };
}

function detectRiverCrisis(ctx: EngineContext): Draft | null {
  if (active(ctx, "river_crisis") || recent(ctx, "river_crisis", 10)) return null;
  const polluted = ctx.state.map.tiles.filter((t) => t.river && t.pollution > 30);
  if (polluted.length < 2) return null;
  // Attribute blame to the faction owning the most polluting buildings upstream.
  const blame = new Map<string, number>();
  for (const b of ctx.state.buildings) {
    const t = ctx.tile(b.tile);
    if (t.pollution > 15) blame.set(b.ownerId, (blame.get(b.ownerId) ?? 0) + t.pollution);
  }
  const polluter = [...blame.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  const tiles = polluted.map((t) => t.i);
  const avg = polluted.reduce((a, t) => a + t.pollution, 0) / polluted.length;
  if (polluter) ctx.remember("verdant", polluter, "polluted_land", -15);
  return {
    type: "river_crisis", severity: clamp(avg / 70, 0.3, 1), duration: 5, centerTile: tiles[0]!, tiles, factionIds: [polluter ?? PLAYER_ID, "verdant"],
    cause: { pollutedRiverTiles: polluted.length, averagePollution: round(avg, 1), polluter: polluter ?? "unknown" },
    consequences: ["River farms yield 20% less food", "The Verdant Assembly blames the polluter"],
    effects: [{ kind: "yield_mult", resource: "food", mult: 0.8, factionId: null, tiles: "affected" }, { kind: "stability", delta: -5, factionId: polluter }],
    immediate: [polluter ? `Verdant Assembly opinion of ${ctx.factionName(polluter)} -15` : "The rivers sicken"], major: true, palette: "shadow",
    summary: `The River Crisis: industry has fouled the rivers of ${ctx.tile(tiles[0]!).region}. Fish die and farms falter.`,
  };
}

function detectWildfire(ctx: EngineContext): Draft | null {
  const w = ctx.state.world;
  if (w.rainfall > 0.4 || active(ctx, "wildfire") || recent(ctx, "wildfire", 8)) return null;
  if (!ctx.rng.chance(0.18 + w.warming * 0.1)) return null;
  const forests = ctx.state.map.tiles.filter((t) => t.forest > 60).map((t) => t.i);
  if (forests.length === 0) return null;
  const center = ctx.rng.pick(forests);
  const tiles = ctx.grid.within(center, 2).filter((i) => ctx.tile(i).forest > 20);
  for (const i of tiles) {
    const t = ctx.tile(i);
    t.forest = round(t.forest * 0.15, 1);
    t.habitat = Math.max(0, t.habitat - 25);
    if (t.biome === "forest" || t.biome === "taiga") t.biome = "scrubland";
  }
  return {
    type: "wildfire", severity: 0.4 + tiles.length / 40, duration: 0, centerTile: center, tiles, factionIds: factionsInTiles(ctx, tiles),
    cause: { rainfall: w.rainfall, warming: w.warming, forestTilesBurned: tiles.length },
    consequences: ["Forest permanently reduced to scrub", "Timber from the area collapses"], effects: [],
    immediate: [`${tiles.length} forest tiles burned`], major: tiles.length > 8, palette: "fire", historyType: "NATURAL_DISASTER",
    summary: `Wildfire tears through ${ctx.tile(center).region}, driven by drought and heat.`,
  };
}

function detectVolcano(ctx: EngineContext): Draft | null {
  if (ctx.state.turn < 10 || recent(ctx, "volcanic_eruption", 25)) return null;
  if (!ctx.rng.chance(0.025 + ctx.state.era * 0.005)) return null;
  const peaks = ctx.state.map.tiles.filter((t) => t.biome === "mountain").map((t) => t.i);
  if (peaks.length === 0) return null;
  const center = ctx.rng.pick(peaks);
  const tiles = ctx.grid.within(center, 2);
  const lines: string[] = [];
  for (const i of tiles) {
    const t = ctx.tile(i);
    if (isWater(t.biome) || i === center) continue;
    if (t.biome !== "mountain" && t.biome !== "snow") {
      t.biome = "ashland";
      t.forest = 0;
      t.fertility = 75;
    }
    t.habitat = Math.max(0, t.habitat - 30);
    const s = ctx.settlementAt(i);
    if (s) {
      s.population = Math.max(1, s.population - 1);
      s.hp = Math.max(10, s.hp - 30);
      lines.push(`${s.name} is battered by ashfall`);
    }
    const u = ctx.unitAt(i);
    if (u) u.hp = Math.max(1, u.hp - 15);
  }
  return {
    type: "volcanic_eruption", severity: 0.85, duration: 3, centerTile: center, tiles, factionIds: factionsInTiles(ctx, tiles),
    cause: { mountainTile: center, era: ctx.state.era },
    consequences: ["Terrain around the peak becomes ashland — barren now, very fertile later", "Production in the ash zone suffers for 3 turns"],
    effects: [{ kind: "yield_mult", resource: "food", mult: 0.6, factionId: null, tiles: "affected" }, { kind: "yield_mult", resource: "wood", mult: 0.5, factionId: null, tiles: "affected" }],
    immediate: lines, major: true, palette: "fire", historyType: "NATURAL_DISASTER",
    summary: `A mountain in ${ctx.tile(center).region} erupts, burying the land in ash.`,
  };
}

function detectFlood(ctx: EngineContext): Draft | null {
  const w = ctx.state.world;
  if (w.rainfall < 0.8 || active(ctx, "flood") || recent(ctx, "flood", 8)) return null;
  const riverTiles = ctx.state.map.tiles.filter((t) => t.river && t.elevation < 0.5).map((t) => t.i);
  if (riverTiles.length === 0) return null;
  const center = ctx.rng.pick(riverTiles);
  const tiles = ctx.grid.within(center, 2).filter((i) => !isWater(ctx.tile(i).biome));
  for (const i of tiles) {
    const t = ctx.tile(i);
    t.fertility = Math.min(100, t.fertility + 8); // floods enrich soil
    if (t.biome === "plains" && ctx.rng.chance(0.3)) t.biome = "wetland";
  }
  return {
    type: "flood", severity: 0.5, duration: 2, centerTile: center, tiles, factionIds: factionsInTiles(ctx, tiles),
    cause: { rainfall: w.rainfall, threshold: 0.8 },
    consequences: ["Food and wood production in the floodplain halved for 2 turns", "Soil fertility increased afterwards"],
    effects: [{ kind: "yield_mult", resource: "food", mult: 0.5, factionId: null, tiles: "affected" }, { kind: "yield_mult", resource: "wood", mult: 0.5, factionId: null, tiles: "affected" }],
    immediate: ["Some plains turned to wetland"], major: false, palette: "water", historyType: "NATURAL_DISASTER",
    summary: `Torrential rain floods the river valley in ${ctx.tile(center).region}.`,
  };
}

function detectPlague(ctx: EngineContext): Draft | null {
  if (active(ctx, "plague") || recent(ctx, "plague", 15)) return null;
  const crowded = ctx.state.settlements.filter((s) => s.population >= 8).sort((a, b) => b.population - a.population || a.id.localeCompare(b.id));
  const s = crowded[0];
  if (!s) return null;
  const pollution = ctx.tile(s.tile).pollution;
  const tradeLinks = ctx.state.relations.filter((r) => r.trade && (r.a === s.ownerId || r.b === s.ownerId)).length;
  if (!ctx.rng.chance(0.05 + pollution / 300 + tradeLinks * 0.02)) return null;
  return {
    type: "plague", severity: 0.6, duration: 4, centerTile: s.tile, tiles: ctx.grid.within(s.tile, 2), factionIds: [s.ownerId],
    cause: { settlement: s.name, population: s.population, pollution: round(pollution, 1), tradeLinks },
    consequences: [`Growth in ${ctx.factionName(s.ownerId)} lands halved`, "Stability falls"],
    effects: [{ kind: "growth_mult", mult: 0.5, factionId: s.ownerId }, { kind: "stability", delta: -6, factionId: s.ownerId }],
    immediate: [`${s.name} loses 1 population`], major: s.ownerId === PLAYER_ID, palette: "shadow", historyType: "NATURAL_DISASTER",
    summary: `Plague breaks out in crowded ${s.name}${tradeLinks > 0 ? ", carried along the trade roads" : ""}.`,
  };
}

function detectTradeBoom(ctx: EngineContext): Draft | null {
  if (active(ctx, "trade_boom") || recent(ctx, "trade_boom", 10)) return null;
  for (const f of ctx.aliveFactions().sort((a, b) => a.id.localeCompare(b.id))) {
    const links = ctx.state.relations.filter((r) => r.trade && (r.a === f.id || r.b === f.id)).length;
    const market = ctx.state.buildings.some((b) => b.ownerId === f.id && b.type === "market" && b.turnsRemaining === 0);
    if (links >= 2 && market) {
      const cap = ctx.settlementsOf(f.id)[0];
      if (!cap) continue;
      return {
        type: "trade_boom", severity: 0.5, duration: 4, centerTile: cap.tile, tiles: [cap.tile], factionIds: [f.id],
        cause: { faction: f.id, tradeLinks: links, hasMarket: true },
        consequences: ["Influence +30% and food +15% for 4 turns"],
        effects: [{ kind: "yield_mult", resource: "influence", mult: 1.3, factionId: f.id, tiles: "all" }, { kind: "yield_mult", resource: "food", mult: 1.15, factionId: f.id, tiles: "all" }],
        immediate: [], major: f.id === PLAYER_ID, palette: "gold",
        summary: `A trade boom enriches ${ctx.factionName(f.id)} as caravans crowd its markets.`,
      };
    }
  }
  return null;
}

function detectResourceCollapse(ctx: EngineContext, evo: EvolutionResult): Draft | null {
  const d = evo.depletedNodes.find((n) => n.ownerId);
  if (!d) return null;
  const owner = d.ownerId!;
  const resource = d.type === "iron" ? "metal" : d.type === "stone_deposit" ? "stone" : d.type === "sunstone" ? "energy" : "food";
  return {
    type: "resource_collapse", severity: 0.45, duration: 3, centerTile: d.tile, tiles: [d.tile], factionIds: [owner],
    cause: { node: d.type, tile: d.tile, owner },
    consequences: [`${resource} income for ${ctx.factionName(owner)} -15% for 3 turns while the economy adjusts`],
    effects: [{ kind: "yield_mult", resource, mult: 0.85, factionId: owner, tiles: "all" }],
    immediate: [`${resourceLabel(d.type)} deposit exhausted`], major: false, palette: "earth",
    summary: `The ${resourceLabel(d.type)} deposit in ${ctx.tile(d.tile).region} runs dry. ${ctx.factionName(owner)} must look elsewhere.`,
  };
}

function detectRebellion(ctx: EngineContext): Draft | null {
  const unhappy = ctx.state.settlements
    .filter((s) => s.stability < 18 && s.population >= 3 && !s.isCapital)
    .sort((a, b) => a.stability - b.stability || a.id.localeCompare(b.id))[0];
  if (!unhappy || recent(ctx, "rebellion", 6)) return null;
  const owner = ctx.faction(unhappy.ownerId);
  const ownCount = ctx.settlementsOf(owner.id).length;
  if (ownCount < 2) return null;
  const rebel = splitFaction(ctx, owner, unhappy);
  return {
    type: owner.kind === "ai" ? "faction_split" : "rebellion", severity: 0.75, duration: 0, centerTile: unhappy.tile, tiles: [unhappy.tile],
    factionIds: [owner.id, rebel.id], cause: { settlement: unhappy.name, stability: round(unhappy.stability, 0), owner: owner.id },
    consequences: [`${unhappy.name} breaks away as ${rebel.name}`, `${rebel.name} is hostile to its former rulers`],
    effects: [], immediate: [`${owner.kind === "player" ? "You lose" : `${owner.name} loses`} ${unhappy.name}`], major: true, palette: "shadow",
    summary: `Neglected and restless, ${unhappy.name} rises against ${ctx.factionName(owner.id)} and declares itself ${rebel.name}.`,
  };
}

export function splitFaction(ctx: EngineContext, parent: Faction, s: Settlement): Faction {
  const tpl = FACTION_TEMPLATES.find((t) => t.id === parent.id);
  const id = `rebel_${ctx.state.nextId}`;
  const name = `The Free ${s.name}`;
  const rebel: Faction = {
    id, name, adjective: s.name, kind: "ai", archetype: "rebel", color: "#8a8f98",
    identity: `Rebels of ${s.name} who threw off ${parent.kind === "player" ? ctx.state.civilizationName : parent.name}'s rule. ${tpl?.identity ?? ""}`.trim(),
    visualIdentity: `${tpl?.visualIdentity ?? "frontier settlers"}, with torn banners repainted grey`,
    homeBiome: ctx.tile(s.tile).biome,
    resources: { food: 40, wood: 30, stone: 20, metal: 5, energy: 0, knowledge: 10, influence: 10 },
    personality: { ...parent.personality, aggression: clamp(parent.personality.aggression + 0.15, 0, 1), expansion: 0.4, memory: 0.9 },
    opinions: { [parent.id]: -60 }, memories: [], goals: ["independence"],
    research: { known: [...parent.research.known], current: null, progress: 0 },
    posture: { action: "defend", sinceTurn: ctx.state.turn, conservative: false }, alive: true, eliminatedTurn: null,
    defeatsByPlayer: 0, settlementsLost: 0, parentId: parent.id, foundedTurn: ctx.state.turn,
  };
  ctx.state.factions.push(rebel);
  for (const other of ctx.state.factions) if (other.kind === "ai" && other.id !== id) other.opinions[id] = other.opinions[id] ?? 0;
  for (const o of ctx.state.factions) if (o.id !== id && o.id !== parent.id) rebel.opinions[o.id] = 0;
  transferTerritory(ctx, s, id);
  s.ownerId = id;
  s.stability = 60;
  s.isCapital = true;
  parent.settlementsLost += 1;
  for (const u of ctx.state.units.filter((x) => x.tile === s.tile && x.ownerId === parent.id)) u.ownerId = id;
  const rel = ctx.relation(parent.id, id);
  rel.status = "war";
  rel.wars = 1;
  ctx.history({
    type: "FACTION_FOUNDED", importance: 3, actorId: id, targetId: parent.id, tile: s.tile,
    summary: `${name} is born from rebellion against ${ctx.factionName(parent.id)}.`, tags: ["faction", "rebellion", `faction:${id}`],
  });
  return rebel;
}

function detectMigration(ctx: EngineContext): Draft | null {
  if (recent(ctx, "migration", 12)) return null;
  const nomads = ctx.aliveFactions().filter((f) => f.archetype === "nomadic" || f.settlementsLost >= 2).sort((a, b) => a.id.localeCompare(b.id));
  for (const f of nomads) {
    const own = ctx.settlementsOf(f.id);
    const pressured = active(ctx, "drought") && own.some((s) => ctx.state.events.some((e) => e.type === "drought" && e.status === "active" && e.tiles.includes(s.tile)));
    if (!pressured && f.settlementsLost < 2) continue;
    if (own.length === 0 || own.length >= 5) continue;
    // Migrate: found a new camp at the best distant site.
    const origin = own[0]!.tile;
    const sites = ctx.state.map.tiles
      .filter((t) => isValidSettleSite(ctx.state, t.i, f.id) && ctx.grid.distance(origin, t.i) >= 6 && ctx.grid.distance(origin, t.i) <= 14 && t.moisture > 0.35)
      .map((t) => t.i);
    if (sites.length === 0) continue;
    const site = ctx.rng.pick(sites);
    const s = foundSettlement(ctx, f.id, site, { population: 2 });
    return {
      type: "migration", severity: 0.55, duration: 0, centerTile: site, tiles: [origin, site], factionIds: [f.id],
      cause: { faction: f.id, drought: pressured, settlementsLost: f.settlementsLost },
      consequences: [`${f.name} now holds land in ${ctx.tile(site).region}`],
      effects: [], immediate: [`New settlement ${s.name} founded`], major: false, palette: "earth",
      summary: `${pressured ? "Fleeing drought" : "Driven from their lands"}, ${f.name} migrate to ${ctx.tile(site).region} and found ${s.name}.`,
    };
  }
  return null;
}

function detectDescendants(ctx: EngineContext): Draft | null {
  const razings = ctx.state.history.filter((h) => h.type === "SETTLEMENT_RAZED" && ctx.state.turn - h.turn >= 8 && h.tile !== null && !h.tags.includes("descendants_done"));
  for (const h of razings) {
    const tile = h.tile!;
    const t = ctx.tile(tile);
    if (t.ownerId || !isValidSettleSite(ctx.state, tile, "nobody")) continue;
    const founderTag = h.tags.find((x) => x.startsWith("founder:"));
    const nameTag = h.tags.find((x) => x.startsWith("settlement:"));
    const founderId = founderTag?.slice(8) ?? null;
    const oldName = nameTag?.slice(11) ?? "the old town";
    const founder = ctx.factionOrNull(founderId);
    h.tags.push("descendants_done");
    let ownerId: string;
    if (founder?.alive) ownerId = founder.id;
    else {
      const parent = founder ?? ctx.aliveFactions().find((f) => f.kind === "ai")!;
      const heirs: Faction = {
        ...structuredClone(parent),
        id: `heirs_${ctx.state.nextId}`, name: `The Heirs of ${oldName}`, adjective: `${oldName}-born`, kind: "ai", archetype: parent.archetype === "player" ? "rebel" : parent.archetype,
        color: "#b39a7c", alive: true, eliminatedTurn: null, settlementsLost: 0, defeatsByPlayer: 0, parentId: parent.id, foundedTurn: ctx.state.turn,
        resources: { food: 50, wood: 40, stone: 30, metal: 10, energy: 0, knowledge: 20, influence: 15 },
        memories: [], goals: ["remember", "rebuild"], opinions: {},
      };
      for (const o of ctx.state.factions) heirs.opinions[o.id] = h.actorId === o.id ? -50 : 0;
      ctx.state.factions.push(heirs);
      for (const o of ctx.state.factions) if (o.kind === "ai" && o.id !== heirs.id) o.opinions[heirs.id] = 0;
      ownerId = heirs.id;
    }
    const s = foundSettlement(ctx, ownerId, tile, { population: 2, name: `New ${oldName}` });
    if (h.actorId) ctx.remember(ownerId, h.actorId, "razed_settlement", -25);
    return {
      type: "descendants_return", severity: 0.5, duration: 0, centerTile: tile, tiles: [tile], factionIds: [ownerId],
      cause: { razedTurn: h.turn, razedBy: h.actorId ?? "unknown", originalName: oldName },
      consequences: [`${s.name} rises on the ruins`, `Its people remember who destroyed ${oldName}`],
      effects: [], immediate: [], major: true, palette: "life",
      summary: `In year ${ctx.state.turn}, descendants of ${oldName} — razed in year ${h.turn} — return to rebuild. They call their town ${s.name}.`,
    };
  }
  return null;
}

function detectBorderConflict(ctx: EngineContext): Draft | null {
  if (recent(ctx, "border_conflict", 8)) return null;
  for (const f of ctx.aliveFactions().filter((x) => x.kind === "ai").sort((a, b) => a.id.localeCompare(b.id))) {
    for (const [otherId, op] of Object.entries(f.opinions).sort((a, b) => a[0].localeCompare(b[0]))) {
      if (op > -30) continue;
      const rel = ctx.relation(f.id, otherId);
      if (rel.status !== "peace") continue;
      const border = ctx.state.map.tiles.find((t) => t.ownerId === f.id && ctx.grid.neighbors(t.i).some((n) => ctx.tile(n).ownerId === otherId));
      if (!border) continue;
      ctx.remember(f.id, otherId, "border_claim", -5);
      return {
        type: "border_conflict", severity: 0.45, duration: 3, centerTile: border.i, tiles: [border.i], factionIds: [f.id, otherId],
        cause: { faction: f.id, other: otherId, opinion: round(op, 0) },
        consequences: ["Tension along the border; war is more likely", "Stability in the borderlands falls"],
        effects: [{ kind: "stability", delta: -4, factionId: otherId }, { kind: "stability", delta: -4, factionId: f.id }],
        immediate: [`${f.name} opinion of ${ctx.factionName(otherId)} -5`], major: otherId === PLAYER_ID, palette: "fire",
        summary: `Skirmishes flare along the border between ${f.name} and ${ctx.factionName(otherId)}.`,
      };
    }
  }
  return null;
}

function detectEcologicalRecovery(ctx: EngineContext, evo: EvolutionResult): Draft | null {
  if (evo.recovered.length === 0 || recent(ctx, "ecological_recovery", 10)) return null;
  const tile = evo.recovered[0]!;
  ctx.remember("verdant", ctx.tile(tile).ownerId ?? PLAYER_ID, "helped_in_crisis", 8);
  return {
    type: "ecological_recovery", severity: 0.4, duration: 3, centerTile: tile, tiles: evo.recovered.slice(0, 12), factionIds: factionsInTiles(ctx, evo.recovered),
    cause: { recoveredTiles: evo.recovered.length, globalPollution: ctx.state.world.globalPollution },
    consequences: ["Habitat and forests return", "The Verdant Assembly approves"],
    effects: [{ kind: "yield_mult", resource: "food", mult: 1.1, factionId: null, tiles: "affected" }],
    immediate: [], major: false, palette: "life",
    summary: `Life returns to ${ctx.tile(tile).region}: the land is healing.`,
  };
}

function detectReligiousMovement(ctx: EngineContext): Draft | null {
  if (ctx.state.era < 2 || recent(ctx, "religious_movement", 20)) return null;
  const monolith = ctx.state.map.tiles.find((t) => t.poi === "monolith" && t.poiDiscovered);
  if (!monolith || !ctx.rng.chance(0.12)) return null;
  const owners = factionsInTiles(ctx, ctx.grid.within(monolith.i, 8));
  if (owners.length === 0) return null;
  for (const a of owners) for (const b of owners) if (a !== b) ctx.remember(a, b, "shared_enemy", 6);
  return {
    type: "religious_movement", severity: 0.4, duration: 5, centerTile: monolith.i, tiles: [monolith.i], factionIds: owners,
    cause: { monolithTile: monolith.i, nearbyFactions: owners.length },
    consequences: ["Stability +6 for nearby peoples", "Neighbours of the Monolith grow closer"],
    effects: owners.map((o) => ({ kind: "stability" as const, delta: 6, factionId: o })),
    immediate: [], major: false, palette: "arcane",
    summary: `Pilgrims gather at the Monolith in ${monolith.region}. A new faith — the Echoing Way — spreads.`,
  };
}

// ------------------------------------------------------------------ public API

export interface DirectorResult {
  created: WorldEvent[];
}

/** Run once per turn in the EVENTS phase. */
export function runEventDirector(ctx: EngineContext, evo: EvolutionResult): DirectorResult {
  const created: WorldEvent[] = [];
  // Expire finished events.
  for (const e of ctx.state.events) if (e.status === "active" && e.endsTurn <= ctx.state.turn) e.status = "resolved";

  // Consequence events always fire when their cause is present.
  for (const detector of [detectResourceCollapse, detectEcologicalRecovery]) {
    const d = detector(ctx, evo);
    if (d) created.push(createEvent(ctx, d));
  }
  for (const detector of [detectRebellion, detectDescendants]) {
    const d = detector(ctx);
    if (d) created.push(createEvent(ctx, d));
  }
  // Director-paced events: at most one per turn, more likely the calmer the world has been.
  ctx.state.world.calm += 1;
  const paced = [detectRiverCrisis, detectDrought, detectFlood, detectVolcano, detectWildfire, detectPlague, detectMigration, detectTradeBoom, detectBorderConflict, detectReligiousMovement];
  if (ctx.state.turn >= 3 && created.filter((e) => e.major).length === 0) {
    for (const detector of paced) {
      const d = detector(ctx);
      if (d) {
        created.push(createEvent(ctx, d));
        break;
      }
    }
  }
  // Apply immediate population loss for plague.
  for (const e of created) {
    if (e.type === "plague") {
      const s = ctx.settlementAt(e.centerTile);
      if (s) s.population = Math.max(1, s.population - 1);
    }
  }
  // Keep the event list compact: resolved events older than 30 turns are dropped from state (history keeps them).
  ctx.state.events = ctx.state.events.filter((e) => e.status === "active" || ctx.state.turn - e.turn < 30);
  return { created };
}

export function activeStabilityDelta(ctx: EngineContext, factionId: string): number {
  let d = 0;
  for (const e of ctx.state.events) {
    if (e.status !== "active") continue;
    for (const eff of e.effects) if (eff.kind === "stability" && (eff.factionId === null || eff.factionId === factionId)) d += eff.delta;
  }
  return d;
}

export function activeGrowthMult(ctx: EngineContext, factionId: string): number {
  let m = 1;
  for (const e of ctx.state.events) {
    if (e.status !== "active") continue;
    for (const eff of e.effects) if (eff.kind === "growth_mult" && (eff.factionId === null || eff.factionId === factionId)) m *= eff.mult;
  }
  return m;
}
