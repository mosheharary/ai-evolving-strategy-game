"use client";

import Link from "next/link";
import { useGame } from "@/store/gameStore";

const LABEL: Record<string, string> = {
  dominion: "Dominion Victory", prosperity: "Prosperity Victory", ascension: "Scientific Ascension", restoration: "Ecological Restoration",
  federation: "Diplomatic Federation", legacy: "The Age Ends — Legacy", defeat: "Your Civilization Has Fallen",
};

export function VictoryBanner() {
  const view = useGame((s) => s.view);
  const openPanel = useGame((s) => s.openPanel);
  const w = view?.state.victory.winner;
  if (!view || !w) return null;
  return (
    <div className="panel" style={{ position: "absolute", top: 120, left: "50%", transform: "translateX(-50%)", padding: "1rem 1.4rem", textAlign: "center", zIndex: 20 }} role="status">
      <h2 style={{ fontFamily: "var(--serif)", margin: 0, color: w.type === "defeat" ? "var(--danger)" : "var(--accent)" }}>{LABEL[w.type] ?? w.type}</h2>
      <p className="muted" style={{ margin: "0.4rem 0 0.8rem" }}>Year {w.turn}. The frontier will remember {view.state.civilizationName}.</p>
      <div className="row" style={{ justifyContent: "center" }}>
        <button className="btn" onClick={() => openPanel("history")}>Read the chronicle</button>
        <Link className="btn primary" href="/">New campaign</Link>
      </div>
    </div>
  );
}
