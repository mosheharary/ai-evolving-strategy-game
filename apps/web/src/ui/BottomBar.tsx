"use client";

import { TECH_BY_ID } from "@echoes/game-engine";
import { BUILDINGS } from "@echoes/game-engine";
import { useGame, type Overlay } from "@/store/gameStore";

const OVERLAYS: { key: Exclude<Overlay, "none">; label: string; hot: string }[] = [
  { key: "territory", label: "Territory", hot: "1" },
  { key: "resources", label: "Resources", hot: "2" },
  { key: "movement", label: "Movement", hot: "3" },
  { key: "danger", label: "Danger", hot: "4" },
  { key: "diplomacy", label: "Diplomacy", hot: "5" },
];

export function BottomBar() {
  const view = useGame((s) => s.view)!;
  const overlay = useGame((s) => s.overlay);
  const setOverlay = useGame((s) => s.setOverlay);
  const openPanel = useGame((s) => s.openPanel);
  const endTurn = useGame((s) => s.endTurn);
  const endingTurn = useGame((s) => s.endingTurn);
  const buildMode = useGame((s) => s.buildMode);
  const setBuildMode = useGame((s) => s.setBuildMode);
  const player = view.state.factions.find((f) => f.id === "player")!;
  const current = player.research.current ? TECH_BY_ID.get(player.research.current) : null;
  const pendingProposals = view.state.proposals.filter((p) => p.to === "player").length;
  const gameOver = !!view.state.victory.winner;
  return (
    <nav className="panel bottombar" aria-label="Actions">
      {buildMode ? (
        <>
          <span style={{ fontSize: "0.85rem", padding: "0 0.4rem" }}>Placing <strong>{BUILDINGS[buildMode].name}</strong> — click a green tile</span>
          <button className="btn small" onClick={() => setBuildMode(null)}>Cancel <kbd>Esc</kbd></button>
          <div className="sep" />
        </>
      ) : (
        <>
          <button className="btn" onClick={() => openPanel("build")} data-testid="btn-build">Build <kbd>B</kbd></button>
          <button className="btn" onClick={() => openPanel("research")} data-testid="btn-research" title={current ? `Researching ${current.name}` : "Choose research"}>
            Research{current ? `: ${current.name} ${Math.round((player.research.progress / current.cost) * 100)}%` : " ⚠"} <kbd>R</kbd>
          </button>
          <button className="btn" onClick={() => openPanel("diplomacy")} data-testid="btn-diplomacy">
            Diplomacy{pendingProposals ? ` (${pendingProposals})` : ""} <kbd>T</kbd>
          </button>
          <div className="sep" />
        </>
      )}
      {OVERLAYS.map((o) => (
        <button key={o.key} className={`btn small ${overlay === o.key ? "active" : ""}`} aria-pressed={overlay === o.key} onClick={() => setOverlay(o.key)} title={`${o.label} overlay (${o.hot})`}>
          {o.label}
        </button>
      ))}
      <div className="sep" />
      <button className="btn primary endturn" disabled={endingTurn || gameOver} onClick={() => void endTurn()} data-testid="end-turn" title="End turn (Shift+Enter)">
        {endingTurn ? "Turning…" : `End Turn ${view.state.turn}`}
      </button>
    </nav>
  );
}
