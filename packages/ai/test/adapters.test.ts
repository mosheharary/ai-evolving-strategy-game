import { describe, expect, it } from "vitest";
import { ApiError } from "@google/genai";
import { buildQuestionSpec, loadAIConfig, mapGoogleError, MemoryAssetStorage, ImageGenerationService, TypeSafeDecisionProvider, toStrategicAnswer, type AssetRecord, type AssetRepository } from "../src";
import { createGame } from "@echoes/game-engine";
import { ctx, orchestrator, requests } from "./helpers";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("TypeSafe adapter (System One over HTTP, fake transport)", () => {
  const req = requests()[0]!;
  const spec = buildQuestionSpec(req);
  const okBody = (choice = req.candidates.strategicActions[0]!) => ({
    model: "jev-1.13.0",
    usage: { input_tokens: 1200, output_tokens: 140 },
    answers: {
      ...(spec.strategicAction ? { strategicAction: { type: "choice", choice, confidence: 0.88, probabilities: { [choice]: 0.88 } } } : {}),
      ...(spec.stance ? { diplomaticStance: { type: "choice", choice: spec.stance.options[0], confidence: 0.7, probabilities: {} } } : {}),
      threatLevel: { type: "score", score: 1.4, confidence: 0.6, legend: {}, probabilities: {} },
      foodUrgency: { type: "score", score: 0.5, confidence: 0.7, legend: {}, probabilities: {} },
      shouldAttack: { type: "noul", noul: 0.2 },
    },
  });

  it("sends typed Choice/Score/Noul questions with the configured model and parses the answer", async () => {
    let sent: { model?: string; questions?: Record<string, { type: string }>; state?: unknown } = {};
    const p = new TypeSafeDecisionProvider({
      apiKey: "k", model: "jev-1.13.0", timeoutMs: 1000,
      fetch: async (url, init) => {
        expect(url).toMatch(/\/v1\/systemone$/);
        sent = JSON.parse(String(init?.body));
        return json(200, okBody(), { "x-typesafe-request-id": "req-1" });
      },
    });
    const r = await p.decide(req, ctx);
    expect(sent.model).toBe("jev-1.13.0");
    expect(sent.questions?.threatLevel?.type).toBe("score");
    expect(sent.questions?.shouldAttack?.type).toBe("noul");
    expect((sent.state as { faction: { id: string } }).faction.id).toBe(req.factionId);
    expect(r.answer?.strategicAction.confidence).toBe(0.88);
    expect(r.model).toBe("jev-1.13.0");
    expect(r.requestId).toBe("req-1");
  });

  it("maps 429 to rate_limit, 503 to unavailable, malformed bodies to malformed", async () => {
    const make = (res: () => Response) => new TypeSafeDecisionProvider({ apiKey: "k", model: "jev-latest", timeoutMs: 1000, fetch: async () => res() });
    await expect(make(() => json(429, { error: "slow down" }, { "retry-after-ms": "10" })).decide(req, ctx)).rejects.toMatchObject({ kind: "rate_limit" });
    await expect(make(() => json(503, { error: "down" })).decide(req, ctx)).rejects.toMatchObject({ kind: "unavailable" });
    await expect(make(() => json(200, { model: "jev", usage: { input_tokens: 1, output_tokens: 1 }, answers: { strategicAction: { type: "choice" } } })).decide(req, ctx)).rejects.toMatchObject({ kind: "malformed" });
  });

  it("rejects an answer naming an action outside the legal candidate list", () => {
    const body = okBody();
    const answers = { ...body.answers, strategicAction: { type: "choice", choice: "build_super_weapon", confidence: 0.99, probabilities: {} } };
    if (!spec.strategicAction) return;
    expect(() => toStrategicAnswer(req, spec, answers, "jev-1.13.0")).toThrow(/schema|illegal|allowed/);
  });
});

describe("Gemini adapter", () => {
  it("maps HTTP errors to provider error kinds without leaking details", () => {
    expect(mapGoogleError(new ApiError({ message: "quota key=SECRET", status: 429 }))).toMatchObject({ kind: "rate_limit", retryable: true });
    expect(mapGoogleError(new ApiError({ message: "x", status: 503 }))).toMatchObject({ kind: "unavailable" });
    expect(mapGoogleError(new ApiError({ message: "x", status: 401 }))).toMatchObject({ kind: "auth", retryable: false });
    expect(mapGoogleError(new ApiError({ message: "key=SECRET", status: 500 })).message).not.toMatch(/SECRET/);
  });

  it("reads GOOGLE_API_KEY first, GEMINI_API_KEY as fallback, and auto-selects mock without keys", () => {
    expect(loadAIConfig({ GOOGLE_API_KEY: "g", GEMINI_API_KEY: "x" }).google.apiKey).toBe("g");
    expect(loadAIConfig({ GEMINI_API_KEY: "x" }).google.apiKey).toBe("x");
    expect(loadAIConfig({}).effective).toEqual({ narrative: "mock", images: "mock", strategy: "mock" });
    expect(loadAIConfig({ TYPESAFE_API_KEY: "t" }).effective.strategy).toBe("live");
    expect(loadAIConfig({ GOOGLE_TEXT_MODEL: "custom-model" }).google.textModel).toBe("custom-model");
  });
});

describe("ImageGenerationService", () => {
  class MemRepo implements AssetRepository {
    rows: AssetRecord[] = [];
    async findByPromptHash(h: string) { return this.rows.find((r) => r.promptHash === h) ?? null; }
    async create(rec: Omit<AssetRecord, "assetId" | "createdAt">) { const r = { ...rec, assetId: `a${this.rows.length}`, createdAt: new Date() }; this.rows.push(r); return r; }
  }

  it("generates once, persists metadata and reuses the cached asset", async () => {
    let calls = 0;
    const image = { name: "gemini" as const, async generateImage() { calls++; return { bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 4, 0, 0, 0, 2, 64]), mimeType: "image/png", width: 1024, height: 576, model: "gemini-3.1-flash-image" }; } };
    const { o } = orchestrator({ image });
    const repo = new MemRepo();
    const svc = new ImageGenerationService(o, new MemoryAssetStorage(), repo);
    const state = createGame({ gameId: "gtest", seed: "img", civilizationName: "Testers" });
    const a = await svc.generateFactionPortrait(state, "verdant", ctx);
    const b = await svc.generateFactionPortrait(state, "verdant", ctx);
    expect(calls).toBe(1);
    expect(b.assetId).toBe(a.assetId);
    expect(a).toMatchObject({ model: "gemini-3.1-flash-image", mimeType: "image/png", source: "gemini", gameId: "gtest" });
    expect(a.promptHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("falls back to a procedural image when generation fails", async () => {
    const image = { name: "gemini" as const, async generateImage(): Promise<never> { throw new Error("boom"); } };
    const { o } = orchestrator({ image });
    const svc = new ImageGenerationService(o, new MemoryAssetStorage(), new MemRepo());
    const state = createGame({ gameId: "gtest", seed: "img2", civilizationName: "Testers" });
    const a = await svc.generateTechnologyImage(state, "writing", ctx);
    expect(a).toMatchObject({ source: "local", mimeType: "image/svg+xml" });
  });
});
