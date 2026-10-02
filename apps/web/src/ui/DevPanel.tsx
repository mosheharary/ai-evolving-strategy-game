"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type DevFaults } from "@/lib/api";
import { useGame } from "@/store/gameStore";
import { Modal } from "./Modal";

interface Summary {
  windowHours: number;
  byProvider: { provider: string; status: string; count: number; avgLatencyMs: number; inputTokens: number; outputTokens: number }[];
  decisions: { total: number; fallback: number; avgLatencyMs: number };
  images: { generated: number; byModel: { model: string; count: number }[] };
  recentErrors: { createdAt: string; provider: string; operation: string; errorKind: string | null }[];
}

/**
 * Developer tools (internal API): AI failure simulation + telemetry. Shows metrics only —
 * no keys, prompts or provider internals ever reach the browser.
 */
export function DevPanel() {
  const openPanel = useGame((s) => s.openPanel);
  const gameId = useGame((s) => s.gameId)!;
  const view = useGame((s) => s.view)!;
  const toast = useGame((s) => s.toast);
  const [faults, setFaults] = useState<DevFaults | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [replay, setReplay] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const refresh = async (): Promise<void> => {
    try {
      const t = await api.devTelemetry();
      setFaults(t.faults);
      setSummary(t.summary as Summary);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setUnavailable(true);
    }
  };
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, []);

  const toggle = async (k: keyof DevFaults): Promise<void> => {
    if (!faults) return;
    const next = await api.setDevFaults({ [k]: !faults[k] });
    setFaults(next);
    toast("info", `${k} ${next[k] ? "enabled" : "disabled"} — the game continues on fallbacks.`);
  };

  const sum = (provider: string, status?: string): number => summary?.byProvider.filter((p) => p.provider === provider && (!status || p.status === status)).reduce((a, p) => a + p.count, 0) ?? 0;
  const latency = (provider: string): number => {
    const rows = summary?.byProvider.filter((p) => p.provider === provider && p.status === "success") ?? [];
    const n = rows.reduce((a, r) => a + r.count, 0);
    return n ? Math.round(rows.reduce((a, r) => a + r.avgLatencyMs * r.count, 0) / n) : 0;
  };
  const tokens = (provider: string): number => summary?.byProvider.filter((p) => p.provider === provider).reduce((a, p) => a + p.inputTokens + p.outputTokens, 0) ?? 0;

  return (
    <Modal title="AI status & developer tools" onClose={() => openPanel(null)} wide testId="dev-panel">
      <div className="row wrap" style={{ gap: "0.6rem", marginBottom: "0.6rem" }}>
        <span className="chip">Narrative: {view.ai.narrative}</span>
        <span className="chip">Images: {view.ai.images}</span>
        <span className="chip">Strategy: {view.ai.strategy}</span>
        {view.ai.message ? <span className="muted" style={{ fontSize: "0.85rem" }}>{view.ai.message}</span> : null}
      </div>
      {unavailable ? <p className="muted">Developer tools are disabled on this server (DEV_TOOLS_ENABLED=false).</p> : (
        <>
          <h3>Failure simulation</h3>
          <div className="row wrap">
            {faults ? (["disableGemini", "disableTypeSafe", "forceRateLimit", "forceTimeout"] as const).map((k) => (
              <button key={k} className={`btn small ${faults[k] ? "active" : ""}`} aria-pressed={faults[k]} onClick={() => void toggle(k)} data-testid={`fault-${k}`}>
                {k === "disableGemini" ? "Disable Gemini" : k === "disableTypeSafe" ? "Disable TypeSafe" : k === "forceRateLimit" ? "Force rate limit (429)" : "Force timeout"}
              </button>
            )) : <span className="faint">loading…</span>}
          </div>
          <h3 style={{ marginTop: "0.9rem" }}>Telemetry (last {summary?.windowHours ?? 24}h)</h3>
          <dl className="stat-grid" style={{ maxWidth: 520 }}>
            <dt>Gemini requests / failures</dt><dd>{sum("gemini")} / {sum("gemini", "error")}</dd>
            <dt>Gemini latency (avg success)</dt><dd>{latency("gemini")} ms</dd>
            <dt>Gemini tokens</dt><dd>{tokens("gemini")}</dd>
            <dt>TypeSafe calls / failures</dt><dd>{sum("typesafe")} / {sum("typesafe", "error")}</dd>
            <dt>TypeSafe latency (avg success)</dt><dd>{latency("typesafe")} ms</dd>
            <dt>Faction decisions / fallbacks</dt><dd>{summary?.decisions.total ?? 0} / {summary?.decisions.fallback ?? 0}</dd>
            <dt>Local fallback narratives</dt><dd>{sum("local", "fallback")}</dd>
            <dt>Cache hits</dt><dd>{summary?.byProvider.filter((p) => p.status === "cache_hit").reduce((a, p) => a + p.count, 0) ?? 0}</dd>
            <dt>Images generated</dt><dd>{summary?.images.generated ?? 0} {summary?.images.byModel.map((m) => `(${m.model}: ${m.count})`).join(" ")}</dd>
          </dl>
          {summary?.recentErrors.length ? (
            <>
              <h3 style={{ marginTop: "0.9rem" }}>Recent errors</h3>
              <ul className="faint" style={{ fontSize: "0.78rem", margin: 0 }}>
                {summary.recentErrors.slice(0, 8).map((e, i) => <li key={i}>{new Date(e.createdAt).toLocaleTimeString()} · {e.provider} · {e.operation} · {e.errorKind}</li>)}
              </ul>
            </>
          ) : null}
          <h3 style={{ marginTop: "0.9rem" }}>Determinism</h3>
          <div className="row">
            <button className="btn small" onClick={async () => { const r = await api.replayVerify(gameId); setReplay(`${r.ok ? "✓ identical" : "✗ MISMATCH"} — replayed ${r.commands} commands from ${r.root} snapshot using stored AI decisions · ${r.actual.slice(0, 16)}`); }} data-testid="replay-verify">Verify replay</button>
            {replay ? <span style={{ fontSize: "0.82rem" }} data-testid="replay-result">{replay}</span> : null}
          </div>
          <p className="faint" style={{ fontSize: "0.75rem" }}>State hash {view.stateHash}</p>
        </>
      )}
    </Modal>
  );
}
