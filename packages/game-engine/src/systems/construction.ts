import type { BuildingType, GameState, Settlement, UnitType } from "@echoes/game-types";
import { getGrid, isWater } from "@echoes/procedural-world";
import { BUILDINGS } from "../content/buildings";
import { PLAYER_SETTLEMENT_NAMES, FACTION_TEMPLATES } from "../content/factions";
import { techModifiers } from "../content/techs";
import { UNITS } from "../content/units";
import type { EngineContext } from "../context";
import { claimTerritory, isValidSettleSite, territoryRadius } from "./territory";

/** Validate placing `type` on `tileIndex` for `factionId`. Returns an error message or null. */
export function canBuild(state: GameState, factionId: string, type: BuildingType, tileIndex: number, workerId?: string): string | null {
  const def = BUILDINGS[type];
  const tile = state.map.tiles[tileIndex];
  const faction = state.factions.find((f) => f.id === factionId);
  if (!tile || !faction) return "Invalid target.";
  if (isWater(tile.biome)) return "Cannot build on water.";
  if (def.requiresTech && !faction.research.known.includes(def.requiresTech)) return `Requires the ${def.requiresTech.replace(/_/g, " ")} technology.`;
  const mods = techModifiers(faction.research.known);
  for (const [r, v] of Object.entries(def.cost)) {
    if ((faction.resources[r as keyof typeof faction.resources] ?? 0) < (v ?? 0)) return `Not enough ${r}.`;
  }
  if (type === "settlement_center") {
    if (!workerId) return "A Worker must found the settlement.";
    const worker = state.units.find((u) => u.id === workerId);
    if (!worker || worker.ownerId !== factionId || worker.type !== "worker") return "A Worker must found the settlement.";
    if (worker.tile !== tileIndex) return "The Worker must stand on the site.";
    if (!isValidSettleSite(state, tileIndex, factionId)) return "Too close to another settlement or not a valid site.";
    return null;
  }
  if (tile.ownerId !== factionId || !tile.settlementId) return "Must be built inside your territory.";
  if (tile.buildingId) return "This tile already has a building.";
  if (state.settlements.some((s) => s.tile === tileIndex)) return "This tile is a settlement center.";
  const biomeOk = def.biomes === null || def.biomes.includes(tile.biome) ||
    (type === "farm" && (mods.farmAnyBiome > 0 || (mods.farmDesert > 0 && tile.biome === "desert"))) ||
    (type === "mine" && (tile.resource?.type === "iron" || tile.resource?.type === "sunstone" || tile.resource?.type === "relic"));
  if (!biomeOk) return `A ${def.name} cannot be built on ${tile.biome}.`;
  if (type === "lumber_camp" && tile.forest < 10) return "Not enough forest here.";
  const settlementBuildings = state.buildings.filter((b) => b.settlementId === tile.settlementId);
  if ((type === "wall" || type === "barracks" || type === "market" || type === "warehouse") && settlementBuildings.some((b) => b.type === type)) {
    return `This settlement already has a ${def.name}.`;
  }
  if (settlementBuildings.length >= 12) return "This settlement has no room for more buildings.";
  return null;
}

export function placeBuilding(ctx: EngineContext, factionId: string, type: BuildingType, tileIndex: number): string {
  const def = BUILDINGS[type];
  const tile = ctx.tile(tileIndex);
  ctx.pay(factionId, def.cost);
  const id = ctx.id("b");
  ctx.state.buildings.push({
    id, type, tile: tileIndex, settlementId: tile.settlementId!, ownerId: factionId,
    turnsRemaining: def.buildTurns, builtTurn: ctx.state.turn, hp: def.hp,
  });
  tile.buildingId = id;
  ctx.history({
    type: "PLAYER_BUILT_BUILDING", importance: factionId === "player" ? 1 : 1, actorId: factionId, targetId: null, tile: tileIndex,
    summary: `${ctx.factionName(factionId)} began building a ${def.name} in ${tile.region}.`, tags: ["construction", `building:${type}`],
  });
  return id;
}

function nextSettlementName(ctx: EngineContext, factionId: string): string {
  const tpl = FACTION_TEMPLATES.find((t) => t.id === factionId);
  const pool = factionId === "player" ? PLAYER_SETTLEMENT_NAMES : tpl?.settlementNames ?? ["Outpost"];
  const used = new Set(ctx.state.settlements.map((s) => s.name));
  const free = pool.filter((n) => !used.has(n));
  if (free.length > 0) return ctx.rng.pick(free);
  return `${ctx.rng.pick(pool)} ${["Minor", "Reach", "Hold", "Rest"][ctx.state.settlements.length % 4]}`;
}

export function foundSettlement(ctx: EngineContext, factionId: string, tileIndex: number, opts: { isCapital?: boolean; population?: number; name?: string } = {}): Settlement {
  const tile = ctx.tile(tileIndex);
  const id = ctx.id("s");
  const s: Settlement = {
    id, name: opts.name ?? nextSettlementName(ctx, factionId), ownerId: factionId, tile: tileIndex,
    population: opts.population ?? 2, growth: 0, hp: 100, maxHp: 100, stability: 70, foundedTurn: ctx.state.turn,
    isCapital: opts.isCapital ?? false, radius: territoryRadius(ctx.state, factionId), training: null, founderId: factionId,
  };
  ctx.state.settlements.push(s);
  const bid = ctx.id("b");
  ctx.state.buildings.push({ id: bid, type: "settlement_center", tile: tileIndex, settlementId: id, ownerId: factionId, turnsRemaining: 0, builtTurn: ctx.state.turn, hp: 100 });
  tile.buildingId = bid;
  // A ruin under a new settlement is restored.
  if (tile.poi === "ruins") tile.poi = null;
  claimTerritory(ctx, s);
  ctx.history({
    type: "SETTLEMENT_FOUNDED", importance: 2, actorId: factionId, targetId: null, tile: tileIndex,
    summary: `${ctx.factionName(factionId)} founded ${s.name} in ${tile.region}.`, tags: ["settlement", `settlement:${s.name}`],
  });
  return s;
}

export function canTrain(state: GameState, factionId: string, settlementId: string, unitType: UnitType): string | null {
  const s = state.settlements.find((x) => x.id === settlementId);
  const f = state.factions.find((x) => x.id === factionId);
  if (!s || !f || s.ownerId !== factionId) return "Not your settlement.";
  if (s.training) return "This settlement is already training a unit.";
  const def = UNITS[unitType];
  if (def.requiresTech && !f.research.known.includes(def.requiresTech)) return `Requires ${def.requiresTech.replace(/_/g, " ")}.`;
  if (def.requiresBuilding && !state.buildings.some((b) => b.settlementId === s.id && b.type === def.requiresBuilding && b.turnsRemaining === 0)) {
    return "Requires a Barracks in this settlement.";
  }
  for (const [r, v] of Object.entries(def.cost)) {
    if ((f.resources[r as keyof typeof f.resources] ?? 0) < (v ?? 0)) return `Not enough ${r}.`;
  }
  if (unitType === "worker" && s.population < 2) return "Settlement needs at least 2 population to spare a Worker.";
  const count = state.units.filter((u) => u.ownerId === factionId).length;
  if (count >= 6 + state.settlements.filter((x) => x.ownerId === factionId).length * 4) return "Unit limit reached — found more settlements.";
  return null;
}

export function startTraining(ctx: EngineContext, factionId: string, settlementId: string, unitType: UnitType): void {
  const s = ctx.settlement(settlementId)!;
  const def = UNITS[unitType];
  ctx.pay(factionId, def.cost);
  if (unitType === "worker") s.population -= 1;
  s.training = { unitType, turnsRemaining: def.trainTurns };
}

export function spawnUnit(ctx: EngineContext, factionId: string, unitType: UnitType, nearTile: number): string | null {
  const grid = getGrid(ctx.state.map.width, ctx.state.map.height);
  const candidates = [nearTile, ...grid.within(nearTile, 2).filter((i) => i !== nearTile)];
  for (const i of candidates) {
    const t = ctx.tile(i);
    if (isWater(t.biome) || ctx.unitAt(i)) continue;
    const settlement = ctx.settlementAt(i);
    if (settlement && settlement.ownerId !== factionId) continue;
    const def = UNITS[unitType];
    const id = ctx.id("u");
    ctx.state.units.push({
      id, type: unitType, ownerId: factionId, tile: i, hp: def.hp, maxHp: def.hp, movesLeft: def.moves,
      morale: 70, status: "idle", xp: 0, attacked: false, prevTile: i,
    });
    ctx.invalidateUnits();
    return id;
  }
  return null;
}
