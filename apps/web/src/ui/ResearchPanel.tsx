"use client";

import { techAssetKey } from "@echoes/game-types";
import { canResearch, computeFactionEconomy, TECHS, type TechBranch } from "@echoes/game-engine";
import { useMemo } from "react";
import { api } from "@/lib/api";
import { useGame } from "@/store/gameStore";
import { Modal } from "./Modal";

const BRANCHES: TechBranch[] = ["agriculture", "industry", "society", "science", "ecology", "military"];

export function ResearchPanel() {
  const view = useGame((s) => s.view)!;
  const gameId = useGame((s) => s.gameId)!;
  const openPanel = useGame((s) => s.openPanel);
  const send = useGame((s) => s.send);
  const busy = useGame((s) => s.busy);
  const state = view.state;
  const player = state.factions.find((f) => f.id === "player")!;
  const econ = useMemo(() => computeFactionEconomy(state, "player"), [state]);
  const known = new Set(player.research.known);
  const perTurn = Math.max(0.1, econ.net.knowledge);
  return (
    <Modal title="Technology" onClose={() => openPanel(null)} wide testId="research-panel">
      <p className="muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
        Knowledge: {Math.round(player.resources.knowledge)} banked, {econ.net.knowledge.toFixed(1)}/turn. Every technology changes the simulation — yields, pollution, diplomacy or warfare.
      </p>
      <div className="tech-grid">
        {BRANCHES.map((branch) => (
          <div key={branch} className="col" style={{ gap: "0.45rem" }}>
            <h3 style={{ textTransform: "capitalize" }}>{branch}</h3>
            {TECHS.filter((t) => t.branch === branch).sort((a, b) => a.era - b.era || a.cost - b.cost).map((t) => {
              const isKnown = known.has(t.id);
              const isCurrent = player.research.current === t.id;
              const err = isKnown ? null : canResearch(state, "player", t.id);
              const asset = view.assets[techAssetKey(t.id)];
              const remaining = isCurrent ? t.cost - player.research.progress : t.cost;
              return (
                <button
                  key={t.id}
                  className={`tech ${isKnown ? "known" : isCurrent ? "current" : err ? "locked" : ""}`}
                  disabled={busy || isKnown || !!err}
                  title={err ?? t.description}
                  onClick={() => void send({ type: "RESEARCH_TECH", payload: { techId: t.id } }).then((ok) => ok && openPanel(null))}
                  onMouseEnter={() => { if (isKnown && !asset) void api.requestAsset(gameId, { kind: "technology", techId: t.id }).catch(() => {}); }}
                  data-testid={`tech-${t.id}`}
                >
                  {isKnown && asset ? <img className="thumb" src={asset.url} alt="" style={{ aspectRatio: "1/1", marginBottom: 4 }} /> : null}
                  <div className="name">{t.name}</div>
                  <div className="faint">Era {t.era} · {t.cost} 📜{!isKnown ? ` · ~${Math.ceil(Math.max(0, remaining - (isCurrent ? 0 : player.resources.knowledge)) / perTurn)}t` : ""}</div>
                  <div className="muted" style={{ marginTop: 3, lineHeight: 1.35 }}>{t.description}</div>
                  {isCurrent ? <div className="bar" style={{ marginTop: 4 }}><span style={{ width: `${(player.research.progress / t.cost) * 100}%` }} /></div> : null}
                  {isKnown ? <div style={{ color: "var(--ok)", marginTop: 3 }}>✓ Known</div> : err && !isCurrent ? <div className="faint" style={{ marginTop: 3 }}>{err}</div> : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </Modal>
  );
}
