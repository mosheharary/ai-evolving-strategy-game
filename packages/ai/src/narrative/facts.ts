import type { GameState, HistoryEntry, Quest, WorldEvent } from "@echoes/game-types";
import { PLAYER_ID } from "@echoes/game-types";
import { ERA_NAMES, TECH_BY_ID } from "@echoes/game-engine";

/**
 * Narrative policy: Gemini receives *structured facts* extracted from the
 * authoritative state — never the whole state, never invented facts. Relevant
 * history is selected by shared region / faction / event tags so later stories
 * reference earlier ones ("Turn 31: a faction reacts to the Black Valley discovery").
 */

const factionLabel = (state: GameState, id: string): string => (id === PLAYER_ID ? state.civilizationName : state.factions.find((f) => f.id === id)?.name ?? id);

export function relevantHistory(state: GameState, opts: { region?: string; factionIds?: string[]; tags?: string[]; limit?: number; excludeEventId?: string }): string[] {
  const limit = opts.limit ?? 6;
  const wantTags = new Set([...(opts.tags ?? []), ...(opts.region ? [`region:${opts.region}`] : []), ...(opts.factionIds ?? []).map((f) => `faction:${f}`)]);
  const scored = state.history
    .filter((h) => h.eventId !== opts.excludeEventId)
    .map((h): [number, HistoryEntry] => {
      let s = h.importance;
      if (h.tags.some((t) => wantTags.has(t))) s += 4;
      if (opts.factionIds?.some((f) => f === h.actorId || f === h.targetId)) s += 3;
      if (opts.region && h.summary.includes(opts.region.replace(/^the /, ""))) s += 2;
      return [s, h];
    })
    .filter(([s]) => s >= 4)
    .sort((a, b) => b[0] - a[0] || a[1].turn - b[1].turn);
  return scored
    .slice(0, limit)
    .map(([, h]) => h)
    .sort((a, b) => a.turn - b.turn)
    .map((h) => `Year ${h.turn}: ${h.summary}`);
}

export function eventFacts(state: GameState, e: WorldEvent, campaignSummary: string | null): Record<string, unknown> {
  const tile = state.map.tiles[e.centerTile];
  const factionIds = [...new Set([...e.factionIds, ...state.factions.filter((f) => f.alive && f.kind === "ai").slice(0, 3).map((f) => f.id)])].filter((id) => id !== PLAYER_ID);
  return {
    eventId: e.id,
    type: e.type,
    turn: e.turn,
    year: e.turn,
    era: state.era,
    eraName: ERA_NAMES[state.era - 1],
    region: e.region,
    biome: tile?.biome ?? "frontier",
    severity: e.severity,
    durationTurns: e.duration,
    summary: (state.history.find((h) => h.eventId === e.id)?.summary) ?? "",
    cause: e.cause,
    consequences: e.consequences,
    immediate: e.immediate,
    player: { name: state.civilizationName, involved: e.factionIds.includes(PLAYER_ID) },
    factions: factionIds.slice(0, 5).map((id) => {
      const f = state.factions.find((x) => x.id === id)!;
      return { factionId: id, name: f.name, archetype: f.archetype, identity: f.identity.slice(0, 220), opinionOfPlayer: Math.round(f.opinions[PLAYER_ID] ?? 0), involved: e.factionIds.includes(id) };
    }),
    relatedHistory: relevantHistory(state, { region: e.region, factionIds: e.factionIds, tags: [`event:${e.type}`], excludeEventId: e.id }),
    campaignSummary: campaignSummary?.slice(0, 1200) ?? null,
  };
}

export function introFacts(state: GameState): Record<string, unknown> {
  const capital = state.settlements.find((s) => s.ownerId === PLAYER_ID);
  const tile = capital ? state.map.tiles[capital.tile] : undefined;
  return {
    seed: state.seed,
    turn: state.turn,
    civilizationName: state.civilizationName,
    capitalName: capital?.name ?? "the first hearth",
    startRegion: tile?.region ?? "the frontier",
    startBiome: tile?.biome ?? "grassland",
    difficulty: state.config.difficulty,
    factions: state.factions.filter((f) => f.kind === "ai").map((f) => ({ factionId: f.id, name: f.name, archetype: f.archetype, identity: f.identity.slice(0, 200) })),
    victoryPaths: ["Dominion", "Prosperity", "Scientific Ascension", "Ecological Restoration", "Diplomatic Federation"],
  };
}

export function summaryFacts(state: GameState, previousSummary: string | null): Record<string, unknown> {
  const major = state.history.filter((h) => h.importance >= 3 || (h.importance >= 2 && ["TECHNOLOGY_RESEARCHED", "LOCATION_DISCOVERED", "DIPLOMATIC_TREATY_SIGNED", "TERRAIN_CHANGED"].includes(h.type)));
  return {
    turn: state.turn,
    era: state.era,
    eraName: ERA_NAMES[state.era - 1],
    civilizationName: state.civilizationName,
    previousSummary: previousSummary?.slice(0, 1200) ?? null,
    majorHistory: major.slice(-30).map((h) => `Year ${h.turn}: ${h.summary}`),
    relationships: state.factions.filter((f) => f.kind === "ai" && f.alive).map((f) => {
      const [a, b] = f.id < PLAYER_ID ? [f.id, PLAYER_ID] : [PLAYER_ID, f.id];
      const rel = state.relations.find((r) => r.key === `${a}|${b}`);
      return { faction: f.name, opinionOfPlayer: Math.round(f.opinions[PLAYER_ID] ?? 0), status: rel?.status ?? "peace", trade: rel?.trade ?? false };
    }),
    world: { globalPollution: state.world.globalPollution, forestCover: state.world.forestCover, rainfall: state.world.rainfall },
    technologies: (state.factions.find((f) => f.id === PLAYER_ID)?.research.known ?? []).map((t) => TECH_BY_ID.get(t)?.name ?? t),
  };
}

export function questFacts(state: GameState, q: Quest): Record<string, unknown> {
  return {
    questId: q.id,
    type: q.type,
    turn: state.turn,
    title: q.title,
    description: q.description,
    region: q.tile !== null ? state.map.tiles[q.tile]?.region ?? null : null,
    rewards: q.rewards,
    expiresInTurns: q.expiresTurn - state.turn,
    relatedHistory: relevantHistory(state, { region: q.tile !== null ? state.map.tiles[q.tile]?.region : undefined, limit: 3 }),
  };
}

export function factionFacts(state: GameState, factionId: string): Record<string, unknown> {
  const f = state.factions.find((x) => x.id === factionId)!;
  const [a, b] = f.id < PLAYER_ID ? [f.id, PLAYER_ID] : [PLAYER_ID, f.id];
  const rel = state.relations.find((r) => r.key === `${a}|${b}`);
  return {
    factionId: f.id,
    turn: state.turn,
    name: f.name,
    archetype: f.archetype,
    identity: f.identity,
    opinionOfPlayer: Math.round(f.opinions[PLAYER_ID] ?? 0),
    status: rel?.status ?? "peace",
    memoriesOfPlayer: f.memories.filter((m) => m.aboutId === PLAYER_ID).slice(-6).map((m) => `Year ${m.turn}: ${m.kind.replace(/_/g, " ")}`),
    relatedHistory: relevantHistory(state, { factionIds: [f.id], limit: 4 }),
    playerName: factionLabel(state, PLAYER_ID),
  };
}
