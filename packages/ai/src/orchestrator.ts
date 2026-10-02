import type { AIStatusView, DecisionRequest, FactionDecisionInput, ProviderHealth } from "@echoes/game-types";
import { QUESTION_SCHEMA_VERSION } from "@echoes/game-types";
import { canonicalStringify, sha256Hex } from "@echoes/shared";
import type { z } from "zod";
import type { AIConfig } from "./config";
import { PROMPTS, type PromptKey } from "./narrative/prompts";
import {
  ProviderError,
  type CallContext,
  type ImageGenerationProvider,
  type ImageRequest,
  type ImageResult,
  type StrategicDecisionProvider,
  type TextGenerationProvider,
  type TokenUsage,
} from "./providers/types";
import { CircuitBreaker } from "./resilience/circuitBreaker";
import { BudgetManager, FaultInjector, InFlightDeduper, RequestQueue, ResponseCache } from "./resilience/controls";
import { withRetry, withTimeout, type RetryPolicy, type Sleep } from "./resilience/retry";
import type { KeyValueStore } from "./resilience/store";
import { FACTION_DECISION_PROMPT } from "./typesafe/questions";
import type { AIRecorder, AIRequestStatus, Logger } from "./telemetry";

export interface OrchestratorProviders {
  text: { live: TextGenerationProvider | null; local: TextGenerationProvider };
  image: { live: ImageGenerationProvider | null; local: ImageGenerationProvider };
  decision: { live: StrategicDecisionProvider | null; mock: StrategicDecisionProvider; deterministic: StrategicDecisionProvider };
}

export interface OrchestratorDeps {
  config: AIConfig;
  store: KeyValueStore;
  recorder: AIRecorder;
  logger: Logger;
  providers: OrchestratorProviders;
  sleep?: Sleep;
  retry?: Partial<RetryPolicy>;
}

export interface TextOutcome<T> {
  data: T;
  source: "gemini" | "local";
  model: string;
}

export interface ImageOutcome extends ImageResult {
  source: "gemini" | "local";
  promptHash: string;
}

export function cacheKeyFor(provider: string, model: string, promptId: string, promptVersion: number, input: unknown): string {
  return sha256Hex(`${provider}|${model}|${promptId}@${promptVersion}|${canonicalStringify(input)}`);
}

/**
 * AIOrchestrator — the single gateway for all AI work. Every call passes through:
 *   fault injection → budget → cache → in-flight dedupe → queue → circuit breaker
 *   → timeout + bounded retry with backoff/jitter → schema validation → telemetry
 * and degrades to a local/deterministic provider on any failure. AI is never a
 * single point of failure.
 */
export class AIOrchestrator {
  readonly config: AIConfig;
  readonly faults: FaultInjector;
  private readonly budget: BudgetManager;
  private readonly cache: ResponseCache;
  private readonly dedupe = new InFlightDeduper();
  private readonly queue: RequestQueue;
  private readonly breakers: Record<"gemini" | "typesafe", CircuitBreaker>;
  private readonly lastFailure: Record<"gemini" | "typesafe", number> = { gemini: 0, typesafe: 0 };
  private readonly retryPolicy: RetryPolicy;

  constructor(private readonly deps: OrchestratorDeps) {
    this.config = deps.config;
    this.faults = new FaultInjector(deps.store);
    this.budget = new BudgetManager(deps.store, deps.config.budgets);
    this.cache = new ResponseCache(deps.store);
    this.queue = new RequestQueue(deps.config.maxConcurrency);
    this.breakers = {
      gemini: new CircuitBreaker("gemini", deps.config.circuit.failures, deps.config.circuit.cooldownMs),
      typesafe: new CircuitBreaker("typesafe", deps.config.circuit.failures, deps.config.circuit.cooldownMs),
    };
    this.retryPolicy = { attempts: 3, baseDelayMs: 300, maxDelayMs: 4_000, jitter: 0.3, ...deps.retry };
  }

  // ------------------------------------------------------------------ status

  async status(): Promise<AIStatusView> {
    const f = await this.faults.get();
    const health = (p: "gemini" | "typesafe", mode: string, disabled: boolean): ProviderHealth => {
      if (mode !== "live") return "mock";
      if (disabled || f.forceRateLimit || f.forceTimeout) return "offline";
      if (this.breakers[p].getState() === "open") return "offline";
      if (Date.now() - this.lastFailure[p] < 60_000) return "degraded";
      return "online";
    };
    const narrative = health("gemini", this.config.effective.narrative, f.disableGemini);
    const images = health("gemini", this.config.effective.images, f.disableGemini);
    const strategy = health("typesafe", this.config.effective.strategy, f.disableTypeSafe);
    let message: string | null = null;
    if (strategy === "offline" || strategy === "degraded") message = "The frontier oracle is temporarily unavailable. Your civilization can continue using fallback strategy.";
    else if (narrative === "offline" || narrative === "degraded") message = "The chroniclers are quiet for now. The story continues in plainer words.";
    return { narrative, images, strategy, message };
  }

  // ------------------------------------------------------------------ core pipeline

  private async run<T>(args: {
    provider: "gemini" | "typesafe";
    operation: string;
    model: string;
    promptId: string;
    promptVersion: number;
    cacheKey: string | null;
    budgetKind: "text" | "decision" | "image";
    timeoutMs: number;
    ctx: CallContext;
    call: (signal: AbortSignal) => Promise<{ value: T; usage: TokenUsage; model: string }>;
  }): Promise<{ value: T; model: string; status: AIRequestStatus; retries: number; latencyMs: number }> {
    const started = Date.now();
    const base = {
      correlationId: args.ctx.correlationId, gameId: args.ctx.gameId, turn: args.ctx.turn, playerId: args.ctx.playerId,
      provider: args.provider, operation: args.operation, promptId: args.promptId, promptVersion: args.promptVersion, cacheKey: args.cacheKey ?? "",
    };
    const record = async (status: AIRequestStatus, extra: { model: string; retries: number; errorKind?: string | null; usage?: TokenUsage }): Promise<void> => {
      const latencyMs = Date.now() - started;
      const rec = {
        ...base, model: extra.model, status, errorKind: extra.errorKind ?? null, latencyMs, retryCount: extra.retries,
        inputTokens: extra.usage?.inputTokens ?? 0, outputTokens: extra.usage?.outputTokens ?? 0,
      };
      this.deps.logger[status === "error" ? "warn" : "info"]({ ...rec, cacheKey: undefined }, `ai.${args.operation}`);
      await this.deps.recorder.recordRequest(rec).catch((e: unknown) => this.deps.logger.error({ err: String(e) }, "ai.record_failed"));
    };

    if (args.cacheKey) {
      const hit = await this.cache.get<{ value: T; model: string }>(args.cacheKey);
      if (hit) {
        await record("cache_hit", { model: hit.model, retries: 0 });
        return { value: hit.value, model: hit.model, status: "cache_hit", retries: 0, latencyMs: Date.now() - started };
      }
    }

    const key = args.cacheKey ?? `${args.operation}:${started}:${Math.random()}`;
    const { promise, deduplicated } = this.dedupe.run(key, async () => {
      await this.faults.apply(args.provider);
      await this.budget.consume({ gameId: args.ctx.gameId, turn: args.ctx.turn, playerId: args.ctx.playerId, kind: args.budgetKind });
      let retries = 0;
      const out = await this.queue.run(() =>
        this.breakers[args.provider].run(() =>
          withRetry(
            async () => {
              await this.faults.apply(args.provider);
              return withTimeout((signal) => args.call(signal), args.timeoutMs, args.ctx.signal);
            },
            this.retryPolicy,
            { sleep: this.deps.sleep, signal: args.ctx.signal, onRetry: (_e, attempt) => (retries = attempt) },
          ),
        ),
      );
      retries = out.retries;
      return { ...out.value, retries };
    });
    try {
      const out = await promise;
      if (!deduplicated) {
        if (args.cacheKey) await this.cache.set(args.cacheKey, { value: out.value, model: out.model });
        await record("success", { model: out.model, retries: out.retries, usage: out.usage });
      } else await record("deduplicated", { model: out.model, retries: 0 });
      return { value: out.value, model: out.model, status: deduplicated ? "deduplicated" : "success", retries: out.retries, latencyMs: Date.now() - started };
    } catch (e) {
      const pe = e instanceof ProviderError ? e : new ProviderError("unavailable", "unexpected AI failure", { cause: e });
      if (pe.kind !== "budget" && pe.kind !== "disabled") this.lastFailure[args.provider] = Date.now();
      if (!deduplicated) await record("error", { model: args.model, retries: this.retryPolicy.attempts - 1, errorKind: pe.kind });
      throw pe;
    }
  }

  // ------------------------------------------------------------------ strategic decisions (TypeSafe)

  async decideFactions(requests: readonly DecisionRequest[], ctx: CallContext): Promise<FactionDecisionInput[]> {
    const mode = this.config.effective.strategy;
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), this.config.typesafe.turnDeadlineMs);
    try {
      return await Promise.all(requests.map((req) => this.decideOne(req, { ...ctx, signal: deadline.signal }, mode)));
    } finally {
      clearTimeout(timer);
    }
  }

  private async decideOne(req: DecisionRequest, ctx: CallContext, mode: AIConfig["effective"]["strategy"]): Promise<FactionDecisionInput> {
    const started = Date.now();
    const provider = mode === "live" ? this.deps.providers.decision.live : mode === "mock" ? this.deps.providers.decision.mock : this.deps.providers.decision.deterministic;
    const model = mode === "live" ? this.config.typesafe.model : mode === "mock" ? "mock-jev" : "deterministic-policy";
    const recordDecision = async (input: FactionDecisionInput, extra: { model: string; requestId: string | null; providerName: string }): Promise<void> => {
      await this.deps.recorder.recordDecision({
        gameId: ctx.gameId, turn: req.turn, factionId: req.factionId, stateHash: req.stateHash, provider: extra.providerName, model: extra.model,
        questionSchemaVersion: QUESTION_SCHEMA_VERSION, answer: input.answer, probability: input.answer?.strategicAction.probabilities[input.answer.strategicAction.choice] ?? null,
        confidence: input.answer?.strategicAction.confidence ?? null, fallbackUsed: input.answer === null, fallbackReason: input.fallbackReason,
        latencyMs: Date.now() - started, requestId: extra.requestId, correlationId: ctx.correlationId,
      }).catch((e: unknown) => this.deps.logger.error({ err: String(e) }, "ai.decision_record_failed"));
    };

    if (!provider || mode !== "live") {
      const r = await (provider ?? this.deps.providers.decision.deterministic).decide(req, ctx);
      const input: FactionDecisionInput = { factionId: req.factionId, answer: r.answer, fallbackReason: r.answer ? null : "deterministic_mode" };
      await recordDecision(input, { model: r.model, requestId: null, providerName: mode });
      return input;
    }
    try {
      let requestId: string | null = null;
      const out = await this.run({
        provider: "typesafe", operation: "faction_decision", model, promptId: FACTION_DECISION_PROMPT.promptId,
        promptVersion: FACTION_DECISION_PROMPT.promptVersion,
        cacheKey: cacheKeyFor("typesafe", model, FACTION_DECISION_PROMPT.promptId, FACTION_DECISION_PROMPT.promptVersion, { stateHash: req.stateHash, factionId: req.factionId }),
        budgetKind: "decision", timeoutMs: this.config.typesafe.timeoutMs + 500, ctx,
        call: async (signal) => {
          const r = await provider.decide(req, { ...ctx, signal });
          requestId = r.requestId;
          return { value: r.answer, usage: r.usage, model: r.model };
        },
      });
      const input: FactionDecisionInput = { factionId: req.factionId, answer: out.value, fallbackReason: out.value ? null : "empty_answer" };
      await recordDecision(input, { model: out.model, requestId, providerName: "typesafe" });
      return input;
    } catch (e) {
      const kind = e instanceof ProviderError ? e.kind : "unavailable";
      const input: FactionDecisionInput = { factionId: req.factionId, answer: null, fallbackReason: `typesafe_${kind}` };
      await recordDecision(input, { model, requestId: null, providerName: "typesafe" });
      return input;
    }
  }

  // ------------------------------------------------------------------ narrative (Gemini text)

  async generateText<T>(args: { prompt: PromptKey; input: string; facts: Record<string, unknown>; schema: z.ZodType<T>; ctx: CallContext; cachedContent?: string | null; semanticCheck?: (data: T) => string | null }): Promise<TextOutcome<T>> {
    const def = PROMPTS[args.prompt];
    const local = async (): Promise<TextOutcome<T>> => {
      const r = await this.deps.providers.text.local.generateStructured({ promptId: def.promptId, promptVersion: def.promptVersion, model: "local", system: def.system, prompt: args.input, schema: args.schema, facts: args.facts }, args.ctx);
      return { data: r.data, source: "local", model: r.model };
    };
    const live = this.deps.providers.text.live;
    if (this.config.effective.narrative !== "live" || !live) return local();
    const model = this.config.google.textModel;
    try {
      const out = await this.run({
        provider: "gemini", operation: def.promptId, model, promptId: def.promptId, promptVersion: def.promptVersion,
        cacheKey: cacheKeyFor("gemini", model, def.promptId, def.promptVersion, args.input), budgetKind: "text",
        timeoutMs: this.config.google.timeoutMs, ctx: args.ctx,
        call: async (signal) => {
          const r = await live.generateStructured({ promptId: def.promptId, promptVersion: def.promptVersion, model, system: def.system, prompt: args.input, schema: args.schema, facts: args.facts, cachedContent: args.cachedContent }, { ...args.ctx, signal });
          // Semantic validation (e.g. faction ids must exist, eventId must match): reject → retry.
          const problem = args.semanticCheck?.(r.data);
          if (problem) throw new ProviderError("malformed", `semantic validation failed: ${problem}`);
          return { value: r.data, usage: r.usage, model: r.model };
        },
      });
      return { data: out.value, source: "gemini", model: out.model };
    } catch {
      const fallback = await local();
      await this.deps.recorder.recordRequest({
        correlationId: args.ctx.correlationId, gameId: args.ctx.gameId, turn: args.ctx.turn, playerId: args.ctx.playerId, provider: "local",
        model: fallback.model, operation: def.promptId, promptId: def.promptId, promptVersion: def.promptVersion, cacheKey: "", status: "fallback",
        errorKind: null, latencyMs: 0, retryCount: 0, inputTokens: 0, outputTokens: 0,
      }).catch(() => {});
      return fallback;
    }
  }

  // ------------------------------------------------------------------ images (Gemini image)

  async generateImage(req: Omit<ImageRequest, "model">, ctx: CallContext, opts: { hero?: boolean } = {}): Promise<ImageOutcome> {
    const live = this.deps.providers.image.live;
    const model = opts.hero ? this.config.google.heroImageModel : this.config.google.imageModel;
    const promptHash = sha256Hex(`${model}|${req.promptId}@${req.promptVersion}|${req.aspectRatio}|${req.prompt}`);
    const local = async (): Promise<ImageOutcome> => {
      const r = await this.deps.providers.image.local.generateImage({ ...req, model: "procedural" }, ctx);
      return { ...r, source: "local", promptHash: sha256Hex(`local|${promptHash}`) };
    };
    if (this.config.effective.images !== "live" || !live) return local();
    try {
      const out = await this.run({
        provider: "gemini", operation: req.promptId, model, promptId: req.promptId, promptVersion: req.promptVersion, cacheKey: null,
        budgetKind: "image", timeoutMs: this.config.google.imageTimeoutMs, ctx,
        call: async (signal) => {
          const r = await live.generateImage({ ...req, model }, { ...ctx, signal });
          return { value: r, usage: { inputTokens: 0, outputTokens: 0 }, model: r.model };
        },
      });
      return { ...out.value, source: "gemini", promptHash };
    } catch {
      return local();
    }
  }
}
