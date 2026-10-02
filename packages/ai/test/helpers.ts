import { createGame, prepareTurn } from "@echoes/game-engine";
import type { DecisionRequest } from "@echoes/game-types";
import { z } from "zod";
import { AIOrchestrator, loadAIConfig, MemoryStore, type AIRecorder, type AIRequestRecord, type AIDecisionRecord, type StrategicDecisionProvider, type TextGenerationProvider, type ImageGenerationProvider, LocalTextProvider, LocalImageProvider, MockDecisionProvider, DeterministicDecisionProvider } from "../src";

export const ctx = { correlationId: "c1", gameId: "gtest", turn: 1, playerId: "p1" };

export class RecordingRecorder implements AIRecorder {
  requests: AIRequestRecord[] = [];
  decisions: AIDecisionRecord[] = [];
  async recordRequest(r: AIRequestRecord) { this.requests.push(r); }
  async recordDecision(r: AIDecisionRecord) { this.decisions.push(r); }
}

export const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

export function requests(): DecisionRequest[] {
  return prepareTurn(createGame({ gameId: "gtest", seed: "ai-tests", civilizationName: "Testers" })).requests;
}

export function liveConfig(overrides: Record<string, string> = {}) {
  return loadAIConfig({ AI_MODE: "live", GOOGLE_API_KEY: "test-google", TYPESAFE_API_KEY: "test-typesafe", TYPESAFE_TIMEOUT_MS: "200", GOOGLE_TIMEOUT_MS: "200", AI_CIRCUIT_FAILURES: "3", ...overrides });
}

export function orchestrator(opts: { text?: TextGenerationProvider | null; image?: ImageGenerationProvider | null; decision?: StrategicDecisionProvider | null; config?: ReturnType<typeof liveConfig>; store?: MemoryStore } = {}) {
  const recorder = new RecordingRecorder();
  const store = opts.store ?? new MemoryStore();
  const o = new AIOrchestrator({
    config: opts.config ?? liveConfig(), store, recorder, logger: silentLogger, sleep: async () => {},
    providers: {
      text: { live: opts.text ?? null, local: new LocalTextProvider() },
      image: { live: opts.image ?? null, local: new LocalImageProvider() },
      decision: { live: opts.decision ?? null, mock: new MockDecisionProvider(), deterministic: new DeterministicDecisionProvider() },
    },
  });
  return { o, recorder, store };
}

export const TinySchema = z.object({ eventId: z.string(), title: z.string().min(3) });
