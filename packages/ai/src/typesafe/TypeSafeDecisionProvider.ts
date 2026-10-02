import type { DecisionRequest, StrategicAnswer } from "@echoes/game-types";
import { StrategicAnswerSchema } from "@echoes/game-types";
import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  RateLimitError,
  TypeSafeClient,
  TypeSafeError,
  choice,
  noul,
  score,
  type Questions,
} from "@typesafe-ai/sdk";
import { z } from "zod";
import { ProviderError, type CallContext, type DecisionResult, type StrategicDecisionProvider } from "../providers/types";
import { ACTION_DESCRIPTIONS, STANCE_DESCRIPTIONS, buildQuestionSpec, type QuestionSpec } from "./questions";

/**
 * TypeSafeDecisionProvider — the strategic decision engine. Uses TypeSafe System One
 * (POST /v1/systemone via @typesafe-ai/sdk) with typed Choice / Score / Noul questions
 * over a reduced StrategicStateProjection. Never narrative, never images, never
 * authoritative — results become validated inputs to the engine's DecisionPolicy.
 */

const ChoiceResp = z.object({ type: z.literal("choice"), choice: z.string(), confidence: z.number().min(0).max(1), probabilities: z.record(z.string(), z.number().min(0).max(1)) });
const ScoreResp = z.object({ type: z.literal("score"), score: z.number(), confidence: z.number().min(0).max(1) });
const NoulResp = z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) });

export class TypeSafeDecisionProvider implements StrategicDecisionProvider {
  readonly name = "typesafe" as const;
  private readonly client: TypeSafeClient;

  constructor(opts: { apiKey: string; model: string; baseURL?: string; timeoutMs: number; fetch?: (input: string, init?: RequestInit) => Promise<Response> }) {
    this.client = new TypeSafeClient({
      apiKey: opts.apiKey,
      defaultModel: opts.model,
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
      timeout: opts.timeoutMs,
      // The AIOrchestrator owns retries/backoff so every provider shares one policy and retry counts are logged.
      retry: { maxRetries: 0 },
      logLevel: "off",
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
  }

  async decide(req: DecisionRequest, ctx: CallContext): Promise<DecisionResult> {
    const spec = buildQuestionSpec(req);
    const questions = toSdkQuestions(spec);
    let data;
    let requestId: string | null = null;
    try {
      const r = await this.client
        .systemOne({ state: { ...req.projection } as unknown as Record<string, never>, questions }, { signal: ctx.signal })
        .withResponse();
      data = r.data;
      requestId = r.requestId ?? null;
    } catch (e) {
      throw mapTypeSafeError(e);
    }
    const answer = toStrategicAnswer(req, spec, data.answers as Record<string, unknown>, data.model);
    return { answer, model: data.model, usage: { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens }, requestId };
  }
}

function toSdkQuestions(spec: QuestionSpec): Questions {
  const q: Questions = {};
  if (spec.strategicAction) q.strategicAction = choice(spec.strategicAction.instructions, Object.fromEntries(spec.strategicAction.options.map((o) => [o, ACTION_DESCRIPTIONS[o]])));
  if (spec.stance) q.diplomaticStance = choice(spec.stance.instructions, Object.fromEntries(spec.stance.options.map((o) => [o, STANCE_DESCRIPTIONS[o]])));
  q.threatLevel = score(spec.threatLevel, ["minimal", "low", "moderate", "high", "critical"]);
  q.foodUrgency = score(spec.foodUrgency, ["no concern", "minor", "noticeable", "serious", "famine imminent"]);
  q.shouldAttack = noul(spec.shouldAttack, { true: "Attacking now is strategically justified.", false: "Attacking now would be a mistake." });
  for (const p of spec.proposals) q[p.key] = noul(p.instructions, { true: "Accept the proposal.", false: "Reject the proposal." });
  return q;
}

/** Map raw System One answers to a StrategicAnswer, rejecting anything malformed. */
export function toStrategicAnswer(req: DecisionRequest, spec: QuestionSpec, answers: Record<string, unknown>, model: string): StrategicAnswer {
  const strategic = spec.strategicAction
    ? ChoiceResp.safeParse(answers.strategicAction)
    : { success: true as const, data: { type: "choice" as const, choice: req.candidates.strategicActions[0]!, confidence: 1, probabilities: { [req.candidates.strategicActions[0]!]: 1 } } };
  const stance = spec.stance ? ChoiceResp.safeParse(answers.diplomaticStance) : null;
  const threat = ScoreResp.safeParse(answers.threatLevel);
  const food = ScoreResp.safeParse(answers.foodUrgency);
  const attack = NoulResp.safeParse(answers.shouldAttack);
  if (!strategic.success || !threat.success || !food.success || !attack.success || (stance && !stance.success)) {
    throw new ProviderError("malformed", "TypeSafe answer failed schema validation");
  }
  const accept: Record<string, number> = {};
  for (const p of spec.proposals) {
    const a = NoulResp.safeParse(answers[p.key]);
    if (!a.success) throw new ProviderError("malformed", "TypeSafe proposal answer malformed");
    accept[p.proposalId] = a.data.noul;
  }
  const candidate = {
    factionId: req.factionId,
    strategicAction: { choice: strategic.data.choice, confidence: strategic.data.confidence, probabilities: strategic.data.probabilities },
    stance: stance?.success ? { choice: stance.data.choice, confidence: stance.data.confidence, probabilities: stance.data.probabilities } : null,
    threatLevel: { score: Math.max(0, Math.min(4, threat.data.score)), confidence: threat.data.confidence },
    foodUrgency: { score: Math.max(0, Math.min(4, food.data.score)), confidence: food.data.confidence },
    shouldAttack: { probability: attack.data.noul },
    acceptProposals: accept,
    provider: "typesafe" as const,
    model,
  };
  const parsed = StrategicAnswerSchema.safeParse(candidate);
  if (!parsed.success) throw new ProviderError("malformed", "TypeSafe answer outside the allowed action set");
  // Semantic validation: the chosen label must be one of the legal candidates we offered.
  if (!req.candidates.strategicActions.includes(parsed.data.strategicAction.choice)) throw new ProviderError("malformed", "TypeSafe chose an illegal action");
  if (parsed.data.stance && !req.candidates.stances.includes(parsed.data.stance.choice)) throw new ProviderError("malformed", "TypeSafe chose an illegal stance");
  return parsed.data;
}

export function mapTypeSafeError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof RateLimitError) return new ProviderError("rate_limit", "TypeSafe rate limited", { status: 429, retryAfterMs: e.retryAfterMs ?? null, cause: e });
  if (e instanceof APITimeoutError) return new ProviderError("timeout", "TypeSafe timed out", { cause: e });
  if (e instanceof APIUserAbortError) return new ProviderError("timeout", "TypeSafe request aborted", { cause: e });
  if (e instanceof APIConnectionError) return new ProviderError("unavailable", "TypeSafe connection failed", { cause: e });
  if (e instanceof APIError) {
    const s = e.status;
    if (s === 401 || s === 403) return new ProviderError("auth", `TypeSafe auth error ${s}`, { status: s, cause: e });
    if (s === 400 || s === 404 || s === 422) return new ProviderError("bad_request", `TypeSafe rejected request ${s}`, { status: s, cause: e });
    if (s === 408) return new ProviderError("timeout", `TypeSafe ${s}`, { status: s, cause: e });
    return new ProviderError("unavailable", `TypeSafe server error ${s}`, { status: s, cause: e });
  }
  if (e instanceof TypeSafeError) return new ProviderError("bad_request", "TypeSafe client error", { cause: e });
  return new ProviderError("unavailable", "TypeSafe request failed", { cause: e });
}
