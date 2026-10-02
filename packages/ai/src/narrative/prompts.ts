/**
 * Prompt registry. Every prompt has a stable promptId and an integer version;
 * both are recorded with each AI request and folded into the cache key, so a
 * prompt change never serves stale cached output and is debuggable in production.
 */

export interface PromptDef {
  promptId: string;
  promptVersion: number;
  system: string;
}

/** Global visual style bible — shared by every generated image for consistency. */
export const STYLE_BIBLE =
  "Stylized high-end 3D strategy game key art, painterly surfaces, realistic cinematic lighting, slightly exaggerated scale, " +
  "readable silhouettes, rich natural environments, coherent frontier architectural language, atmospheric depth and haze, " +
  "warm-cool colour contrast, no text, no letters, no logos, no UI, no watermark.";

const NARRATOR =
  "You are the chronicler of 'Echoes of the Frontier', a strategy game about the last surviving civilization on an evolving frontier. " +
  "You write evocative but concise prose in a grounded, literary fantasy register. " +
  "STRICT RULES: Use ONLY the facts provided in the input JSON. Never invent numbers, resources, deaths, technologies, factions or outcomes that are not in the facts. " +
  "The game engine has already decided all mechanics; you only describe them. Refer to earlier history when relevant to give continuity. " +
  "In prose always use faction NAMES, never internal ids; only the factionId JSON fields may contain ids, copied exactly from the input. Return JSON matching the schema.";

export const PROMPTS = {
  event_narrative: { promptId: "event_narrative", promptVersion: 6, system: `${NARRATOR} Describe a world event: give it a memorable title, explain its cause from the facts, voice each listed faction's reaction in one or two sentences consistent with their identity and opinion, and write a short visual description of the scene (no text in image).` },
  discovery_narrative: { promptId: "discovery_narrative", promptVersion: 4, system: `${NARRATOR} Describe a newly discovered location. Give it a proper name fitting the region. Keep it mysterious and grounded.` },
  campaign_intro: { promptId: "campaign_intro", promptVersion: 3, system: `${NARRATOR} Write the opening of a new campaign: who the player's people are, why they are the last, what the frontier looks like, and who their neighbours are. End with a clear objective.` },
  campaign_summary: { promptId: "campaign_summary", promptVersion: 4, system: `${NARRATOR} Summarise the campaign so far into a compact chronicle. Mention major discoveries, wars, alliances, technological milestones, ecological changes, disasters and important relationships. This summary will be reused as compressed memory.` },
  quest_narrative: { promptId: "quest_narrative", promptVersion: 3, system: `${NARRATOR} Rewrite a quest's title and description with flavour. The requirement and rewards are fixed by the engine and must not change; you may only restate them.` },
  faction_profile: { promptId: "faction_profile", promptVersion: 3, system: `${NARRATOR} Write how a faction's envoy greets the player's people, reflecting the faction's identity, current opinion and recent shared history.` },
  event_art: { promptId: "event_art", promptVersion: 3, system: "" },
  location_art: { promptId: "location_art", promptVersion: 2, system: "" },
  faction_portrait: { promptId: "faction_portrait", promptVersion: 2, system: "" },
  technology_art: { promptId: "technology_art", promptVersion: 1, system: "" },
  hero_art: { promptId: "hero_art", promptVersion: 2, system: "" },
} as const satisfies Record<string, PromptDef>;

export type PromptKey = keyof typeof PROMPTS;

export const ERA_VISUALS = [
  "primitive timber palisades and campfires, wild untouched land",
  "stone towns, early roads and mills, expanding farmland",
  "smokestacks, brick and iron, coal-dark skies over busy workshops",
  "brass and glass marvels, canals and greenhouses, a land being reshaped",
  "luminous monuments and restored wilds, a civilization at its zenith",
] as const;
