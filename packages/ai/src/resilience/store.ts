/**
 * Minimal key-value contract the AI layer needs for budgets, caching and fault
 * flags. Production uses Redis (apps/api); tests use the in-memory store.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  /** Atomically increment and return the new value, setting TTL on first write. */
  incr(key: string, ttlSeconds: number): Promise<number>;
  del(key: string): Promise<void>;
}

export class MemoryStore implements KeyValueStore {
  private readonly data = new Map<string, { value: string; expires: number | null }>();
  constructor(private readonly now: () => number = () => Date.now()) {}

  private live(key: string): { value: string; expires: number | null } | null {
    const v = this.data.get(key);
    if (!v) return null;
    if (v.expires !== null && v.expires <= this.now()) {
      this.data.delete(key);
      return null;
    }
    return v;
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.data.set(key, { value, expires: ttlSeconds ? this.now() + ttlSeconds * 1000 : null });
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const cur = this.live(key);
    const n = (cur ? Number(cur.value) : 0) + 1;
    this.data.set(key, { value: String(n), expires: cur?.expires ?? this.now() + ttlSeconds * 1000 });
    return n;
  }

  async del(key: string): Promise<void> {
    this.data.delete(key);
  }
}
