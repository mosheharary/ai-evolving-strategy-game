import { ProviderError } from "../providers/types";

export type CircuitState = "closed" | "open" | "half_open";

/**
 * Per-provider circuit breaker. After `failureThreshold` consecutive failures the
 * circuit opens and calls fail fast (→ fallback) until `cooldownMs` passes; then a
 * single trial call is allowed (half-open). Success closes it again.
 */
export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private openedAt = 0;
  private trialInFlight = false;

  constructor(
    readonly name: string,
    private readonly failureThreshold: number,
    private readonly cooldownMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  getState(): CircuitState {
    if (this.state === "open" && this.now() - this.openedAt >= this.cooldownMs) this.state = "half_open";
    return this.state;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const s = this.getState();
    if (s === "open") throw new ProviderError("circuit_open", `${this.name} circuit open`);
    if (s === "half_open") {
      if (this.trialInFlight) throw new ProviderError("circuit_open", `${this.name} circuit half-open (trial in flight)`);
      this.trialInFlight = true;
    }
    try {
      const v = await fn();
      this.failures = 0;
      this.state = "closed";
      return v;
    } catch (e) {
      // Caller mistakes (bad request, budget, disabled) do not indicate provider health.
      const countable = !(e instanceof ProviderError) || ["rate_limit", "timeout", "unavailable", "malformed"].includes(e.kind);
      if (countable) {
        this.failures += 1;
        if (this.state === "half_open" || this.failures >= this.failureThreshold) {
          this.state = "open";
          this.openedAt = this.now();
        }
      }
      throw e;
    } finally {
      if (s === "half_open") this.trialInFlight = false;
    }
  }
}
