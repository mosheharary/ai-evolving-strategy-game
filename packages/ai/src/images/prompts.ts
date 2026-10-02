import type { GameState, WorldEvent } from "@echoes/game-types";
import { PLAYER_ID } from "@echoes/game-types";
import { TECH_BY_ID } from "@echoes/game-engine";
import { ERA_VISUALS, PROMPTS, STYLE_BIBLE } from "../narrative/prompts";
import type { ImageRequest } from "../providers/types";

/**
 * Image prompt policy: prompts are assembled from canonical world facts
 * (faction visual identity, era architecture, biome, event) plus the global
 * style bible — so art stays consistent and never contradicts the simulation.
 */

const EVENT_SCENES: Record<string, string> = {
  drought: "cracked riverbeds and withered fields under a white-hot sky, dust on the wind",
  river_crisis: "a once-clear river running dark and oily past sickly reeds, dead fish on the banks, distant smokestacks",
  wildfire: "a forest consumed by towering orange flames at dusk, embers swirling, silhouetted fleeing deer",
  volcanic_eruption: "a mountain erupting with glowing lava and a vast ash column, ash falling on terraced fields",
  flood: "a swollen river bursting its banks across farmland, rooftops in the water, storm light",
  plague: "a quiet frontier town at dusk, shuttered windows, healers with lanterns and herb smoke",
  trade_boom: "a bustling market crossroads full of caravans, banners and lantern light, goods piled high",
  resource_collapse: "an abandoned mine entrance with empty carts and rusted tools, wind through the hills",
  rebellion: "townsfolk raising a new grey banner over a palisade at dawn, torches and defiance",
  faction_split: "a town divided — half its banners torn down and replaced with grey ones",
  migration: "a long wagon train crossing the land under a vast sky, dust trailing behind",
  descendants_return: "settlers rebuilding wooden homes among old ruined stones, morning light, hope",
  border_conflict: "two banners facing each other across a misty river ford, skirmishers in the reeds",
  ecological_recovery: "young forest reclaiming old scrubland, clear streams, returning birds, golden light",
  religious_movement: "pilgrims with candles gathered around a towering black monolith under stars",
  tech_breakthrough: "an inventor's workshop glowing with a new machine, astonished onlookers",
  discovery: "explorers cresting a ridge to find something extraordinary in the valley below",
  ancient_ruin_discovery: "explorers uncovering a vast overgrown ancient city, colossal carved stones",
  era_dawn: "a sweeping panorama of a frontier civilization at the dawn of a new age",
};

const POI_SCENES: Record<string, string> = {
  ancient_ruin: "colossal overgrown ruins of a forgotten civilization",
  monolith: "a single impossible black monolith rising from the plain",
  hot_springs: "terraced steaming hot springs among hills",
  crater: "a vast glassy meteor crater with strange glittering stones",
  ruins: "the charred ruins of a destroyed frontier town",
  shipwreck: "the bones of a great ship beached on a lonely shore",
};

const paletteFor = (e: WorldEvent): string => e.visual.palette;

export function eventImageRequest(state: GameState, e: WorldEvent, sceneDetail: string | null): Omit<ImageRequest, "model"> {
  const tile = state.map.tiles[e.centerTile];
  const factions = e.factionIds.map((id) => state.factions.find((f) => f.id === id)).filter((f) => f && f.id !== PLAYER_ID);
  const architecture = factions[0]?.visualIdentity ?? state.factions.find((f) => f.id === PLAYER_ID)?.visualIdentity ?? "";
  const def = PROMPTS.event_art;
  const prompt = [
    STYLE_BIBLE,
    `Scene: ${EVENT_SCENES[e.type] ?? e.type.replace(/_/g, " ")}.`,
    `Landscape: ${tile?.biome ?? "frontier"} terrain in ${e.region}.`,
    architecture ? `Architecture and people: ${architecture}.` : "",
    `Era: ${ERA_VISUALS[state.era - 1]}.`,
    sceneDetail ? `Detail: ${sanitise(sceneDetail)}.` : "",
    "Wide cinematic establishing shot, 16:9.",
  ].filter(Boolean).join(" ");
  return {
    promptId: def.promptId, promptVersion: def.promptVersion, prompt, aspectRatio: "16:9",
    facts: { title: e.type, palette: paletteFor(e), biome: tile?.biome ?? "plains", seed: `${state.seed}:${e.id}`, kind: "event" },
  };
}

export function locationImageRequest(state: GameState, e: WorldEvent): Omit<ImageRequest, "model"> {
  const tile = state.map.tiles[e.centerTile];
  const def = PROMPTS.location_art;
  const poi = String(e.cause.poi ?? tile?.poi ?? "site");
  const prompt = [STYLE_BIBLE, `Subject: ${POI_SCENES[poi] ?? poi}.`, `Setting: ${tile?.biome ?? "frontier"} terrain of ${e.region}.`, `Era: ${ERA_VISUALS[state.era - 1]}.`, "Mysterious, awe-inspiring, wide shot, 16:9."].join(" ");
  return {
    promptId: def.promptId, promptVersion: def.promptVersion, prompt, aspectRatio: "16:9",
    facts: { title: poi, palette: poi === "monolith" ? "arcane" : "gold", biome: tile?.biome ?? "plains", seed: `${state.seed}:${e.id}`, kind: "location" },
  };
}

export function factionPortraitRequest(state: GameState, factionId: string): Omit<ImageRequest, "model"> {
  const f = state.factions.find((x) => x.id === factionId)!;
  const def = PROMPTS.faction_portrait;
  const prompt = [
    STYLE_BIBLE,
    `Portrait of a leader of ${f.name}: ${f.identity}`,
    `Visual identity: ${f.visualIdentity}.`,
    `Their signature colour is ${f.color}.`,
    `Era: ${ERA_VISUALS[state.era - 1]}.`,
    "Head-and-shoulders character portrait, dramatic rim light, 3:4.",
  ].join(" ");
  const palette = f.archetype === "aggressive" ? "fire" : f.archetype === "ecological" ? "life" : f.archetype === "merchant" ? "gold" : f.archetype === "technocratic" ? "water" : f.archetype === "nomadic" ? "arcane" : "shadow";
  return { promptId: def.promptId, promptVersion: def.promptVersion, prompt, aspectRatio: "3:4", facts: { title: f.name, palette, biome: f.homeBiome, seed: `${f.id}:era${state.era}`, kind: "faction" } };
}

export function technologyImageRequest(state: GameState, techId: string): Omit<ImageRequest, "model"> {
  const t = TECH_BY_ID.get(techId);
  const def = PROMPTS.technology_art;
  const player = state.factions.find((f) => f.id === PLAYER_ID);
  const prompt = [STYLE_BIBLE, `Illustration of the technology "${t?.name ?? techId}": ${t?.description ?? ""}`, player ? `Made by: ${player.visualIdentity}.` : "", `Era: ${ERA_VISUALS[(t?.era ?? 1) - 1]}.`, "Detailed still life, 1:1."].join(" ");
  const palette = t?.branch === "ecology" || t?.branch === "agriculture" ? "life" : t?.branch === "industry" ? "fire" : t?.branch === "military" ? "shadow" : t?.branch === "society" ? "gold" : "arcane";
  return { promptId: def.promptId, promptVersion: def.promptVersion, prompt, aspectRatio: "1:1", facts: { title: t?.name ?? techId, palette, biome: "plains", seed: techId, kind: "technology" } };
}

export function heroImageRequest(state: GameState, kind: "intro" | "era", sceneDetail: string | null): Omit<ImageRequest, "model"> {
  const def = PROMPTS.hero_art;
  const capital = state.settlements.find((s) => s.ownerId === PLAYER_ID);
  const tile = capital ? state.map.tiles[capital.tile] : undefined;
  const player = state.factions.find((f) => f.id === PLAYER_ID);
  const prompt = [
    STYLE_BIBLE,
    kind === "intro" ? "Loading-screen key art: the last surviving civilization raising its first settlement on a vast untamed frontier." : `Chapter illustration for the dawn of Era ${state.era}.`,
    `Landscape: ${tile?.biome ?? "grassland"} in ${tile?.region ?? "the frontier"}, distant mountains and rivers.`,
    player ? `People and architecture: ${player.visualIdentity}.` : "",
    `Era: ${ERA_VISUALS[state.era - 1]}.`,
    sceneDetail ? `Detail: ${sanitise(sceneDetail)}.` : "",
    "Epic sweeping vista, golden hour, 16:9.",
  ].filter(Boolean).join(" ");
  return { promptId: def.promptId, promptVersion: def.promptVersion, prompt, aspectRatio: "16:9", facts: { title: kind, palette: "gold", biome: tile?.biome ?? "grassland", seed: `${state.seed}:${kind}:${state.era}`, kind: "hero" } };
}

/** Keep model-suggested detail short and free of instructions or text requests. */
function sanitise(s: string): string {
  return s.replace(/[\r\n]+/g, " ").replace(/\b(text|caption|logo|watermark|signature|letters?)\b/gi, "").slice(0, 300).trim();
}
