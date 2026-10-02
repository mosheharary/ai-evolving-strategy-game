import { describe, expect, it, vi } from "vitest";
import { decide } from "@echoes/game-engine";
import type { DecisionRequest } from "@echoes/game-types";
import { CircuitBreaker, ProviderError, backoffDelay, MemoryStore, type StrategicDecisionProvider, type TextGenerationProvider } from "../src";
import { WorldEventNarrative } from "../src/narrative/schemas";
import { ctx, liveConfig, orchestrator, requests } from "./helpers";

const goodAnswer = (req: DecisionRequest, confidence = 0.9) => ({
  factionId: req.factionId,
  strategicAction: { choice: req.candidates.strategicActions[0]!, confidence, probabilities: { [req.candidates.strategicActions[0]!]: confidence } },
  stance: null, threatLevel: { score: 1, confidence: 0.6 }, foodUrgency: { score: 0, confidence: 0.6 }, shouldAttack: { probability: 0.1 },
  acceptProposals: {}, provider: "typesafe" as const, model: "jev-1.13.0",
});

const decisionProvider = (impl: (req: DecisionRequest) => Promise<unknown>): StrategicDecisionProvider & { calls: number } => {
  const p = {
    name: "typesafe" as const,
    calls: 0,
    async decide(req: DecisionRequest) {
      p.calls++;
      return { answer: (await impl(req)) as never, model: "jev-1.13.0", usage: { inputTokens: 10, outputTokens: 5 }, requestId: "rid" };
    },
  };
  return p;
};

describe("TypeSafe decisions through the orchestrator", () => {
  it("high-confidence answers are passed to the engine and recorded with the actual model", async () => {
    const reqs = requests();
    const provider = decisionProvider(async (r) => goodAnswer(r));
    const { o, recorder } = orchestrator({ decision: provider });
    const inputs = await o.decideFactions(reqs, ctx);
    expect(inputs.every((i) => i.answer !== null)).toBe(true);
    expect(recorder.decisions).toHaveLength(reqs.length);
    expect(recorder.decisions[0]).toMatchObject({ model: "jev-1.13.0", fallbackUsed: false, questionSchemaVersion: "faction_decision_v3" });
  });

  it("timeout → bounded retries → deterministic fallback (game continues)", async () => {
    const provider = decisionProvider(() => new Promise(() => {}));
    const { o, recorder } = orchestrator({ decision: provider });
    const inputs = await o.decideFactions(requests().slice(0, 1), ctx);
    expect(inputs[0]).toMatchObject({ answer: null, fallbackReason: "typesafe_timeout" });
    expect(provider.calls).toBe(3); // 1 attempt + 2 retries, never infinite
    expect(recorder.requests.at(-1)).toMatchObject({ status: "error", errorKind: "timeout" });
  });

  it("429 rate limit is retried then falls back", async () => {
    const provider = decisionProvider(async () => { throw new ProviderError("rate_limit", "429", { status: 429 }); });
    const { o } = orchestrator({ decision: provider });
    const [r] = await o.decideFactions(requests().slice(0, 1), ctx);
    expect(r!.fallbackReason).toBe("typesafe_rate_limit");
    expect(provider.calls).toBe(3);
  });

  it("provider unavailable (5xx) falls back; auth errors are not retried", async () => {
    const down = decisionProvider(async () => { throw new ProviderError("unavailable", "503", { status: 503 }); });
    expect((await orchestrator({ decision: down }).o.decideFactions(requests().slice(0, 1), ctx))[0]!.answer).toBeNull();
    const auth = decisionProvider(async () => { throw new ProviderError("auth", "401", { status: 401 }); });
    await orchestrator({ decision: auth }).o.decideFactions(requests().slice(0, 1), ctx);
    expect(auth.calls).toBe(1);
  });

  it("duplicate identical requests are served from cache (no second provider call)", async () => {
    const provider = decisionProvider(async (r) => goodAnswer(r));
    const { o, recorder } = orchestrator({ decision: provider });
    const req = requests().slice(0, 1);
    await o.decideFactions(req, ctx);
    await o.decideFactions(req, ctx);
    expect(provider.calls).toBe(1);
    expect(recorder.requests.some((r) => r.status === "cache_hit")).toBe(true);
  });

  it("low- vs high-confidence answers drive different engine behaviour", () => {
    const req = requests()[0]!;
    const base = { candidates: req.candidates, utilities: { expand: 1, defend: 0.5, trade: 0.2, raid: 0, research: 0.3, retreat: -1 }, stanceUtilities: {}, forced: null, aggression: 0.3, foodCritical: false, threatCritical: false };
    const cfg = { executeThreshold: 0.8, conservativeThreshold: 0.55 };
    const choice = req.candidates.strategicActions.find((a) => a !== "expand")!;
    const mk = (c: number) => ({ ...goodAnswer(req, c), strategicAction: { choice, confidence: c, probabilities: { [choice]: c } } });
    expect(decide(base, mk(0.95) as never, cfg, null).action).toBe(choice);
    expect(decide(base, mk(0.2) as never, cfg, null).mode).toBe("fallback");
  });

  it("per-turn budget is enforced (runaway cost protection)", async () => {
    const provider = decisionProvider(async (r) => goodAnswer(r));
    const { o } = orchestrator({ decision: provider, config: liveConfig({ MAX_AI_REQUESTS_PER_TURN: "2" }) });
    const inputs = await o.decideFactions(requests(), ctx);
    expect(inputs.filter((i) => i.answer).length).toBe(2);
    expect(inputs.filter((i) => i.fallbackReason === "typesafe_budget").length).toBe(inputs.length - 2);
  });

  it("developer fault injection disables TypeSafe without breaking turns", async () => {
    const provider = decisionProvider(async (r) => goodAnswer(r));
    const { o } = orchestrator({ decision: provider });
    await o.faults.set({ disableTypeSafe: true });
    const inputs = await o.decideFactions(requests(), ctx);
    expect(inputs.every((i) => i.fallbackReason === "typesafe_disabled")).toBe(true);
    expect(provider.calls).toBe(0);
    expect((await o.status()).message).toMatch(/frontier oracle/);
  });

  it("mock and deterministic modes need no keys", async () => {
    const mock = orchestrator({ config: liveConfig({ AI_MODE: "mock" }) }).o;
    expect((await mock.decideFactions(requests(), ctx)).every((i) => i.answer?.provider === "mock")).toBe(true);
    const det = orchestrator({ config: liveConfig({ AI_MODE: "deterministic" }) }).o;
    expect((await det.decideFactions(requests(), ctx)).every((i) => i.answer === null)).toBe(true);
  });
});

describe("Gemini narrative through the orchestrator", () => {
  const facts = { eventId: "e1", type: "drought", region: "the Black Valley", summary: "Drought grips the Black Valley.", consequences: ["Food -20%"], immediate: [], factions: [], relatedHistory: [], cause: { rainfall: 0.2 } };
  const textProvider = (impl: () => Promise<unknown>): TextGenerationProvider & { calls: number } => {
    const p = {
      name: "gemini" as const, calls: 0,
      async generateStructured<T>(req: { schema: { safeParse: (v: unknown) => { success: boolean; data?: T } } }) {
        p.calls++;
        const raw = await impl();
        const parsed = req.schema.safeParse(raw);
        if (!parsed.success) throw new ProviderError("malformed", "schema");
        return { data: parsed.data as T, model: "gemini-3.8-flash", usage: { inputTokens: 100, outputTokens: 50 } };
      },
    };
    return p as never;
  };
  const valid = { eventId: "e1", title: "The Thirsting", description: "A long and terrible dry season settles over the valley.", tone: "somber", factionReactions: [], playerExplanation: "Rainfall fell below the threshold.", consequencesText: "Food falls by a fifth.", visualPrompt: "cracked earth valley" };

  it("valid structured output is used", async () => {
    const { o } = orchestrator({ text: textProvider(async () => valid) });
    const r = await o.generateText({ prompt: "event_narrative", input: "x", facts, schema: WorldEventNarrative, ctx });
    expect(r.source).toBe("gemini");
    expect(r.data.title).toBe("The Thirsting");
  });

  it("malformed output is rejected, retried, then replaced by the local narrative", async () => {
    const p = textProvider(async () => ({ title: 42 }));
    const { o, recorder } = orchestrator({ text: p });
    const r = await o.generateText({ prompt: "event_narrative", input: "x", facts, schema: WorldEventNarrative, ctx });
    expect(p.calls).toBe(3);
    expect(r.source).toBe("local");
    expect(r.data.eventId).toBe("e1");
    expect(recorder.requests.some((x) => x.status === "fallback")).toBe(true);
  });

  it("semantic validation rejects invented faction ids / mismatched events", async () => {
    const p = textProvider(async () => ({ ...valid, eventId: "e999" }));
    const { o } = orchestrator({ text: p });
    const r = await o.generateText({ prompt: "event_narrative", input: "x", facts, schema: WorldEventNarrative, ctx, semanticCheck: (d) => (d.eventId !== "e1" ? "mismatch" : null) });
    expect(r.source).toBe("local");
  });

  it("Gemini disabled → local narrative, no provider call", async () => {
    const p = textProvider(async () => valid);
    const { o } = orchestrator({ text: p });
    await o.faults.set({ disableGemini: true });
    const r = await o.generateText({ prompt: "event_narrative", input: "x", facts, schema: WorldEventNarrative, ctx });
    expect(r.source).toBe("local");
    expect(p.calls).toBe(0);
  });

  it("concurrent identical requests are deduplicated in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const p = textProvider(async () => { await gate; return valid; });
    const { o } = orchestrator({ text: p });
    const a = o.generateText({ prompt: "event_narrative", input: "same", facts, schema: WorldEventNarrative, ctx });
    const b = o.generateText({ prompt: "event_narrative", input: "same", facts, schema: WorldEventNarrative, ctx });
    release();
    await Promise.all([a, b]);
    expect(p.calls).toBe(1);
  });
});

describe("resilience primitives", () => {
  it("backoff grows exponentially with jitter and attempt 1 is immediate", () => {
    const p = { attempts: 3, baseDelayMs: 300, maxDelayMs: 4000, jitter: 0.3 };
    expect(backoffDelay(1, p)).toBe(0);
    const d2 = backoffDelay(2, p, () => 0.5);
    const d3 = backoffDelay(3, p, () => 0.5);
    expect(d2).toBe(300);
    expect(d3).toBe(1200);
    expect(backoffDelay(2, p, () => 0)).toBeLessThan(backoffDelay(2, p, () => 1));
  });

  it("circuit breaker opens after repeated failures and half-opens after cooldown", async () => {
    let now = 0;
    const cb = new CircuitBreaker("x", 2, 1000, () => now);
    const fail = () => cb.run(async () => { throw new ProviderError("unavailable", "down"); });
    await expect(fail()).rejects.toThrow();
    await expect(fail()).rejects.toThrow();
    expect(cb.getState()).toBe("open");
    await expect(cb.run(async () => 1)).rejects.toMatchObject({ kind: "circuit_open" });
    now = 1500;
    expect(cb.getState()).toBe("half_open");
    await expect(cb.run(async () => 7)).resolves.toBe(7);
    expect(cb.getState()).toBe("closed");
  });

  it("memory store TTL and counters behave like Redis", async () => {
    let now = 0;
    const s = new MemoryStore(() => now);
    expect(await s.incr("k", 10)).toBe(1);
    expect(await s.incr("k", 10)).toBe(2);
    now = 11_000;
    expect(await s.incr("k", 10)).toBe(1);
    vi.useRealTimers();
  });
});
