import { z } from "zod";

/**
 * Structured output schemas for Gemini. They are converted to JSON Schema and
 * sent as `responseJsonSchema`; responses are then validated with Zod and
 * semantically checked. Free prose is never parsed with regex.
 */

export const TONES = ["hopeful", "ominous", "tragic", "triumphant", "mysterious", "tense", "somber", "wondrous"] as const;

export const FactionReaction = z.object({
  factionId: z.string().min(1).max(40),
  text: z.string().min(1).max(260),
});

export const WorldEventNarrative = z.object({
  eventId: z.string().min(1).max(40),
  title: z.string().min(3).max(80),
  description: z.string().min(20).max(1100),
  tone: z.enum(TONES),
  factionReactions: z.array(FactionReaction).max(5),
  playerExplanation: z.string().min(10).max(400),
  consequencesText: z.string().min(5).max(400),
  visualPrompt: z.string().min(10).max(400),
});
export type WorldEventNarrative = z.infer<typeof WorldEventNarrative>;

export const CampaignIntro = z.object({
  title: z.string().min(3).max(80),
  prologue: z.string().min(40).max(1400),
  objective: z.string().min(10).max(300),
  tone: z.enum(TONES),
  visualPrompt: z.string().min(10).max(400),
});
export type CampaignIntro = z.infer<typeof CampaignIntro>;

export const CampaignSummary = z.object({
  title: z.string().min(3).max(80),
  summary: z.string().min(40).max(1600),
  majorThreads: z.array(z.string().min(3).max(200)).max(6),
  tone: z.enum(TONES),
});
export type CampaignSummary = z.infer<typeof CampaignSummary>;

export const QuestNarrative = z.object({
  questId: z.string().min(1).max(40),
  title: z.string().min(3).max(80),
  description: z.string().min(20).max(600),
  flavor: z.string().min(5).max(300),
});
export type QuestNarrative = z.infer<typeof QuestNarrative>;

export const FactionNarrative = z.object({
  factionId: z.string().min(1).max(40),
  title: z.string().min(3).max(80),
  greeting: z.string().min(10).max(500),
  attitude: z.string().min(5).max(300),
  tone: z.enum(TONES),
});
export type FactionNarrative = z.infer<typeof FactionNarrative>;

export const DiscoveryNarrative = z.object({
  eventId: z.string().min(1).max(40),
  locationName: z.string().min(3).max(60),
  title: z.string().min(3).max(80),
  description: z.string().min(20).max(900),
  tone: z.enum(TONES),
  visualPrompt: z.string().min(10).max(400),
});
export type DiscoveryNarrative = z.infer<typeof DiscoveryNarrative>;

export const AIAssetPrompt = z.object({
  subject: z.string().min(5).max(300),
  composition: z.string().min(5).max(200),
  mood: z.string().min(3).max(100),
});
export type AIAssetPrompt = z.infer<typeof AIAssetPrompt>;

/** Convert a Zod schema into the JSON Schema object Gemini expects. */
export function toResponseJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: "draft-2020-12" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}
