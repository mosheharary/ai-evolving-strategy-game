import type { GameState } from "@echoes/game-types";
import { sha256Hex } from "@echoes/shared";
import type { AIConfig } from "../config";
import { PROMPTS } from "../narrative/prompts";
import type { KeyValueStore } from "../resilience/store";
import type { Logger } from "../telemetry";
import type { GoogleAIService } from "./GoogleAIService";

/** Below this size explicit caching costs more than it saves (Gemini has a minimum cacheable token count). */
const MIN_CACHE_CHARS = 16_000;
const TTL_SECONDS = 60 * 60;

/**
 * Gemini explicit context caching for large, stable, repeatedly-sent context:
 * permanent faction lore + game rules + the long campaign summary. Disabled by
 * default (GOOGLE_CONTEXT_CACHE=true to enable); never created for small prompts.
 */
export class ContextCacheManager {
  constructor(
    private readonly google: GoogleAIService | null,
    private readonly config: AIConfig,
    private readonly store: KeyValueStore,
    private readonly logger: Logger,
  ) {}

  static loreBundle(state: GameState, campaignSummary: string | null): string {
    const factions = state.factions.map((f) => `## ${f.name} (${f.archetype})\n${f.identity}\nVisual identity: ${f.visualIdentity}`).join("\n\n");
    return [
      "# Echoes of the Frontier — permanent campaign context",
      `Civilization: ${state.civilizationName}. World seed ${state.seed}.`,
      "Game rules: the deterministic game engine decides all mechanics; narrative only describes engine facts.",
      factions,
      campaignSummary ? `# Campaign so far\n${campaignSummary}` : "",
    ].join("\n\n");
  }

  /** Returns a cachedContent name for the event-narrative prompt, or null when caching is not worthwhile. */
  async getEventNarrativeCache(gameId: string, content: string): Promise<string | null> {
    if (!this.google || !this.config.google.contextCache || this.config.effective.narrative !== "live") return null;
    if (content.length < MIN_CACHE_CHARS) return null;
    const hash = sha256Hex(`${this.config.google.textModel}|${PROMPTS.event_narrative.promptVersion}|${content}`);
    const key = `ai:ctxcache:${gameId}:${hash}`;
    const existing = await this.store.get(key);
    if (existing) return existing;
    try {
      const name = await this.google.createContextCache({
        model: this.config.google.textModel, system: PROMPTS.event_narrative.system, content, ttlSeconds: TTL_SECONDS, displayName: `echoes-${gameId}`.slice(0, 60),
      });
      await this.store.set(key, name, TTL_SECONDS - 60);
      return name;
    } catch (e) {
      this.logger.warn({ gameId, err: e instanceof Error ? e.message : "cache failed" }, "ai.context_cache_failed");
      return null;
    }
  }
}
