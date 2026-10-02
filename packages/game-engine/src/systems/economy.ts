import type { Building, GameState, ResourceType, Resources, Settlement, Tile } from "@echoes/game-types";
import { RESOURCE_TYPES } from "@echoes/game-types";
import { clamp, round } from "@echoes/shared";
import { BASE_STORAGE, BUILDINGS } from "../content/buildings";
import { techModifiers, type TechModifiers } from "../content/techs";
import { UNITS } from "../content/units";
import { FACTION_TEMPLATES } from "../content/factions";

export const emptyResources = (): Resources => ({ food: 0, wood: 0, stone: 0, metal: 0, energy: 0, knowledge: 0, influence: 0 });

export interface BuildingYield {
  buildingId: string;
  type: Building["type"];
  staffed: number;
  output: Resources;
  upkeep: Resources;
  pollution: number;
}

export interface SettlementEconomy {
  settlementId: string;
  jobsTotal: number;
  jobsFilled: number;
  housing: number;
  buildings: BuildingYield[];
}

export interface FactionEconomy {
  factionId: string;
  income: Resources;
  upkeep: Resources;
  net: Resources;
  trade: Resources;
  storageCap: Resources;
  pollution: number;
  settlements: SettlementEconomy[];
  modifiers: TechModifiers;
}

const MULT_KEY: Record<ResourceType, keyof TechModifiers> = {
  food: "foodMult", wood: "woodMult", stone: "stoneMult", metal: "metalMult",
  energy: "energyMult", knowledge: "knowledgeMult", influence: "influenceMult",
};

export const DIFFICULTY_AI_YIELD = { settler: 0.85, governor: 1, warlord: 1.2 } as const;
export const DIFFICULTY_PLAYER_YIELD = { settler: 1.15, governor: 1, warlord: 0.95 } as const;

/** Event-driven yield multiplier for a resource on a tile for a faction. */
function eventMultiplier(state: GameState, factionId: string, resource: ResourceType, tileIndex: number | null): number {
  let m = 1;
  for (const e of state.events) {
    if (e.status !== "active") continue;
    for (const eff of e.effects) {
      if (eff.kind !== "yield_mult" || eff.resource !== resource) continue;
      if (eff.factionId && eff.factionId !== factionId) continue;
      if (eff.tiles === "affected" && (tileIndex === null || !e.tiles.includes(tileIndex))) continue;
      m *= eff.mult;
    }
  }
  return m;
}

function buildingBaseOutput(def: (typeof BUILDINGS)[keyof typeof BUILDINGS], tile: Tile, mods: TechModifiers, settlement: Settlement): Resources {
  const out = emptyResources();
  for (const r of RESOURCE_TYPES) out[r] = def.output[r] ?? 0;
  switch (def.type) {
    case "settlement_center":
      out.knowledge += settlement.population * 0.2;
      out.influence += settlement.population * 0.1 + mods.influencePerSettlement;
      break;
    case "farm": {
      const fert = clamp(tile.fertility / 60, 0.3, 1.5);
      out.food = out.food * fert + mods.farmFlat + (tile.river ? 1 : 0);
      if (tile.resource?.type === "game_herd" && tile.resource.amount > 0) out.food += 2;
      break;
    }
    case "lumber_camp":
      out.wood = out.wood * clamp(tile.forest / 60, 0.2, 1.4);
      break;
    case "quarry":
      out.stone += mods.quarryFlat + (tile.biome === "hills" || tile.biome === "mountain" ? 1 : 0);
      if (tile.resource?.type === "stone_deposit" && tile.resource.amount > 0) out.stone += 3;
      break;
    case "mine":
      if (tile.resource?.type === "sunstone" && tile.resource.amount > 0) {
        out.metal = 0;
        out.energy = 6;
      } else if (tile.resource?.type === "iron" && tile.resource.amount > 0) {
        out.metal = 6 + mods.mineFlat;
      } else {
        out.metal = 2 + mods.mineFlat;
      }
      if (tile.resource?.type === "relic" && tile.resource.amount > 0) out.knowledge += 3;
      break;
    case "laboratory":
      out.knowledge += mods.labFlat;
      break;
    case "market":
      out.influence += tile.prosperity / 25;
      break;
    default:
      break;
  }
  // Prosperous tiles (trade routes) yield a little more of everything they produce.
  if (tile.prosperity > 20) {
    for (const r of RESOURCE_TYPES) if (out[r] > 0) out[r] *= 1 + tile.prosperity / 500;
  }
  // Pollution damages output of farms and lumber.
  if ((def.type === "farm" || def.type === "lumber_camp") && tile.pollution > 30) {
    const p = 1 - (tile.pollution - 30) / 140;
    out.food *= p;
    out.wood *= p;
  }
  if (tile.resource?.type === "fish" && def.type === "settlement_center") out.food += 2;
  return out;
}

export function settlementHousing(state: GameState, s: Settlement, mods: TechModifiers): number {
  let housing = BUILDINGS.settlement_center.housing + mods.housing;
  for (const b of state.buildings) {
    if (b.settlementId === s.id && b.turnsRemaining === 0 && b.type !== "settlement_center") housing += BUILDINGS[b.type].housing;
  }
  return housing;
}

export function storageCaps(state: GameState, factionId: string): Resources {
  let cap = BASE_STORAGE;
  for (const b of state.buildings) {
    if (b.ownerId === factionId && b.turnsRemaining === 0) cap += BUILDINGS[b.type].storage;
  }
  const caps = emptyResources();
  for (const r of RESOURCE_TYPES) caps[r] = cap;
  caps.knowledge = Math.max(cap, 400);
  caps.influence = 999;
  return caps;
}

/**
 * Compute a faction's full economy for the coming turn. Pure function of state:
 * shared by the authoritative turn resolution and by the client for previews.
 */
export function computeFactionEconomy(state: GameState, factionId: string): FactionEconomy {
  const faction = state.factions.find((f) => f.id === factionId);
  const mods = techModifiers(faction?.research.known ?? []);
  const income = emptyResources();
  const upkeep = emptyResources();
  const trade = emptyResources();
  const settlements: SettlementEconomy[] = [];
  let pollution = 0;
  const diff = state.config.difficulty;
  const difficultyMult = faction?.kind === "ai" ? DIFFICULTY_AI_YIELD[diff] : DIFFICULTY_PLAYER_YIELD[diff];
  const tiles = state.map.tiles;

  for (const s of state.settlements) {
    if (s.ownerId !== factionId) continue;
    const housing = settlementHousing(state, s, mods);
    let workforce = Math.floor(s.population);
    let jobsTotal = 0;
    const yields: BuildingYield[] = [];
    const sBuildings = state.buildings.filter((b) => b.settlementId === s.id && b.turnsRemaining === 0);
    const hasWorkshop = sBuildings.some((b) => b.type === "workshop");
    const stabilityFactor = s.stability < 25 ? 0.75 : 1;
    for (const b of sBuildings) {
      const def = BUILDINGS[b.type];
      const tile = tiles[b.tile];
      if (!tile) continue;
      const jobs = def.jobs >= 2 ? Math.max(1, def.jobs - mods.jobsReduction) : def.jobs;
      jobsTotal += jobs;
      let staffed = 1;
      if (jobs > 0) {
        const filled = Math.min(jobs, workforce);
        workforce -= filled;
        staffed = filled / jobs;
      }
      const base = buildingBaseOutput(def, tile, mods, s);
      const out = emptyResources();
      for (const r of RESOURCE_TYPES) {
        let v = base[r] * staffed;
        if (v <= 0) continue;
        v *= 1 + mods[MULT_KEY[r]];
        if (hasWorkshop && (r === "wood" || r === "stone" || r === "metal")) v *= 1.2;
        v *= eventMultiplier(state, factionId, r, b.tile);
        v *= difficultyMult * stabilityFactor;
        out[r] = round(v, 2);
        income[r] += out[r];
      }
      const up = emptyResources();
      for (const r of RESOURCE_TYPES) up[r] = (def.upkeep[r] ?? 0) * (staffed > 0 ? 1 : 0);
      if (b.type === "power_plant" && mods.powerPlantNoFuel > 0) up.wood = 0;
      if (b.type === "farm" && mods.farmAnyBiome > 0) up.energy += 0.5;
      for (const r of RESOURCE_TYPES) upkeep[r] += up[r];
      let pol = def.pollution * staffed * Math.max(0, 1 + mods.pollutionMult);
      if (b.type === "power_plant") pol *= Math.max(0.1, 1 + mods.powerPlantPollutionMult);
      pol = round(pol, 2);
      pollution += pol;
      yields.push({ buildingId: b.id, type: b.type, staffed: round(staffed, 2), output: out, upkeep: up, pollution: pol });
    }
    upkeep.food += s.population; // every citizen eats
    settlements.push({ settlementId: s.id, jobsTotal, jobsFilled: jobsTotal - Math.max(0, jobsTotal - Math.floor(s.population)), housing, buildings: yields });
  }

  for (const u of state.units) {
    if (u.ownerId === factionId) upkeep.food += UNITS[u.type].upkeepFood;
  }

  // Trade agreements.
  const hasMarket = state.buildings.some((b) => b.ownerId === factionId && b.type === "market" && b.turnsRemaining === 0);
  const tradeMult = 1 + mods.tradeMult + (hasMarket ? 0.5 : 0);
  for (const rel of state.relations) {
    if (!rel.trade || (rel.a !== factionId && rel.b !== factionId)) continue;
    const partnerId = rel.a === factionId ? rel.b : rel.a;
    const partner = state.factions.find((f) => f.id === partnerId);
    if (!partner?.alive) continue;
    const partnerTpl = FACTION_TEMPLATES.find((t) => t.id === partner.id);
    trade.influence += 2 * tradeMult;
    trade.knowledge += 1 * tradeMult;
    trade.food += 2 * tradeMult;
    const specialty: ResourceType =
      partnerTpl?.archetype === "aggressive" ? "metal" : partnerTpl?.archetype === "ecological" ? "wood" :
      partnerTpl?.archetype === "technocratic" ? "knowledge" : partnerTpl?.archetype === "nomadic" ? "food" : "stone";
    trade[specialty] += 2 * tradeMult;
  }
  for (const r of RESOURCE_TYPES) {
    trade[r] = round(trade[r], 2);
    income[r] += trade[r];
  }

  // Sanctions bite into influence income.
  const sanctions = state.relations.filter(
    (rel) => (rel.a === factionId || rel.b === factionId) && rel.sanctionsBy.some((x) => x !== factionId),
  ).length;
  if (sanctions > 0) income.influence *= Math.max(0.4, 1 - 0.3 * sanctions);

  const net = emptyResources();
  for (const r of RESOURCE_TYPES) {
    income[r] = round(income[r], 2);
    upkeep[r] = round(upkeep[r], 2);
    net[r] = round(income[r] - upkeep[r], 2);
  }
  return { factionId, income, upkeep, net, trade, storageCap: storageCaps(state, factionId), pollution: round(pollution, 2), settlements, modifiers: mods };
}

export function militaryStrength(state: GameState, factionId: string): number {
  const faction = state.factions.find((f) => f.id === factionId);
  const mods = techModifiers(faction?.research.known ?? []);
  let s = 0;
  for (const u of state.units) {
    if (u.ownerId !== factionId) continue;
    const d = UNITS[u.type];
    if (!d.military) continue;
    s += ((d.attack + d.defense) / 2) * (u.hp / u.maxHp) * (1 + (mods.attackMult + mods.defenseMult) / 2);
  }
  for (const st of state.settlements) if (st.ownerId === factionId) s += 4 + st.population * 0.5;
  return round(s, 1);
}
