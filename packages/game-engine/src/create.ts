import type { Difficulty, Faction, GameState, Resources } from "@echoes/game-types";
import { PLAYER_ID, SAVE_SCHEMA_VERSION } from "@echoes/game-types";
import { findStartSites, generateWorld, type SitePreference } from "@echoes/procedural-world";
import { SeededRandom } from "@echoes/shared";
import { FACTION_TEMPLATES, PLAYER_COLOR } from "./content/factions";
import { EngineContext } from "./context";
import { foundSettlement, spawnUnit } from "./systems/construction";
import { updatePlayerVision } from "./systems/territory";
import { victoryProgress } from "./systems/victory";

export interface CreateGameOptions {
  gameId: string;
  seed: string;
  civilizationName: string;
  difficulty?: Difficulty;
  startPreference?: "balanced" | "coastal" | "river" | "highlands" | "forest";
  maxTurns?: number;
  aiPolicy?: { executeThreshold: number; conservativeThreshold: number };
  mapSize?: number;
}

const START_RESOURCES: Record<Difficulty, Resources> = {
  settler: { food: 80, wood: 80, stone: 50, metal: 10, energy: 5, knowledge: 10, influence: 20 },
  governor: { food: 60, wood: 60, stone: 40, metal: 5, energy: 5, knowledge: 5, influence: 15 },
  warlord: { food: 50, wood: 50, stone: 30, metal: 0, energy: 0, knowledge: 0, influence: 10 },
};

/** Opinion biases between archetypes at the start of a campaign. */
function initialOpinion(a: Faction, b: Faction): number {
  if (a.archetype === "ecological" && b.archetype === "aggressive") return -15;
  if (a.archetype === "aggressive" && b.archetype === "merchant") return -5;
  if (a.archetype === "merchant") return 10;
  if (a.archetype === "technocratic" && b.archetype === "ecological") return -5;
  if (a.archetype === "nomadic" && b.archetype === "aggressive") return -10;
  return 0;
}

export function createGame(opts: CreateGameOptions): GameState {
  const difficulty = opts.difficulty ?? "governor";
  const map = generateWorld({ seed: opts.seed, width: opts.mapSize, height: opts.mapSize });
  const player: Faction = {
    id: PLAYER_ID, name: opts.civilizationName, adjective: opts.civilizationName, kind: "player", archetype: "player", color: PLAYER_COLOR,
    identity: `The last surviving civilization, led by the player: ${opts.civilizationName}.`,
    visualIdentity: "weathered frontier settlers in teal and bone-white cloth, timber-and-stone longhouses, hopeful lantern light",
    homeBiome: "grassland", resources: { ...START_RESOURCES[difficulty] },
    personality: { aggression: 0, mercantile: 0, ecology: 0, science: 0, expansion: 0, memory: 0 },
    opinions: {}, memories: [], goals: [], research: { known: [], current: null, progress: 0 },
    posture: { action: "expand", sinceTurn: 1, conservative: false }, alive: true, eliminatedTurn: null,
    defeatsByPlayer: 0, settlementsLost: 0, parentId: null, foundedTurn: 1,
  };
  const ai: Faction[] = FACTION_TEMPLATES.map((t) => ({
    id: t.id, name: t.name, adjective: t.adjective, kind: "ai", archetype: t.archetype, color: t.color,
    identity: t.identity, visualIdentity: t.visualIdentity, homeBiome: t.homeBiome,
    resources: { food: 60, wood: 60, stone: 40, metal: 10, energy: 5, knowledge: 5, influence: 15 },
    personality: { ...t.personality }, opinions: {}, memories: [], goals: [...t.goals],
    research: { known: [], current: null, progress: 0 }, posture: { action: "expand", sinceTurn: 1, conservative: false },
    alive: true, eliminatedTurn: null, defeatsByPlayer: 0, settlementsLost: 0, parentId: null, foundedTurn: 1,
  }));
  const factions = [player, ...ai];
  for (const f of ai) for (const o of factions) if (o.id !== f.id) f.opinions[o.id] = initialOpinion(f, o);

  const state: GameState = {
    schemaVersion: SAVE_SCHEMA_VERSION,
    gameId: opts.gameId,
    seed: opts.seed,
    civilizationName: opts.civilizationName,
    turn: 1,
    era: 1,
    phase: "PLANNING",
    config: {
      difficulty,
      maxTurns: opts.maxTurns ?? 100,
      aiPolicy: opts.aiPolicy ?? { executeThreshold: 0.8, conservativeThreshold: 0.55 },
    },
    rng: [...new SeededRandom(`${opts.seed}::simulation`).getState()] as [number, number, number, number],
    nextId: 1,
    map,
    factions,
    settlements: [],
    buildings: [],
    units: [],
    relations: [],
    proposals: [],
    events: [],
    quests: [],
    history: [],
    world: { rainfall: 0.55, warming: 0, globalPollution: 0, forestCover: 0, calm: 0 },
    trends: [],
    lastReport: null,
    lastDecisions: {},
    victory: { progress: { dominion: 0, prosperity: 0, ascension: 0, restoration: 0, federation: 0 }, winner: null },
  };

  const ctx = new EngineContext(state);
  const prefs: SitePreference[] = [opts.startPreference ?? "balanced", ...FACTION_TEMPLATES.map((t) => t.sitePreference)];
  const sites = findStartSites(map, prefs, opts.seed);
  factions.forEach((f, idx) => {
    const site = sites[idx]!;
    foundSettlement(ctx, f.id, site, { isCapital: true, population: 3 });
    if (f.kind === "player") {
      spawnUnit(ctx, f.id, "worker", site);
      spawnUnit(ctx, f.id, "worker", site);
      spawnUnit(ctx, f.id, "scout", site);
      spawnUnit(ctx, f.id, "guard", site);
    } else {
      spawnUnit(ctx, f.id, "worker", site);
      spawnUnit(ctx, f.id, "scout", site);
      spawnUnit(ctx, f.id, "guard", site);
    }
  });
  for (let i = 0; i < factions.length; i++) for (let j = i + 1; j < factions.length; j++) ctx.relation(factions[i]!.id, factions[j]!.id);
  // Founding history is campaign prologue, not news.
  state.history = [];
  updatePlayerVision(ctx);
  const capital = state.settlements.find((s) => s.ownerId === PLAYER_ID)!;
  ctx.history({
    type: "GAME_STARTED", importance: 3, actorId: PLAYER_ID, targetId: null, tile: capital.tile,
    summary: `${opts.civilizationName}, the last surviving civilization, raised ${capital.name} in ${ctx.tile(capital.tile).region}.`,
    tags: ["campaign", "founding"],
  });
  state.world.forestCover = map.tiles.filter((t) => t.forest > 30).length / map.tiles.filter((t) => t.biome !== "ocean" && t.biome !== "shallows" && t.biome !== "lake").length;
  state.world.forestCover = Math.round(state.world.forestCover * 1000) / 1000;
  state.victory.progress = victoryProgress(state);
  return ctx.commit();
}
