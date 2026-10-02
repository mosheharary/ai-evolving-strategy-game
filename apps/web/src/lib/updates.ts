"use client";

import type { ServerPush } from "@echoes/game-types";
import { useGame } from "@/store/gameStore";
import { api } from "./api";

/**
 * Server → browser updates via Server-Sent Events, with an automatic polling
 * fallback when SSE is unavailable (proxies, older browsers, network hiccups).
 */
export function connectUpdates(gameId: string): () => void {
  let es: EventSource | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  let failures = 0;

  const startPolling = (): void => {
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
      const { view } = useGame.getState();
      if (!view) return;
      try {
        const ev = await api.events(gameId, Math.max(1, view.state.turn - 30));
        const cur = useGame.getState().view;
        if (cur) useGame.setState({ view: { ...cur, narratives: ev.narratives, assets: ev.assets, ai: ev.ai } });
      } catch {
        /* keep polling */
      }
    }, 8_000);
  };

  const open = (): void => {
    if (closed || typeof EventSource === "undefined") {
      startPolling();
      return;
    }
    es = new EventSource(`/api/games/${gameId}/stream`, { withCredentials: true });
    es.onmessage = (m) => {
      failures = 0;
      try {
        useGame.getState().onPush(JSON.parse(m.data) as ServerPush);
      } catch {
        /* ignore malformed push */
      }
    };
    es.onerror = () => {
      failures++;
      if (failures >= 3) {
        es?.close();
        es = null;
        startPolling();
        // Try SSE again later.
        setTimeout(() => {
          if (!closed && !es) {
            failures = 0;
            open();
          }
        }, 60_000);
      }
    };
  };

  open();
  startPolling(); // light polling always runs as a safety net
  return () => {
    closed = true;
    es?.close();
    if (pollTimer) clearInterval(pollTimer);
  };
}
