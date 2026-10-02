import type { GameState } from "@echoes/game-types";
import { hashObject } from "@echoes/shared";

/**
 * Canonical state hash: sha256 over the canonical JSON (sorted keys) of the full
 * authoritative state. Identical states always hash identically; used for
 * replay verification, save validation and debugging.
 */
export function calculateStateHash(state: GameState): string {
  return hashObject(state);
}
