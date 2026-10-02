import { ProviderError } from "../providers/types";

export interface RetryPolicy {
  /** Total attempts including the first. */
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** 0..1 — fraction of each delay randomised ("full jitter" on that fraction). */
  jitter: number;
}

export const DEFAULT_RETRY: RetryPolicy = { attempts: 3, baseDelayMs: 300, maxDelayMs: 4_000, jitter: 0.3 };

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export const sleep: Sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ProviderError("timeout", "aborted"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new ProviderError("timeout", "aborted"));
    }, { once: true });
  });

/** Exponential backoff with jitter: attempt 1 → immediate, attempt 2 → base, attempt 3 → base·4 … */
export function backoffDelay(attempt: number, p: RetryPolicy, random: () => number = Math.random): number {
  if (attempt <= 1) return 0;
  const exp = Math.min(p.maxDelayMs, p.baseDelayMs * 4 ** (attempt - 2));
  const jitterPart = exp * p.jitter;
  return Math.round(exp - jitterPart + random() * jitterPart * 2);
}

export interface RetryOutcome<T> {
  value: T;
  retries: number;
}

/**
 * Retry transient failures (429 / 5xx / timeout / malformed output) a bounded
 * number of times. Non-retryable errors (auth, bad request, budget, disabled)
 * fail immediately. Never retries forever.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY,
  opts: { sleep?: Sleep; signal?: AbortSignal; random?: () => number; onRetry?: (err: ProviderError, attempt: number) => void } = {},
): Promise<RetryOutcome<T>> {
  const doSleep = opts.sleep ?? sleep;
  let lastError: unknown;
  for (let attempt = 1; attempt <= policy.attempts; attempt++) {
    try {
      const delay = backoffDelay(attempt, policy, opts.random);
      if (delay > 0) await doSleep(delay, opts.signal);
      return { value: await fn(attempt), retries: attempt - 1 };
    } catch (e) {
      lastError = e;
      const pe = e instanceof ProviderError ? e : new ProviderError("unavailable", e instanceof Error ? e.message : String(e), { cause: e });
      if (!pe.retryable || attempt === policy.attempts || opts.signal?.aborted) throw pe;
      opts.onRetry?.(pe, attempt);
      if (pe.retryAfterMs && pe.retryAfterMs > 0) await doSleep(Math.min(pe.retryAfterMs, policy.maxDelayMs), opts.signal);
    }
  }
  throw lastError;
}

export async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  parent?.addEventListener("abort", onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ProviderError("timeout", `timed out after ${ms}ms`));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    parent?.removeEventListener("abort", onAbort);
  }
}
