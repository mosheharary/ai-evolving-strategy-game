/**
 * Authoritative game state types. Everything in GameState is deterministic,
 * JSON-serialisable and part of the canonical state hash. Presentation-only data
 * (AI narrative text, generated images) lives outside GameState.
 */

export const SAVE_SCHEMA_VERSION = 3;

export const RESOURCE_TYPES = ["food", "wood", "stone", "metal", "energy", "knowledge", "influence"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];
export type Resources = Record<ResourceType, number>;

export const BIOMES = [
  "ocean",
  "shallows",
  "lake",
  "beach",
  "plains",
  "grassland",
  "forest",
  "taiga",
  "desert",
  "tundra",
  "wetland",
  "hills",
  "mountain",
  "snow",
  // Biomes that only appear through world evolution:
  "scrubland",
  "ashland",
  "blighted",
] as const;
export type Biome = (typeof BIOMES)[number];

export const RESOURCE_NODE_TYPES = ["iron", "stone_deposit", "game_herd", "fish", "sunstone", "relic", "salt"] as const;
export type ResourceNodeType = (typeof RESOURCE_NODE_TYPES)[number];

export const POI_TYPES = ["ancient_ruin", "monolith", "hot_springs", "crater", "ruins", "shipwreck"] as const;
export type PoiType = (typeof POI_TYPES)[number];

export interface ResourceNode {
  type: ResourceNodeType;
  amount: number;
  initialAmount: number;
}

export interface Tile {
  i: number;
  col: number;
  row: number;
  /** 0..1 */
  elevation: number;
  /** 0..1 */
  moisture: number;
  /** 0..1 */
  temperature: number;
  biome: Biome;
  /** Original biome at world generation — evolution is measured against it. */
  baseBiome: Biome;
  river: boolean;
  /** Downstream tile index for river rendering, -1 when none. */
  riverTo: number;
  /** Tree density 0..100. */
  forest: number;
  /** Soil fertility 0..100. */
  fertility: number;
  /** 0..100 */
  pollution: number;
  /** Ecosystem health 0..100. */
  habitat: number;
  /** Accumulated trade wealth 0..100. */
  prosperity: number;
  resource: ResourceNode | null;
  ownerId: string | null;
  settlementId: string | null;
  buildingId: string | null;
  poi: PoiType | null;
  poiDiscovered: boolean;
  /** Explored by the human player (fog of war). */
  explored: boolean;
  /** Human-readable region label (e.g. "the Northern Reach"). */
  region: string;
}

export interface MapState {
  width: number;
  height: number;
  tiles: Tile[];
}

export const BUILDING_TYPES = [
  "settlement_center",
  "farm",
  "lumber_camp",
  "quarry",
  "mine",
  "workshop",
  "warehouse",
  "laboratory",
  "market",
  "barracks",
  "wall",
  "watchtower",
  "power_plant",
] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

export interface Building {
  id: string;
  type: BuildingType;
  tile: number;
  settlementId: string;
  ownerId: string;
  /** Turns of construction remaining. 0 = complete. */
  turnsRemaining: number;
  builtTurn: number;
  hp: number;
}

export interface Settlement {
  id: string;
  name: string;
  ownerId: string;
  tile: number;
  population: number;
  /** Progress toward the next population point. */
  growth: number;
  hp: number;
  maxHp: number;
  /** 0..100 — low stability leads to unrest and rebellion. */
  stability: number;
  foundedTurn: number;
  isCapital: boolean;
  /** Territory radius in hexes. */
  radius: number;
  training: { unitType: UnitType; turnsRemaining: number } | null;
  /** Original founder, preserved when a settlement changes hands. */
  founderId: string;
}

export const UNIT_TYPES = ["worker", "scout", "guard", "ranged", "heavy", "explorer"] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

export type UnitStatus = "idle" | "fortified" | "moved" | "exhausted";

export interface Unit {
  id: string;
  type: UnitType;
  ownerId: string;
  tile: number;
  hp: number;
  maxHp: number;
  movesLeft: number;
  /** 0..100 */
  morale: number;
  status: UnitStatus;
  xp: number;
  /** Has the unit attacked this turn. */
  attacked: boolean;
  /** Previous tile, used by the client to animate movement. */
  prevTile: number;
}

export const FACTION_ARCHETYPES = [
  "player",
  "aggressive",
  "merchant",
  "ecological",
  "technocratic",
  "nomadic",
  "rebel",
] as const;
export type FactionArchetype = (typeof FACTION_ARCHETYPES)[number];

export interface Personality {
  aggression: number;
  mercantile: number;
  ecology: number;
  science: number;
  expansion: number;
  /** How strongly the faction remembers grievances and favours. */
  memory: number;
}

export type MemoryKind =
  | "attacked_us"
  | "defeated_us"
  | "razed_settlement"
  | "captured_settlement"
  | "gift"
  | "trade_partner"
  | "alliance"
  | "broke_treaty"
  | "polluted_land"
  | "deforested"
  | "sanctioned_us"
  | "espionage_caught"
  | "border_claim"
  | "helped_in_crisis"
  | "shared_enemy";

export interface FactionMemory {
  turn: number;
  aboutId: string;
  kind: MemoryKind;
  /** Signed opinion impact at the time of the memory. */
  weight: number;
}

export const STRATEGIC_ACTIONS = ["expand", "defend", "trade", "raid", "research", "retreat"] as const;
export type StrategicAction = (typeof STRATEGIC_ACTIONS)[number];

export const DIPLOMATIC_STANCES = [
  "improve_relations",
  "maintain",
  "sanction",
  "declare_war",
  "seek_peace",
  "propose_alliance",
] as const;
export type DiplomaticStance = (typeof DIPLOMATIC_STANCES)[number];

export interface ResearchState {
  known: string[];
  current: string | null;
  progress: number;
}

export interface Faction {
  id: string;
  name: string;
  adjective: string;
  kind: "player" | "ai";
  archetype: FactionArchetype;
  color: string;
  /** Canonical identity — fed to narrative and image prompts. */
  identity: string;
  /** Canonical visual description for consistent generated art. */
  visualIdentity: string;
  homeBiome: Biome;
  resources: Resources;
  personality: Personality;
  /** Opinion toward other factions, -100..100. */
  opinions: Record<string, number>;
  memories: FactionMemory[];
  goals: string[];
  research: ResearchState;
  posture: { action: StrategicAction; sinceTurn: number; conservative: boolean };
  alive: boolean;
  eliminatedTurn: number | null;
  /** Count of military defeats inflicted by the player — drives strategic adaptation. */
  defeatsByPlayer: number;
  settlementsLost: number;
  /** Ancestry: a faction formed from a split or descendants of a destroyed faction. */
  parentId: string | null;
  foundedTurn: number;
}

export type DiplomaticStatus = "peace" | "war" | "ceasefire" | "alliance";

export interface DiplomacyRelation {
  /** Sorted pair key "a|b". */
  key: string;
  a: string;
  b: string;
  status: DiplomaticStatus;
  sinceTurn: number;
  trade: boolean;
  /** Faction ids that currently sanction the other party. */
  sanctionsBy: string[];
  ceasefireUntil: number | null;
  wars: number;
  treaties: number;
}

export interface DiplomaticProposal {
  id: string;
  from: string;
  to: string;
  type: "trade" | "alliance" | "ceasefire" | "peace";
  turn: number;
}

export const WORLD_EVENT_TYPES = [
  "drought",
  "volcanic_eruption",
  "migration",
  "plague",
  "discovery",
  "rebellion",
  "trade_boom",
  "resource_collapse",
  "religious_movement",
  "tech_breakthrough",
  "faction_split",
  "border_conflict",
  "ecological_recovery",
  "ancient_ruin_discovery",
  "wildfire",
  "river_crisis",
  "flood",
  "descendants_return",
  "era_dawn",
] as const;
export type WorldEventType = (typeof WORLD_EVENT_TYPES)[number];

export type EventEffect =
  | { kind: "yield_mult"; resource: ResourceType; mult: number; factionId: string | null; tiles: "affected" | "all" }
  | { kind: "stability"; delta: number; factionId: string | null }
  | { kind: "growth_mult"; mult: number; factionId: string | null }
  | { kind: "opinion"; factionId: string; towardId: string; delta: number }
  | { kind: "resource_grant"; factionId: string; resources: Partial<Resources> };

export interface WorldEvent {
  id: string;
  type: WorldEventType;
  turn: number;
  /** 0..1 */
  severity: number;
  duration: number;
  endsTurn: number;
  centerTile: number;
  tiles: number[];
  region: string;
  factionIds: string[];
  /** Structured, deterministic cause facts. These are what narrative AI receives. */
  cause: Record<string, string | number | boolean>;
  /** Human-readable deterministic consequence lines. */
  consequences: string[];
  effects: EventEffect[];
  /** Applied once at trigger time (already reflected in state). */
  immediate: string[];
  major: boolean;
  visual: { palette: "fire" | "water" | "earth" | "life" | "gold" | "shadow" | "arcane"; focusTile: number };
  status: "active" | "resolved";
}

export type HistoryType =
  | "GAME_STARTED"
  | "PLAYER_BUILT_BUILDING"
  | "SETTLEMENT_FOUNDED"
  | "PLAYER_DECLARED_WAR"
  | "WAR_DECLARED"
  | "FACTION_ATTACKED_SETTLEMENT"
  | "SETTLEMENT_CAPTURED"
  | "SETTLEMENT_RAZED"
  | "UNIT_DEFEATED"
  | "TECHNOLOGY_RESEARCHED"
  | "RESOURCE_DISCOVERED"
  | "RESOURCE_DEPLETED"
  | "NATURAL_DISASTER"
  | "WORLD_EVENT"
  | "DIPLOMATIC_TREATY_SIGNED"
  | "DIPLOMATIC_ACTION"
  | "FACTION_STRATEGY_CHANGED"
  | "FACTION_ELIMINATED"
  | "FACTION_FOUNDED"
  | "TERRAIN_CHANGED"
  | "ERA_ADVANCED"
  | "QUEST_COMPLETED"
  | "QUEST_FAILED"
  | "LOCATION_DISCOVERED"
  | "VICTORY";

export interface HistoryEntry {
  id: string;
  turn: number;
  type: HistoryType;
  /** 1 = minor (pruned), 2 = notable, 3 = epochal (kept forever). */
  importance: 1 | 2 | 3;
  actorId: string | null;
  targetId: string | null;
  tile: number | null;
  summary: string;
  effects: string[];
  tags: string[];
  eventId: string | null;
}

export const QUEST_TYPES = [
  "restore_ruin",
  "defend_trade_route",
  "discover_site",
  "negotiate_peace",
  "investigate_weather",
  "rescue_settlement",
  "exploit_rare_resource",
  "investigate_rebellion",
] as const;
export type QuestType = (typeof QUEST_TYPES)[number];

export type QuestRequirement =
  | { kind: "building_on_tile"; tile: number; buildingType: BuildingType | null }
  | { kind: "unit_on_tile"; tile: number }
  | { kind: "status_with"; factionId: string; status: DiplomaticStatus[] }
  | { kind: "no_enemy_near"; tile: number; radius: number; turns: number }
  | { kind: "settlement_stability"; settlementId: string; min: number }
  | { kind: "stockpile"; resource: ResourceType; amount: number };

export interface Quest {
  id: string;
  type: QuestType;
  title: string;
  description: string;
  status: "active" | "completed" | "failed" | "expired";
  issuedTurn: number;
  expiresTurn: number;
  requirement: QuestRequirement;
  progress: number;
  rewards: Partial<Resources>;
  rewardOpinion: { factionId: string; delta: number } | null;
  sourceEventId: string | null;
  tile: number | null;
}

export const VICTORY_TYPES = ["dominion", "prosperity", "ascension", "restoration", "federation"] as const;
export type VictoryType = (typeof VICTORY_TYPES)[number];

export interface WorldVariables {
  /** 0..1 — long-run seeded random walk, pushed down by warming. */
  rainfall: number;
  /** Degrees of anomaly from industrial pollution. */
  warming: number;
  globalPollution: number;
  /** Fraction of land tiles with meaningful forest. */
  forestCover: number;
  /** Turns since last major event (event director pacing). */
  calm: number;
}

export interface TrendSample {
  turn: number;
  food: number;
  knowledge: number;
  military: number;
  pollution: number;
  population: number;
  territory: number;
}

export interface TurnReport {
  turn: number;
  resourceDelta: Resources;
  lines: string[];
  focusTiles: number[];
  eventIds: string[];
  factionActions: { factionId: string; action: StrategicAction; source: "ai" | "fallback"; summary: string }[];
}

export type Difficulty = "settler" | "governor" | "warlord";

export type TurnPhase =
  | "PLANNING"
  | "PLAYER_ACTIONS"
  | "RESOLUTION"
  | "FACTION_AI"
  | "WORLD_EVOLUTION"
  | "EVENTS"
  | "NARRATIVE"
  | "TURN_COMPLETE";

export interface AIPolicyConfig {
  executeThreshold: number;
  conservativeThreshold: number;
}

export interface GameConfig {
  difficulty: Difficulty;
  maxTurns: number;
  aiPolicy: AIPolicyConfig;
}

export interface FactionDecisionRecord {
  turn: number;
  action: StrategicAction;
  stance: DiplomaticStance;
  confidence: number;
  source: "ai" | "fallback";
  mode: "execute" | "conservative" | "fallback";
  reason: string;
}

export interface GameState {
  schemaVersion: number;
  gameId: string;
  seed: string;
  civilizationName: string;
  turn: number;
  era: number;
  phase: TurnPhase;
  config: GameConfig;
  rng: [number, number, number, number];
  nextId: number;
  map: MapState;
  factions: Faction[];
  settlements: Settlement[];
  buildings: Building[];
  units: Unit[];
  relations: DiplomacyRelation[];
  proposals: DiplomaticProposal[];
  events: WorldEvent[];
  quests: Quest[];
  history: HistoryEntry[];
  world: WorldVariables;
  trends: TrendSample[];
  lastReport: TurnReport | null;
  lastDecisions: Record<string, FactionDecisionRecord>;
  victory: { progress: Record<VictoryType, number>; winner: { factionId: string; type: VictoryType | "legacy" | "defeat"; turn: number } | null };
}

export const PLAYER_ID = "player";
