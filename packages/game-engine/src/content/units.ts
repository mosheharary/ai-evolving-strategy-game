import type { Biome, Resources, UnitType } from "@echoes/game-types";

export interface UnitDef {
  type: UnitType;
  name: string;
  description: string;
  cost: Partial<Resources>;
  trainTurns: number;
  hp: number;
  attack: number;
  defense: number;
  moves: number;
  range: number;
  vision: number;
  upkeepFood: number;
  military: boolean;
  requiresBuilding: "barracks" | null;
  requiresTech: string | null;
}

export const UNITS: Record<UnitType, UnitDef> = {
  worker: {
    type: "worker", name: "Worker", description: "Gathers resources directly and founds new settlements.",
    cost: { food: 20 }, trainTurns: 1, hp: 20, attack: 0, defense: 2, moves: 2, range: 0, vision: 2,
    upkeepFood: 0.5, military: false, requiresBuilding: null, requiresTech: null,
  },
  scout: {
    type: "scout", name: "Scout", description: "Fast, far-seeing. Weak in a fight.",
    cost: { food: 15, wood: 5 }, trainTurns: 1, hp: 30, attack: 3, defense: 2, moves: 4, range: 1, vision: 3,
    upkeepFood: 0.5, military: true, requiresBuilding: null, requiresTech: null,
  },
  explorer: {
    type: "explorer", name: "Explorer", description: "Charts the frontier; uncovers sites and ruins for rewards.",
    cost: { food: 20, wood: 10, knowledge: 10 }, trainTurns: 2, hp: 35, attack: 2, defense: 4, moves: 3, range: 1, vision: 4,
    upkeepFood: 0.5, military: false, requiresBuilding: null, requiresTech: "cartography",
  },
  guard: {
    type: "guard", name: "Guard", description: "Sturdy melee defender.",
    cost: { food: 20, wood: 15 }, trainTurns: 2, hp: 60, attack: 8, defense: 12, moves: 2, range: 1, vision: 2,
    upkeepFood: 1, military: true, requiresBuilding: "barracks", requiresTech: null,
  },
  ranged: {
    type: "ranged", name: "Archer", description: "Attacks from two hexes away without retaliation.",
    cost: { food: 20, wood: 25 }, trainTurns: 2, hp: 45, attack: 11, defense: 6, moves: 2, range: 2, vision: 2,
    upkeepFood: 1, military: true, requiresBuilding: "barracks", requiresTech: "archery",
  },
  heavy: {
    type: "heavy", name: "Ironclad", description: "Slow, armoured shock troops.",
    cost: { food: 30, metal: 25 }, trainTurns: 3, hp: 90, attack: 16, defense: 14, moves: 1, range: 1, vision: 2,
    upkeepFood: 1.5, military: true, requiresBuilding: "barracks", requiresTech: "metallurgy",
  },
};

export const MOVE_COST: Record<Biome, number> = {
  ocean: Infinity, shallows: Infinity, lake: Infinity,
  beach: 1, plains: 1, grassland: 1, desert: 1, tundra: 1, scrubland: 1, ashland: 1, blighted: 1,
  forest: 2, taiga: 2, wetland: 2, hills: 2, mountain: 3, snow: 3,
};

export const DEFENSE_TERRAIN: Partial<Record<Biome, number>> = {
  forest: 1.25, taiga: 1.25, wetland: 1.1, hills: 1.35, mountain: 1.6, snow: 1.3,
};
