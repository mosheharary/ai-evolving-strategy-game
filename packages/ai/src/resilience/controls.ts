import type { AIConfig } from "../config";
import { ProviderError } from "../providers/types";
import type { KeyValueStore } from "./store";

// ---------------------------------------------------------------- budgets

export interface BudgetScope {
  gameId: string;
  turn: number;
  playerId: string;
  kind: "text" | "decision" | "image";
}

/**
 * Per-turn, per-game and per-user (daily) AI budgets. Counters live in the shared
 * store so that multiple API/worker processes respect the same limits.
 */
export class BudgetManager {
  constructor(private readonly store: KeyValueStore, private readonly cfg: AIConfig["budgets"]) {}

  async consume(scope: BudgetScope): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    const checks: [string, number, number][] = [
      [`ai:budget:turn:${scope.gameId}:${scope.turn}`, scope.kind === "image" ? this.cfg.imagesPerTurn : this.cfg.perTurn, 3600],
      [`ai:budget:game:${scope.gameId}:${scope.kind === "image" ? "img" : "all"}`, scope.kind === "image" ? this.cfg.imagesPerGame : this.cfg.perGame, 60 * 60 * 24 * 90],
      [`ai:budget:user:${scope.playerId}:${day}`, this.cfg.perUserPerDay, 60 * 60 * 26],
    ];
    if (scope.kind === "image") checks[0]![0] = `ai:budget:turn:${scope.gameId}:${scope.turn}:img`;
    for (const [key, limit, ttl] of checks) {
      const n = await this.store.incr(key, ttl);
      if (n > limit) throw new ProviderError("budget", `AI budget exhausted (${key.split(":")[2]})`);
    }
  }
}

// ---------------------------------------------------------------- cache

export class ResponseCache {
  constructor(private readonly store: KeyValueStore, private readonly ttlSeconds = 60 * 60 * 24 * 30) {}

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.store.get(`ai:cache:${key}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.store.set(`ai:cache:${key}`, JSON.stringify(value), this.ttlSeconds);
  }
}

// ---------------------------------------------------------------- in-flight dedupe

/** Collapses concurrent identical requests into a single provider call. */
export class InFlightDeduper {
  private readonly inflight = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): { promise: Promise<T>; deduplicated: boolean } {
    const existing = this.inflight.get(key);
    if (existing) return { promise: existing as Promise<T>, deduplicated: true };
    const p = fn().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return { promise: p, deduplicated: false };
  }

  get size(): number {
    return this.inflight.size;
  }
}

// ---------------------------------------------------------------- queue

/** Concurrency-limited FIFO request queue for outbound AI calls. */
export class RequestQueue {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly concurrency: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }

  get pending(): number {
    return this.waiting.length;
  }
}

// ---------------------------------------------------------------- fault injection (developer controls)

export interface FaultFlags {
  disableGemini: boolean;
  disableTypeSafe: boolean;
  forceRateLimit: boolean;
  forceTimeout: boolean;
}

export const NO_FAULTS: FaultFlags = { disableGemini: false, disableTypeSafe: false, forceRateLimit: false, forceTimeout: false };

const FAULT_KEY = "ai:dev:faults";

/** Developer simulation controls stored in the shared store so every process sees them. */
export class FaultInjector {
  private cached: { at: number; flags: FaultFlags } | null = null;

  constructor(private readonly store: KeyValueStore, private readonly cacheMs = 1_000) {}

  async get(): Promise<FaultFlags> {
    if (this.cached && Date.now() - this.cached.at < this.cacheMs) return this.cached.flags;
    const raw = await this.store.get(FAULT_KEY);
    let flags = NO_FAULTS;
    if (raw) {
      try {
        flags = { ...NO_FAULTS, ...(JSON.parse(raw) as Partial<FaultFlags>) };
      } catch {
        flags = NO_FAULTS;
      }
    }
    this.cached = { at: Date.now(), flags };
    return flags;
  }

  async set(flags: Partial<FaultFlags>): Promise<FaultFlags> {
    const next = { ...(await this.get()), ...flags };
    await this.store.set(FAULT_KEY, JSON.stringify(next), 60 * 60 * 12);
    this.cached = { at: Date.now(), flags: next };
    return next;
  }

  /** Throws the simulated failure for a provider, if any. */
  async apply(provider: "gemini" | "typesafe"): Promise<void> {
    const f = await this.get();
    if (provider === "gemini" && f.disableGemini) throw new ProviderError("disabled", "Gemini disabled by developer controls");
    if (provider === "typesafe" && f.disableTypeSafe) throw new ProviderError("disabled", "TypeSafe disabled by developer controls");
    if (f.forceRateLimit) throw new ProviderError("rate_limit", "Simulated 429 rate limit", { status: 429 });
    if (f.forceTimeout) throw new ProviderError("timeout", "Simulated provider timeout");
  }
}
