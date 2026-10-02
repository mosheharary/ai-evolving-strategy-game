import type { DecisionRequest, StrategicAnswer } from "@echoes/game-types";
import type { z } from "zod";

export type ProviderName = "gemini" | "typesafe" | "local" | "mock";

export type ProviderErrorKind =
  | "rate_limit"
  | "timeout"
  | "unavailable"
  | "malformed"
  | "auth"
  | "bad_request"
  | "disabled"
  | "budget"
  | "circuit_open"
  | "safety";

/** Normalised provider failure. `retryable` drives the retry policy. */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status: number | null;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;

  constructor(kind: ProviderErrorKind, message: string, opts: { status?: number | null; retryAfterMs?: number | null; cause?: unknown } = {}) {
    super(message, { cause: opts.cause });
    this.name = "ProviderError";
    this.kind = kind;
    this.status = opts.status ?? null;
    this.retryAfterMs = opts.retryAfterMs ?? null;
    this.retryable = kind === "rate_limit" || kind === "timeout" || kind === "unavailable" || kind === "malformed";
  }
}

export interface CallContext {
  correlationId: string;
  gameId: string;
  turn: number;
  playerId: string;
  signal?: AbortSignal;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface StructuredTextRequest<T> {
  promptId: string;
  promptVersion: number;
  model: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  temperature?: number;
  maxOutputTokens?: number;
  cachedContent?: string | null;
  /** Facts the local provider can render without a model. */
  facts: Record<string, unknown>;
}

export interface StructuredTextResult<T> {
  data: T;
  model: string;
  usage: TokenUsage;
}

export interface TextGenerationProvider {
  readonly name: ProviderName;
  generateStructured<T>(req: StructuredTextRequest<T>, ctx: CallContext): Promise<StructuredTextResult<T>>;
}

export interface ImageRequest {
  promptId: string;
  promptVersion: number;
  model: string;
  prompt: string;
  aspectRatio: "16:9" | "1:1" | "3:4" | "4:3";
  /** Deterministic facts for the procedural (local) renderer. */
  facts: { title: string; palette: string; biome: string; seed: string; kind: string };
}

export interface ImageResult {
  bytes: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
  model: string;
}

export interface ImageGenerationProvider {
  readonly name: ProviderName;
  generateImage(req: ImageRequest, ctx: CallContext): Promise<ImageResult>;
}

export interface DecisionResult {
  answer: StrategicAnswer | null;
  model: string;
  usage: TokenUsage;
  requestId: string | null;
}

export interface StrategicDecisionProvider {
  readonly name: ProviderName;
  decide(req: DecisionRequest, ctx: CallContext): Promise<DecisionResult>;
}
