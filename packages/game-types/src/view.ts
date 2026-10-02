import type { GameState } from "./state";

/** Presentation-only narrative attached to a game event, quest, faction or campaign. */
export interface NarrativeView {
  key: string;
  kind: "event" | "intro" | "quest" | "faction" | "summary" | "location" | "technology" | "era";
  title: string;
  body: string;
  tone: string;
  reactions: { factionId: string; text: string }[];
  source: "gemini" | "local";
  turn: number;
}

export interface AssetView {
  key: string;
  assetId: string;
  url: string;
  status: "ready" | "pending" | "failed";
  kind: string;
}

export type ProviderHealth = "online" | "degraded" | "offline" | "mock";

export interface AIStatusView {
  narrative: ProviderHealth;
  images: ProviderHealth;
  strategy: ProviderHealth;
  message: string | null;
}

/** Fog-filtered state sent to the browser. */
export type PlayerGameState = GameState;

export interface GameView {
  gameId: string;
  name: string;
  stateHash: string;
  state: PlayerGameState;
  narratives: Record<string, NarrativeView>;
  assets: Record<string, AssetView>;
  ai: AIStatusView;
}

export interface SaveSummary {
  saveId: string;
  gameId: string;
  name: string;
  civilizationName: string;
  seed: string;
  turn: number;
  era: number;
  schemaVersion: number;
  stateHash: string;
  autosave: boolean;
  createdAt: string;
}

export type ServerPush =
  | { type: "turn_completed"; gameId: string; turn: number }
  | { type: "faction_action"; gameId: string; turn: number; factionId: string; summary: string }
  | { type: "ai_decision"; gameId: string; turn: number; factionId: string; source: "ai" | "fallback" }
  | { type: "narrative_ready"; gameId: string; key: string }
  | { type: "image_ready"; gameId: string; key: string; assetId: string }
  | { type: "event_generated"; gameId: string; eventId: string }
  | { type: "ai_status"; gameId: string; status: AIStatusView };

/**
 * Stable presentation keys shared by server and client. Event keys include type and
 * turn so that a reloaded (diverging) timeline never shows another timeline's story.
 */
export const eventKey = (e: { id: string; type: string; turn: number }): string => `event:${e.id}-${e.type}-${e.turn}`;
export const factionAssetKey = (factionId: string, era: number): string => `faction:${factionId}:era${era}`;
export const techAssetKey = (techId: string): string => `tech:${techId}`;
export const heroAssetKey = (kind: "intro" | "era", era: number): string => (kind === "intro" ? "hero:intro" : `hero:era${era}`);
