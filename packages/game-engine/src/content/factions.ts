import type { Biome, FactionArchetype, Personality } from "@echoes/game-types";
import type { SitePreference } from "@echoes/procedural-world";

export interface FactionTemplate {
  id: string;
  name: string;
  adjective: string;
  archetype: FactionArchetype;
  color: string;
  homeBiome: Biome;
  sitePreference: SitePreference;
  personality: Personality;
  identity: string;
  visualIdentity: string;
  goals: string[];
  settlementNames: string[];
  preferredTechs: string[];
}

export const PLAYER_COLOR = "#36c2b4";

export const FACTION_TEMPLATES: FactionTemplate[] = [
  {
    id: "ironhold", name: "The Ironhold Compact", adjective: "Ironhold", archetype: "aggressive", color: "#c4513f",
    homeBiome: "hills", sitePreference: "highlands",
    personality: { aggression: 0.8, mercantile: 0.2, ecology: 0.1, science: 0.4, expansion: 0.65, memory: 0.9 },
    identity: "A militarised confederation of hill-clans and deep miners who believe the frontier belongs to whoever can hold it. They honour strength, keep long grudges and forge everything in iron.",
    visualIdentity: "soot-dark stone fortresses with red iron banners, forge-glow windows, heavy riveted armour, terraced hill mines",
    goals: ["control_iron", "military_dominance"],
    settlementNames: ["Anvilgate", "Cinderhold", "Brask", "Deepforge", "Grimward", "Holtmere", "Kerrig", "Ashpike"],
    preferredTechs: ["bronze_working", "mining", "metallurgy", "fortification", "archery", "tactics", "steam_power"],
  },
  {
    id: "saltwind", name: "The Saltwind Guild", adjective: "Saltwind", archetype: "merchant", color: "#d9a640",
    homeBiome: "beach", sitePreference: "coastal",
    personality: { aggression: 0.25, mercantile: 0.92, ecology: 0.3, science: 0.45, expansion: 0.5, memory: 0.5 },
    identity: "A chartered league of harbour-cities, caravan houses and ledger-keepers. They prize contracts over conquest and will trade with anyone who keeps their word.",
    visualIdentity: "white-washed harbour towns with gold-and-teal sails, lantern-lit markets, flowing silk coats, salt pans",
    goals: ["trade_network", "wealth"],
    settlementNames: ["Port Velis", "Tidewell", "Marrowharbour", "Sallow", "Brinecross", "Coinreach", "Gullhaven"],
    preferredTechs: ["currency", "administration", "diplomacy", "cultural_exchange", "irrigation", "writing"],
  },
  {
    id: "verdant", name: "The Verdant Assembly", adjective: "Verdant", archetype: "ecological", color: "#4e9c5c",
    homeBiome: "forest", sitePreference: "forest",
    personality: { aggression: 0.3, mercantile: 0.3, ecology: 0.95, science: 0.35, expansion: 0.35, memory: 0.85 },
    identity: "A council of grove-wardens and river-speakers bound by oath to the living land. They see deforestation and pollution as wounds, and remember every one.",
    visualIdentity: "living-wood halls grown around ancient trees, moss-green and bark-brown robes, bioluminescent lanterns, river shrines",
    goals: ["protect_forests", "clean_rivers"],
    settlementNames: ["Thornwick", "Elderhollow", "Mossvale", "Rillwood", "Greenmantle", "Bramblefold"],
    preferredTechs: ["forestry", "restoration", "irrigation", "selective_breeding", "clean_energy", "gaia_accord", "archery"],
  },
  {
    id: "lumen", name: "The Lumen Concord", adjective: "Lumen", archetype: "technocratic", color: "#5b82d6",
    homeBiome: "grassland", sitePreference: "river",
    personality: { aggression: 0.35, mercantile: 0.5, ecology: 0.3, science: 0.95, expansion: 0.45, memory: 0.6 },
    identity: "A meritocracy of engineers and astronomers who believe progress is the only way to survive the frontier. They measure everything and trust only what works.",
    visualIdentity: "pale stone observatories with brass domes and blue glass, orderly canals, clockwork cranes, scholars in slate-blue coats",
    goals: ["knowledge", "ascension"],
    settlementNames: ["Meridian", "Calyx", "Aster", "Prism", "Lodestar", "Quorum", "Halcyon"],
    preferredTechs: ["writing", "masonry", "scientific_method", "mining", "resonance_theory", "steam_power", "automation"],
  },
  {
    id: "ashen", name: "The Ashen Caravans", adjective: "Ashen", archetype: "nomadic", color: "#9b6bc6",
    homeBiome: "desert", sitePreference: "desert",
    personality: { aggression: 0.55, mercantile: 0.55, ecology: 0.4, science: 0.25, expansion: 0.8, memory: 0.45 },
    identity: "Wandering clans who cross the dunes in great wagon-trains, settling only where water and opportunity meet. They move when pressed, raid when hungry and trade when welcomed.",
    visualIdentity: "violet-dyed tents and painted wagons, sun-bleached bone totems, sand-veiled riders, mirage-lit desert camps",
    goals: ["expand_far", "survive"],
    settlementNames: ["Dunecall", "Mirage Wells", "Ochre Camp", "Sirocco", "Vashti", "Emberwind"],
    preferredTechs: ["cartography", "irrigation", "bronze_working", "currency", "archery", "selective_breeding"],
  },
];

export const PLAYER_SETTLEMENT_NAMES = [
  "Hearthfall", "First Light", "Wayrest", "Emberstead", "Northwatch", "Greystone", "Riverlow", "Kindle", "Farhaven", "Dawnmere",
];

export const ERA_NAMES = ["Survival", "Expansion", "Industrialization", "Transformation", "Legacy"] as const;

/** Minimum turn and known-tech count required to enter each era (index = era - 1). */
export const ERA_REQUIREMENTS = [
  { turn: 1, techs: 0 },
  { turn: 12, techs: 4 },
  { turn: 30, techs: 9 },
  { turn: 50, techs: 14 },
  { turn: 70, techs: 18 },
];
/** If a player lingers this long past an era's turn requirement, the world moves on anyway. */
export const ERA_FORCE_AFTER = 18;
