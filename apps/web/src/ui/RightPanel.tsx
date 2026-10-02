"use client";

import { eventKey, VICTORY_TYPES } from "@echoes/game-types";
import { useState } from "react";
import { useGame } from "@/store/gameStore";
import { factionName, relationOf, titleCase } from "./format";

const VICTORY_LABEL: Record<string, string> = {
  dominion: "Dominion", prosperity: "Prosperity", ascension: "Scientific Ascension", restoration: "Ecological Restoration", federation: "Diplomatic Federation",
};

export function RightPanel() {
  const [tab, setTab] = useState<"objectives" | "events" | "factions">("objectives");
  const [collapsed, setCollapsed] = useState(false);
  const view = useGame((s) => s.view)!;
  const focusTile = useGame((s) => s.focusTile);
  const openPanel = useGame((s) => s.openPanel);
  const state = view.state;
  if (collapsed) {
    return <button className="btn panel" style={{ position: "absolute", top: 72, right: 12 }} onClick={() => setCollapsed(false)} aria-label="Show side panel">☰</button>;
  }
  const quests = state.quests.filter((q) => q.status === "active");
  const events = [...state.events].sort((a, b) => b.turn - a.turn || b.severity - a.severity).slice(0, 14);
  return (
    <aside className="panel right-panel" aria-label="Objectives, events and factions">
      <div className="tabs" role="tablist">
        {(["objectives", "events", "factions"] as const).map((t) => (
          <button key={t} role="tab" className="tab" aria-selected={tab === t} onClick={() => setTab(t)} data-testid={`tab-${t}`}>{titleCase(t)}</button>
        ))}
        <button className="tab" style={{ flex: "0 0 auto" }} onClick={() => setCollapsed(true)} aria-label="Collapse side panel">›</button>
      </div>
      <div className="tab-body">
        {tab === "objectives" && (
          <div className="card-list">
            {quests.length === 0 ? <p className="faint" style={{ fontSize: "0.85rem" }}>No active quests. Explore and the frontier will call on you.</p> : null}
            {quests.map((q) => {
              const n = view.narratives[`quest:${q.id}`];
              return (
                <button key={q.id} className="card clickable" onClick={() => q.tile !== null && focusTile(q.tile, 20)} data-testid="quest">
                  <div className="title">{n?.title ?? q.title}</div>
                  <div className="muted" style={{ fontSize: "0.8rem", lineHeight: 1.45 }}>{n?.body.split("\n\n")[0] ?? q.description}</div>
                  <div className="faint" style={{ fontSize: "0.75rem", marginTop: 4 }}>
                    Reward: {Object.entries(q.rewards).map(([k, v]) => `${v} ${k}`).join(", ")} · {q.expiresTurn - state.turn} turns left
                  </div>
                </button>
              );
            })}
            <h3 style={{ marginTop: "0.6rem" }}>Paths to Victory</h3>
            {VICTORY_TYPES.map((v) => (
              <div key={v}>
                <div className="row" style={{ fontSize: "0.8rem", justifyContent: "space-between" }}><span>{VICTORY_LABEL[v]}</span><span className="faint">{Math.round(state.victory.progress[v] * 100)}%</span></div>
                <div className="bar"><span style={{ width: `${state.victory.progress[v] * 100}%` }} /></div>
              </div>
            ))}
            <p className="faint" style={{ fontSize: "0.75rem" }}>Year {state.turn} of {state.config.maxTurns}.</p>
          </div>
        )}
        {tab === "events" && (
          <div className="card-list">
            {events.length === 0 ? <p className="faint" style={{ fontSize: "0.85rem" }}>The frontier is quiet… for now.</p> : null}
            {events.map((e) => {
              const n = view.narratives[eventKey(e)];
              const asset = view.assets[eventKey(e)];
              return (
                <button key={e.id} className="card clickable" onClick={() => { focusTile(e.centerTile, 22); useGame.setState({ eventQueue: [e.id] }); }} data-testid="event-card">
                  {asset ? <img className="thumb" src={asset.url} alt={`Illustration: ${n?.title ?? e.type}`} loading="lazy" style={{ marginBottom: 6 }} /> : null}
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="title">{n?.title ?? titleCase(e.type)}</span>
                    <span className="chip">{e.status === "active" ? `${e.endsTurn - state.turn}t` : `Y${e.turn}`}</span>
                  </div>
                  <div className="muted" style={{ fontSize: "0.78rem", lineHeight: 1.45 }}>{e.region}{e.major ? " · major" : ""}</div>
                  <div className="faint" style={{ fontSize: "0.76rem" }}>{e.consequences[0]}</div>
                </button>
              );
            })}
            <button className="btn small" onClick={() => openPanel("history")}>Full chronicle</button>
          </div>
        )}
        {tab === "factions" && (
          <div className="card-list">
            {state.factions.filter((f) => f.kind === "ai").map((f) => {
              const rel = relationOf(state, "player", f.id);
              const op = Math.round(f.opinions.player ?? 0);
              const d = state.lastDecisions[f.id];
              const home = state.settlements.find((s) => s.ownerId === f.id);
              return (
                <button key={f.id} className="card clickable" onClick={() => { if (home) focusTile(home.tile, 24); openPanel("diplomacy"); }} style={{ opacity: f.alive ? 1 : 0.5 }} data-testid={`faction-${f.id}`}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="title" style={{ color: f.color }}>{f.name}</span>
                    <span className={`chip ${rel?.status === "war" ? "war" : rel?.status === "alliance" ? "alliance" : ""}`}>{f.alive ? rel?.status ?? "peace" : "fallen"}</span>
                  </div>
                  <div className="faint" style={{ fontSize: "0.75rem" }}>{titleCase(f.archetype)} · {state.settlements.filter((s) => s.ownerId === f.id).length} settlements · opinion {op > 0 ? "+" : ""}{op}{rel?.trade ? " · trading" : ""}</div>
                  <div className="bar" style={{ marginTop: 4 }}><span style={{ width: `${(op + 100) / 2}%`, background: op < -20 ? "var(--danger)" : op > 20 ? "var(--ok)" : "var(--accent)" }} /></div>
                  {d ? (
                    <div className="faint" style={{ fontSize: "0.72rem", marginTop: 4 }}>
                      Last turn: {d.action}{d.mode === "conservative" ? " (cautious)" : ""} · <span className={`chip ${d.source === "ai" ? "ai" : ""}`}>{d.source === "ai" ? `AI ${Math.round(d.confidence * 100)}%` : "fallback"}</span>
                    </div>
                  ) : null}
                </button>
              );
            })}
            <p className="faint" style={{ fontSize: "0.72rem" }}>{factionName(state, "player")} is the last of the old world.</p>
          </div>
        )}
      </div>
    </aside>
  );
}
