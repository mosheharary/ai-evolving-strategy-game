"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useGame } from "@/store/gameStore";
import { Modal } from "./Modal";

type Entry = { turn: number; type: string; importance: number; summary: string };

/** The chronicle: persisted long-term history + the compressed AI campaign summary. */
export function HistoryPanel() {
  const view = useGame((s) => s.view)!;
  const gameId = useGame((s) => s.gameId)!;
  const openPanel = useGame((s) => s.openPanel);
  const toast = useGame((s) => s.toast);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [filter, setFilter] = useState<1 | 2 | 3>(2);
  useEffect(() => {
    void api.history(gameId).then((h) => setEntries(h.persisted)).catch(() => setEntries(view.state.history));
  }, [gameId, view.state.turn]); // eslint-disable-line react-hooks/exhaustive-deps
  const summary = view.narratives.summary;
  const byTurn = new Map<number, Entry[]>();
  for (const e of entries.filter((x) => x.importance >= filter)) byTurn.set(e.turn, [...(byTurn.get(e.turn) ?? []), e]);
  const trends = view.state.trends.slice(-20);
  const maxPop = Math.max(1, ...trends.map((t) => t.population));
  return (
    <Modal title="History of the Frontier" onClose={() => openPanel(null)} wide testId="history-panel">
      <div className="row" style={{ alignItems: "flex-start", gap: "1.2rem" }}>
        <div className="col grow" style={{ minWidth: 0 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>Chronicle</h3>
            <div className="row">
              {([3, 2, 1] as const).map((lvl) => (
                <button key={lvl} className={`btn small ${filter === lvl ? "active" : ""}`} onClick={() => setFilter(lvl)}>{lvl === 3 ? "Epochal" : lvl === 2 ? "Notable" : "All"}</button>
              ))}
            </div>
          </div>
          <div className="col scroll" style={{ maxHeight: "60vh" }}>
            {[...byTurn.entries()].sort((a, b) => b[0] - a[0]).map(([turn, list]) => (
              <div key={turn}>
                <div className="faint" style={{ fontSize: "0.75rem", letterSpacing: "0.12em" }}>YEAR {turn}</div>
                {list.map((e, i) => (
                  <p key={i} style={{ margin: "0.15rem 0 0.4rem", fontFamily: e.importance >= 3 ? "var(--serif)" : undefined, fontSize: e.importance >= 3 ? "1rem" : "0.86rem", color: e.importance >= 3 ? "var(--text)" : "var(--muted)" }}>
                    {e.summary}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="col" style={{ width: 340, flexShrink: 0 }}>
          <h3 style={{ margin: 0 }}>Campaign summary</h3>
          {summary ? <div className="prose card" style={{ fontSize: "0.9rem" }}>{summary.body}</div> : <p className="faint">No summary yet — one is written every ten years and at each new era.</p>}
          <button className="btn small" onClick={() => void api.requestSummary(gameId).then(() => toast("info", "The chroniclers are summarising your campaign…")).catch(() => toast("error", "Could not request a summary."))}>Rewrite summary</button>
          <h3 style={{ margin: "0.6rem 0 0" }}>Trends</h3>
          <div className="row" style={{ alignItems: "flex-end", gap: 3, height: 70 }} aria-label="Population trend">
            {trends.map((t) => <div key={t.turn} title={`Year ${t.turn}: pop ${t.population}, pollution ${t.pollution}`} style={{ flex: 1, height: `${(t.population / maxPop) * 100}%`, background: "var(--accent-2)", borderRadius: 2, opacity: 0.8 }} />)}
          </div>
          <div className="faint" style={{ fontSize: "0.75rem" }}>
            World: rainfall {Math.round(view.state.world.rainfall * 100)}%, warming {view.state.world.warming.toFixed(2)}, pollution {view.state.world.globalPollution.toFixed(1)}, forest cover {Math.round(view.state.world.forestCover * 100)}%
          </div>
        </div>
      </div>
    </Modal>
  );
}
