import { ApiError, GoogleGenAI, type GenerateContentResponse } from "@google/genai";
import { ProviderError, type TokenUsage } from "../providers/types";

/**
 * GoogleAIService — the only module that talks to the Google GenAI SDK (@google/genai).
 * The key comes from process.env.GOOGLE_API_KEY (GEMINI_API_KEY as fallback) via AIConfig
 * and is passed explicitly; the SDK's own env discovery is not relied upon.
 * SDK-level retries are disabled — the AIOrchestrator owns the single retry policy.
 */
export class GoogleAIService {
  private readonly client: GoogleGenAI;

  constructor(apiKey: string, private readonly opts: { textTimeoutMs: number; imageTimeoutMs: number }) {
    this.client = new GoogleGenAI({ apiKey, httpOptions: { retryOptions: { attempts: 1 } } });
  }

  async generateJson(args: {
    model: string;
    system: string;
    prompt: string;
    jsonSchema: Record<string, unknown>;
    temperature?: number;
    maxOutputTokens?: number;
    cachedContent?: string | null;
    signal?: AbortSignal;
  }): Promise<{ json: unknown; usage: TokenUsage; model: string }> {
    let res: GenerateContentResponse;
    try {
      res = await this.client.models.generateContent({
        model: args.model,
        contents: [{ role: "user", parts: [{ text: args.prompt }] }],
        config: {
          ...(args.cachedContent ? { cachedContent: args.cachedContent } : { systemInstruction: args.system }),
          responseMimeType: "application/json",
          responseJsonSchema: args.jsonSchema,
          temperature: args.temperature ?? 0.9,
          maxOutputTokens: args.maxOutputTokens ?? 2048,
          abortSignal: args.signal,
          httpOptions: { timeout: this.opts.textTimeoutMs },
        },
      });
    } catch (e) {
      throw mapGoogleError(e);
    }
    const text = res.text;
    if (!text) throw new ProviderError(blockedKind(res), "Gemini returned no text");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new ProviderError("malformed", "Gemini returned invalid JSON", { cause: e });
    }
    return { json, usage: usageOf(res), model: res.modelVersion ?? args.model };
  }

  async generateImage(args: { model: string; prompt: string; aspectRatio: string; signal?: AbortSignal }): Promise<{ bytes: Uint8Array; mimeType: string; usage: TokenUsage; model: string }> {
    let res: GenerateContentResponse;
    try {
      res = await this.client.models.generateContent({
        model: args.model,
        contents: [{ role: "user", parts: [{ text: args.prompt }] }],
        config: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio: args.aspectRatio },
          abortSignal: args.signal,
          httpOptions: { timeout: this.opts.imageTimeoutMs },
        },
      });
    } catch (e) {
      throw mapGoogleError(e);
    }
    const parts = res.candidates?.[0]?.content?.parts ?? [];
    const img = parts.find((p) => p.inlineData?.data && p.inlineData.mimeType?.startsWith("image/"));
    if (!img?.inlineData?.data) throw new ProviderError(blockedKind(res), "Gemini returned no image");
    return {
      bytes: Uint8Array.from(Buffer.from(img.inlineData.data, "base64")),
      mimeType: img.inlineData.mimeType ?? "image/png",
      usage: usageOf(res),
      model: res.modelVersion ?? args.model,
    };
  }

  /**
   * Explicit context cache for large, stable context (faction lore, game rules,
   * long campaign summaries). Only used when enabled and the content is large
   * enough to qualify for Gemini caching.
   */
  async createContextCache(args: { model: string; system: string; content: string; ttlSeconds: number; displayName: string }): Promise<string> {
    try {
      const cache = await this.client.caches.create({
        model: args.model,
        config: {
          displayName: args.displayName,
          systemInstruction: args.system,
          contents: [{ role: "user", parts: [{ text: args.content }] }],
          ttl: `${args.ttlSeconds}s`,
        },
      });
      if (!cache.name) throw new ProviderError("unavailable", "Cache creation returned no name");
      return cache.name;
    } catch (e) {
      throw e instanceof ProviderError ? e : mapGoogleError(e);
    }
  }
}

function usageOf(res: GenerateContentResponse): TokenUsage {
  return {
    inputTokens: res.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: (res.usageMetadata?.candidatesTokenCount ?? 0) + (res.usageMetadata?.thoughtsTokenCount ?? 0),
  };
}

function blockedKind(res: GenerateContentResponse): "safety" | "malformed" {
  const reason = res.promptFeedback?.blockReason ?? res.candidates?.[0]?.finishReason;
  return reason && /SAFETY|BLOCK|PROHIBITED/i.test(String(reason)) ? "safety" : "malformed";
}

export function mapGoogleError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof ApiError) {
    const s = e.status;
    // Provider messages may echo request details; keep only a short, key-free summary.
    const msg = `Gemini API error ${s}`;
    if (s === 429) return new ProviderError("rate_limit", msg, { status: s, cause: e });
    if (s === 401 || s === 403) return new ProviderError("auth", msg, { status: s, cause: e });
    if (s === 400 || s === 404) return new ProviderError("bad_request", msg, { status: s, cause: e });
    if (s === 408 || s === 504) return new ProviderError("timeout", msg, { status: s, cause: e });
    if (s >= 500) return new ProviderError("unavailable", msg, { status: s, cause: e });
    return new ProviderError("unavailable", msg, { status: s, cause: e });
  }
  if (e instanceof Error && (e.name === "AbortError" || /abort|timed? ?out/i.test(e.message))) {
    return new ProviderError("timeout", "Gemini request timed out", { cause: e });
  }
  return new ProviderError("unavailable", "Gemini request failed", { cause: e });
}
