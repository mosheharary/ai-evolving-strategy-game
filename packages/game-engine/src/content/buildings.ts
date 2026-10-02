import type { Biome, BuildingType, ResourceType, Resources } from "@echoes/game-types";

export interface BuildingDef {
  type: BuildingType;
  name: string;
  description: string;
  cost: Partial<Resources>;
  buildTurns: number;
  /** Base output per turn when fully staffed (before terrain/tech modifiers). */
  output: Partial<Resources>;
  upkeep: Partial<Resources>;
  /** Population needed to staff it. */
  jobs: number;
  pollution: number;
  requiresTech: string | null;
  /** Biomes it can be placed on; null = any land. */
  biomes: readonly Biome[] | null;
  storage: number;
  housing: number;
  hp: number;
  category: "core" | "economy" | "science" | "military" | "infrastructure";
}

const FARMLAND: Biome[] = ["plains", "grassland", "wetland", "scrubland", "ashland", "beach"];
const ANY_LAND: Biome[] = ["plains", "grassland", "forest", "taiga", "desert", "tundra", "wetland", "hills", "beach", "scrubland", "ashland", "blighted"];

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  settlement_center: {
    type: "settlement_center", name: "Settlement Center",
    description: "Founds a new settlement and claims territory. Requires a Worker on the tile.",
    cost: { food: 30, wood: 40, stone: 20 }, buildTurns: 0,
    output: { food: 4, wood: 1, energy: 1, knowledge: 2, influence: 1 }, upkeep: {},
    jobs: 0, pollution: 0, requiresTech: null, biomes: ANY_LAND, storage: 50, housing: 6, hp: 100, category: "core",
  },
  farm: {
    type: "farm", name: "Farm", description: "Grows food. Output scales with soil fertility; heavy use depletes the soil.",
    cost: { wood: 15 }, buildTurns: 1, output: { food: 4 }, upkeep: {},
    jobs: 1, pollution: 0, requiresTech: null, biomes: FARMLAND, storage: 0, housing: 1, hp: 30, category: "economy",
  },
  lumber_camp: {
    type: "lumber_camp", name: "Lumber Camp", description: "Harvests timber from forest. Depletes the forest over time.",
    cost: { wood: 5, stone: 5 }, buildTurns: 1, output: { wood: 4 }, upkeep: {},
    jobs: 1, pollution: 0, requiresTech: null, biomes: ["forest", "taiga", "wetland", "hills", "grassland"], storage: 0, housing: 0, hp: 30, category: "economy",
  },
  quarry: {
    type: "quarry", name: "Quarry", description: "Cuts stone. Much stronger on hills and stone deposits.",
    cost: { wood: 20 }, buildTurns: 1, output: { stone: 3 }, upkeep: {},
    jobs: 1, pollution: 1, requiresTech: null, biomes: ["hills", "plains", "desert", "tundra", "scrubland", "beach", "mountain"], storage: 0, housing: 0, hp: 40, category: "economy",
  },
  mine: {
    type: "mine", name: "Mine", description: "Extracts metal (or sunstone energy) from deposits. Pollutes.",
    cost: { wood: 25, stone: 10 }, buildTurns: 2, output: { metal: 3 }, upkeep: {},
    jobs: 1, pollution: 2, requiresTech: "mining", biomes: ["hills", "mountain", "tundra", "desert"], storage: 0, housing: 0, hp: 40, category: "economy",
  },
  workshop: {
    type: "workshop", name: "Workshop", description: "+20% wood, stone and metal in this settlement and +1 knowledge.",
    cost: { wood: 30, stone: 25 }, buildTurns: 2, output: { knowledge: 1 }, upkeep: { energy: 1 },
    jobs: 1, pollution: 1, requiresTech: "masonry", biomes: null, storage: 0, housing: 0, hp: 50, category: "economy",
  },
  warehouse: {
    type: "warehouse", name: "Warehouse", description: "+150 storage for every resource.",
    cost: { wood: 35, stone: 10 }, buildTurns: 1, output: {}, upkeep: {},
    jobs: 0, pollution: 0, requiresTech: null, biomes: null, storage: 150, housing: 0, hp: 50, category: "infrastructure",
  },
  laboratory: {
    type: "laboratory", name: "Laboratory", description: "Generates knowledge for research.",
    cost: { wood: 15, stone: 30, metal: 10 }, buildTurns: 2, output: { knowledge: 4 }, upkeep: { energy: 1 },
    jobs: 2, pollution: 0, requiresTech: "writing", biomes: null, storage: 0, housing: 0, hp: 50, category: "science",
  },
  market: {
    type: "market", name: "Market", description: "Generates influence and boosts trade income by 50%. Builds prosperity.",
    cost: { wood: 30, stone: 20, influence: 10 }, buildTurns: 2, output: { influence: 2, food: 1 }, upkeep: {},
    jobs: 1, pollution: 0, requiresTech: "currency", biomes: null, storage: 25, housing: 1, hp: 50, category: "economy",
  },
  barracks: {
    type: "barracks", name: "Barracks", description: "Allows training military units. Units heal faster here.",
    cost: { wood: 30, stone: 15 }, buildTurns: 1, output: {}, upkeep: { food: 1 },
    jobs: 1, pollution: 0, requiresTech: null, biomes: null, storage: 0, housing: 0, hp: 60, category: "military",
  },
  wall: {
    type: "wall", name: "Wall", description: "+50% settlement defense and +40 settlement HP.",
    cost: { stone: 45 }, buildTurns: 2, output: {}, upkeep: {},
    jobs: 0, pollution: 0, requiresTech: "fortification", biomes: null, storage: 0, housing: 0, hp: 120, category: "military",
  },
  watchtower: {
    type: "watchtower", name: "Watchtower", description: "Reveals a wide area and strengthens nearby defenders.",
    cost: { wood: 20, stone: 15 }, buildTurns: 1, output: {}, upkeep: {},
    jobs: 0, pollution: 0, requiresTech: null, biomes: null, storage: 0, housing: 0, hp: 60, category: "military",
  },
  power_plant: {
    type: "power_plant", name: "Power Plant", description: "Large energy output, burns timber and pollutes heavily.",
    cost: { stone: 40, metal: 25 }, buildTurns: 3, output: { energy: 7 }, upkeep: { wood: 2 },
    jobs: 2, pollution: 5, requiresTech: "steam_power", biomes: null, storage: 0, housing: 0, hp: 70, category: "infrastructure",
  },
};

export const BASE_STORAGE = 150;

export function costEntries(cost: Partial<Resources>): [ResourceType, number][] {
  return (Object.entries(cost) as [ResourceType, number][]).filter(([, v]) => v > 0);
}
