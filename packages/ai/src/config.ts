import { z } from "zod";

/**
 * AI configuration — read once, server-side only. API keys are held in this
 * object in memory and are never logged, persisted or sent to the browser.
 *
 * AI_MODE:
 *   live          — call Gemini / TypeSafe (requires keys; missing key → that provider degrades to mock)
 *   mock          — no external calls; realistic local providers (probabilistic decisions, template prose, procedural art)
 *   deterministic — no external calls; decisions always use the engine's deterministic fallback policy
 *   auto          — live per provider when its key is present, otherwise mock (default)
 */

const num = (def: number) => z.coerce.number().finite().default(def);

const EnvSchema = z.object({
  AI_MODE: z.enum(["live", "mock", "deterministic", "auto"]).default("auto"),
  GOOGLE_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GOOGLE_TEXT_MODEL: z.string().min(1).default("gemini-3.8-flash"),
  GOOGLE_IMAGE_MODEL: z.string().min(1).default("gemini-3.1-flash-image"),
  GOOGLE_IMAGE_HERO_MODEL: z.string().min(1).default("gemini-3-pro-image"),
  GOOGLE_CONTEXT_CACHE: z.enum(["true", "false"]).default("false"),
  GOOGLE_TIMEOUT_MS: num(20_000),
  GOOGLE_IMAGE_TIMEOUT_MS: num(90_000),
  TYPESAFE_API_KEY: z.string().optional(),
  TYPESAFE_MODEL: z.string().min(1).default("jev-latest"),
  TYPESAFE_BASE_URL: z.string().url().optional(),
  TYPESAFE_TIMEOUT_MS: num(6_000),
  TYPESAFE_MAX_RETRIES: num(2),
  TYPESAFE_TURN_DEADLINE_MS: num(15_000),
  MAX_AI_REQUESTS_PER_TURN: num(10),
  MAX_AI_REQUESTS_PER_GAME: num(1_500),
  MAX_AI_REQUESTS_PER_USER_PER_DAY: num(3_000),
  MAX_IMAGES_PER_TURN: num(2),
  MAX_IMAGES_PER_GAME: num(60),
  AI_EXECUTE_THRESHOLD: num(0.8),
  AI_CONSERVATIVE_THRESHOLD: num(0.55),
  AI_CIRCUIT_FAILURES: num(5),
  AI_CIRCUIT_COOLDOWN_MS: num(30_000),
  AI_MAX_CONCURRENCY: num(6),
});

export type ProviderMode = "live" | "mock" | "deterministic";

export interface AIConfig {
  mode: "live" | "mock" | "deterministic" | "auto";
  google: {
    apiKey: string | null;
    textModel: string;
    imageModel: string;
    heroImageModel: string;
    contextCache: boolean;
    timeoutMs: number;
    imageTimeoutMs: number;
  };
  typesafe: {
    apiKey: string | null;
    model: string;
    baseURL: string | undefined;
    timeoutMs: number;
    maxRetries: number;
    turnDeadlineMs: number;
  };
  budgets: {
    perTurn: number;
    perGame: number;
    perUserPerDay: number;
    imagesPerTurn: number;
    imagesPerGame: number;
  };
  policy: { executeThreshold: number; conservativeThreshold: number };
  circuit: { failures: number; cooldownMs: number };
  maxConcurrency: number;
  /** Effective per-provider modes after resolving "auto" and missing keys. */
  effective: { narrative: ProviderMode; images: ProviderMode; strategy: ProviderMode };
}

export function loadAIConfig(env: Record<string, string | undefined> = process.env): AIConfig {
  const e = EnvSchema.parse(env);
  // GOOGLE_API_KEY is canonical; GEMINI_API_KEY is accepted only as a compatibility fallback.
  const googleKey = (e.GOOGLE_API_KEY?.trim() || e.GEMINI_API_KEY?.trim()) ?? "";
  const typesafeKey = e.TYPESAFE_API_KEY?.trim() ?? "";
  const resolve = (hasKey: boolean): ProviderMode => {
    if (e.AI_MODE === "deterministic") return "deterministic";
    if (e.AI_MODE === "mock") return "mock";
    return hasKey ? "live" : "mock";
  };
  if (e.AI_EXECUTE_THRESHOLD <= e.AI_CONSERVATIVE_THRESHOLD) {
    throw new Error("AI_EXECUTE_THRESHOLD must be greater than AI_CONSERVATIVE_THRESHOLD");
  }
  return {
    mode: e.AI_MODE,
    google: {
      apiKey: googleKey || null,
      textModel: e.GOOGLE_TEXT_MODEL,
      imageModel: e.GOOGLE_IMAGE_MODEL,
      heroImageModel: e.GOOGLE_IMAGE_HERO_MODEL,
      contextCache: e.GOOGLE_CONTEXT_CACHE === "true",
      timeoutMs: e.GOOGLE_TIMEOUT_MS,
      imageTimeoutMs: e.GOOGLE_IMAGE_TIMEOUT_MS,
    },
    typesafe: {
      apiKey: typesafeKey || null,
      model: e.TYPESAFE_MODEL,
      baseURL: e.TYPESAFE_BASE_URL,
      timeoutMs: e.TYPESAFE_TIMEOUT_MS,
      maxRetries: e.TYPESAFE_MAX_RETRIES,
      turnDeadlineMs: e.TYPESAFE_TURN_DEADLINE_MS,
    },
    budgets: {
      perTurn: e.MAX_AI_REQUESTS_PER_TURN,
      perGame: e.MAX_AI_REQUESTS_PER_GAME,
      perUserPerDay: e.MAX_AI_REQUESTS_PER_USER_PER_DAY,
      imagesPerTurn: e.MAX_IMAGES_PER_TURN,
      imagesPerGame: e.MAX_IMAGES_PER_GAME,
    },
    policy: { executeThreshold: e.AI_EXECUTE_THRESHOLD, conservativeThreshold: e.AI_CONSERVATIVE_THRESHOLD },
    circuit: { failures: e.AI_CIRCUIT_FAILURES, cooldownMs: e.AI_CIRCUIT_COOLDOWN_MS },
    maxConcurrency: e.AI_MAX_CONCURRENCY,
    effective: {
      narrative: resolve(!!googleKey),
      images: resolve(!!googleKey),
      strategy: resolve(!!typesafeKey),
    },
  };
}

/** Safe summary for logs and /ready — never includes keys. */
export function describeAIConfig(c: AIConfig): Record<string, unknown> {
  return {
    mode: c.mode,
    effective: c.effective,
    googleKeyConfigured: !!c.google.apiKey,
    typesafeKeyConfigured: !!c.typesafe.apiKey,
    textModel: c.google.textModel,
    imageModel: c.google.imageModel,
    heroImageModel: c.google.heroImageModel,
    typesafeModel: c.typesafe.model,
  };
}
