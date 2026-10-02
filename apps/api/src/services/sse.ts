import type { Redis } from "ioredis";
import { gameChannel } from "@echoes/platform";

type Listener = (data: string) => void;

/**
 * Fan-out hub: one Redis subscriber per API process, many SSE clients. Updates
 * published by the API itself or by the worker (narrative/image ready) reach every
 * connected browser for that game. Clients also poll as a fallback.
 */
export class UpdateHub {
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(private readonly sub: Redis) {
    sub.on("message", (channel: string, message: string) => {
      const gameId = channel.slice("game-updates:".length);
      for (const l of this.listeners.get(gameId) ?? []) l(message);
    });
  }

  async subscribe(gameId: string, l: Listener): Promise<() => Promise<void>> {
    let set = this.listeners.get(gameId);
    if (!set) {
      set = new Set();
      this.listeners.set(gameId, set);
      await this.sub.subscribe(gameChannel(gameId));
    }
    set.add(l);
    return async () => {
      set!.delete(l);
      if (set!.size === 0) {
        this.listeners.delete(gameId);
        await this.sub.unsubscribe(gameChannel(gameId)).catch(() => {});
      }
    };
  }

  get connections(): number {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }
}
