export type TechBranch = "agriculture" | "industry" | "society" | "science" | "ecology" | "military";

/** Mechanical modifiers. Every technology changes at least one of these — none are cosmetic. */
export interface TechModifiers {
  foodMult: number;
  woodMult: number;
  stoneMult: number;
  metalMult: number;
  energyMult: number;
  knowledgeMult: number;
  influenceMult: number;
  farmFlat: number;
  quarryFlat: number;
  mineFlat: number;
  labFlat: number;
  growthMult: number;
  housing: number;
  stability: number;
  fertilityDepletionMult: number;
  forestDepletionMult: number;
  forestRegrowth: number;
  pollutionMult: number;
  pollutionDecay: number;
  powerPlantPollutionMult: number;
  powerPlantNoFuel: number;
  tradeMult: number;
  attackMult: number;
  defenseMult: number;
  settlementDefense: number;
  flankMult: number;
  morale: number;
  vision: number;
  jobsReduction: number;
  farmAnyBiome: number;
  farmDesert: number;
  allowAlliance: number;
  influencePerSettlement: number;
  tradeOpinionDrift: number;
  radius: number;
}

export const ZERO_MODIFIERS: TechModifiers = {
  foodMult: 0, woodMult: 0, stoneMult: 0, metalMult: 0, energyMult: 0, knowledgeMult: 0, influenceMult: 0,
  farmFlat: 0, quarryFlat: 0, mineFlat: 0, labFlat: 0, growthMult: 0, housing: 0, stability: 0,
  fertilityDepletionMult: 0, forestDepletionMult: 0, forestRegrowth: 0, pollutionMult: 0, pollutionDecay: 0,
  powerPlantPollutionMult: 0, powerPlantNoFuel: 0, tradeMult: 0, attackMult: 0, defenseMult: 0,
  settlementDefense: 0, flankMult: 0, morale: 0, vision: 0, jobsReduction: 0, farmAnyBiome: 0, farmDesert: 0,
  allowAlliance: 0, influencePerSettlement: 0, tradeOpinionDrift: 0, radius: 0,
};

export interface TechDef {
  id: string;
  name: string;
  branch: TechBranch;
  era: number;
  cost: number;
  requires: string[];
  description: string;
  effects: Partial<TechModifiers>;
  unlocks: string[];
}

const t = (d: TechDef): TechDef => d;

export const TECHS: TechDef[] = [
  // Agriculture
  t({ id: "irrigation", name: "Irrigation", branch: "agriculture", era: 1, cost: 24, requires: [],
    description: "Farms +1 food; farms may be built on desert.", effects: { farmFlat: 1, farmDesert: 1 }, unlocks: [] }),
  t({ id: "selective_breeding", name: "Selective Breeding", branch: "agriculture", era: 1, cost: 34, requires: ["irrigation"],
    description: "Population grows 30% faster; +1 housing.", effects: { growthMult: 0.3, housing: 1 }, unlocks: [] }),
  t({ id: "crop_rotation", name: "Crop Rotation", branch: "agriculture", era: 2, cost: 70, requires: ["irrigation"],
    description: "Farms no longer deplete soil; +10% food.", effects: { fertilityDepletionMult: -1, foodMult: 0.1 }, unlocks: [] }),
  t({ id: "hydroponics", name: "Hydroponics", branch: "agriculture", era: 3, cost: 150, requires: ["crop_rotation", "steam_power"],
    description: "Farms on any land; farms +2 food.", effects: { farmAnyBiome: 1, farmFlat: 2 }, unlocks: [] }),
  // Industry
  t({ id: "mining", name: "Mining", branch: "industry", era: 1, cost: 22, requires: [],
    description: "Unlocks the Mine.", effects: { metalMult: 0.05 }, unlocks: ["mine"] }),
  t({ id: "masonry", name: "Masonry", branch: "industry", era: 1, cost: 28, requires: [],
    description: "Unlocks the Workshop; quarries +1 stone.", effects: { quarryFlat: 1 }, unlocks: ["workshop"] }),
  t({ id: "metallurgy", name: "Metallurgy", branch: "industry", era: 2, cost: 72, requires: ["mining"],
    description: "Mines +2 metal; unlocks Ironclads; +10% attack.", effects: { mineFlat: 2, attackMult: 0.1 }, unlocks: ["heavy"] }),
  t({ id: "steam_power", name: "Steam Power", branch: "industry", era: 2, cost: 95, requires: ["metallurgy", "masonry"],
    description: "Unlocks the Power Plant; +10% energy.", effects: { energyMult: 0.1 }, unlocks: ["power_plant"] }),
  t({ id: "automation", name: "Automation", branch: "industry", era: 3, cost: 160, requires: ["steam_power"],
    description: "Large buildings need one fewer worker; +15% wood, stone, metal. Pollution +20%.",
    effects: { jobsReduction: 1, woodMult: 0.15, stoneMult: 0.15, metalMult: 0.15, pollutionMult: 0.2 }, unlocks: [] }),
  t({ id: "advanced_manufacturing", name: "Advanced Manufacturing", branch: "industry", era: 4, cost: 240, requires: ["automation"],
    description: "+20% wood, stone, metal, energy. Pollution +30%.",
    effects: { woodMult: 0.2, stoneMult: 0.2, metalMult: 0.2, energyMult: 0.2, pollutionMult: 0.3 }, unlocks: [] }),
  // Society
  t({ id: "administration", name: "Administration", branch: "society", era: 1, cost: 28, requires: [],
    description: "+2 housing, +10 stability, territory radius +1.", effects: { housing: 2, stability: 10, radius: 1 }, unlocks: [] }),
  t({ id: "currency", name: "Currency", branch: "society", era: 1, cost: 30, requires: [],
    description: "Unlocks the Market; +25% trade income.", effects: { tradeMult: 0.25 }, unlocks: ["market"] }),
  t({ id: "diplomacy", name: "Diplomacy", branch: "society", era: 2, cost: 66, requires: ["administration"],
    description: "Enables alliances; +1 influence per settlement.", effects: { allowAlliance: 1, influencePerSettlement: 1 }, unlocks: [] }),
  t({ id: "cultural_exchange", name: "Cultural Exchange", branch: "society", era: 3, cost: 135, requires: ["diplomacy", "currency"],
    description: "Trade income doubled; trade partners warm to you each turn.", effects: { tradeMult: 1, tradeOpinionDrift: 1, influenceMult: 0.2 }, unlocks: [] }),
  t({ id: "federation_charter", name: "Federation Charter", branch: "society", era: 4, cost: 230, requires: ["cultural_exchange"],
    description: "Required for a Diplomatic Federation victory; +30% influence.", effects: { influenceMult: 0.3 }, unlocks: [] }),
  // Science
  t({ id: "writing", name: "Writing", branch: "science", era: 1, cost: 22, requires: [],
    description: "Unlocks the Laboratory; +10% knowledge.", effects: { knowledgeMult: 0.1 }, unlocks: ["laboratory"] }),
  t({ id: "cartography", name: "Cartography", branch: "science", era: 1, cost: 30, requires: [],
    description: "Unlocks Explorers; +1 vision for all units.", effects: { vision: 1 }, unlocks: ["explorer"] }),
  t({ id: "scientific_method", name: "Scientific Method", branch: "science", era: 2, cost: 80, requires: ["writing"],
    description: "Laboratories +2 knowledge.", effects: { labFlat: 2 }, unlocks: [] }),
  t({ id: "resonance_theory", name: "Resonance Theory", branch: "science", era: 3, cost: 170, requires: ["scientific_method"],
    description: "+30% knowledge.", effects: { knowledgeMult: 0.3 }, unlocks: [] }),
  t({ id: "ascension_project", name: "Ascension Project", branch: "science", era: 5, cost: 380, requires: ["resonance_theory", "advanced_manufacturing"],
    description: "Completing it wins a Scientific Ascension victory.", effects: { knowledgeMult: 0.5 }, unlocks: [] }),
  // Ecology
  t({ id: "forestry", name: "Forestry", branch: "ecology", era: 1, cost: 26, requires: [],
    description: "Lumber camps deplete forests 50% slower; forests regrow faster.", effects: { forestDepletionMult: -0.5, forestRegrowth: 1 }, unlocks: [] }),
  t({ id: "restoration", name: "Restoration", branch: "ecology", era: 2, cost: 75, requires: ["forestry"],
    description: "Pollution in your territory decays twice as fast; habitat recovers.", effects: { pollutionDecay: 1, stability: 5 }, unlocks: [] }),
  t({ id: "clean_energy", name: "Clean Energy", branch: "ecology", era: 3, cost: 150, requires: ["restoration", "steam_power"],
    description: "Power plants pollute 80% less and need no timber.", effects: { powerPlantPollutionMult: -0.8, powerPlantNoFuel: 1 }, unlocks: [] }),
  t({ id: "gaia_accord", name: "Gaia Accord", branch: "ecology", era: 4, cost: 230, requires: ["clean_energy"],
    description: "Required for an Ecological Restoration victory; all pollution -25%.", effects: { pollutionMult: -0.25, pollutionDecay: 1 }, unlocks: [] }),
  // Military
  t({ id: "bronze_working", name: "Bronze Working", branch: "military", era: 1, cost: 22, requires: [],
    description: "+10% attack and defense.", effects: { attackMult: 0.1, defenseMult: 0.1 }, unlocks: [] }),
  t({ id: "archery", name: "Archery", branch: "military", era: 1, cost: 28, requires: [],
    description: "Unlocks Archers.", effects: { defenseMult: 0.05 }, unlocks: ["ranged"] }),
  t({ id: "fortification", name: "Fortification", branch: "military", era: 2, cost: 62, requires: ["bronze_working"],
    description: "Unlocks Walls; settlements +25% defense.", effects: { settlementDefense: 0.25 }, unlocks: ["wall"] }),
  t({ id: "tactics", name: "Tactics", branch: "military", era: 3, cost: 140, requires: ["fortification", "archery"],
    description: "Flanking bonus doubled; +10 morale.", effects: { flankMult: 1, morale: 10 }, unlocks: [] }),
];

export const TECH_BY_ID: ReadonlyMap<string, TechDef> = new Map(TECHS.map((x) => [x.id, x]));

export function techModifiers(known: readonly string[]): TechModifiers {
  const m: TechModifiers = { ...ZERO_MODIFIERS };
  for (const id of known) {
    const def = TECH_BY_ID.get(id);
    if (!def) continue;
    for (const [k, v] of Object.entries(def.effects) as [keyof TechModifiers, number][]) m[k] += v;
  }
  return m;
}
