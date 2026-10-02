/** Persistence/telemetry contracts implemented by the database layer. */

export type AIRequestStatus = "success" | "cache_hit" | "deduplicated" | "fallback" | "error";

export interface AIRequestRecord {
  correlationId: string;
  gameId: string;
  turn: number;
  playerId: string;
  provider: string;
  model: string;
  operation: string;
  promptId: string;
  promptVersion: number;
  cacheKey: string;
  status: AIRequestStatus;
  errorKind: string | null;
  latencyMs: number;
  retryCount: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AIDecisionRecord {
  gameId: string;
  turn: number;
  factionId: string;
  stateHash: string;
  provider: string;
  model: string;
  questionSchemaVersion: string;
  answer: unknown;
  probability: number | null;
  confidence: number | null;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  latencyMs: number;
  requestId: string | null;
  correlationId: string;
}

export interface AIRecorder {
  recordRequest(r: AIRequestRecord): Promise<void>;
  recordDecision(r: AIDecisionRecord): Promise<void>;
}

export interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export const nullRecorder: AIRecorder = { recordRequest: async () => {}, recordDecision: async () => {} };
export const consoleLogger: Logger = {
  info: (o, m) => console.log(JSON.stringify({ level: "info", msg: m, ...o })),
  warn: (o, m) => console.warn(JSON.stringify({ level: "warn", msg: m, ...o })),
  error: (o, m) => console.error(JSON.stringify({ level: "error", msg: m, ...o })),
};
