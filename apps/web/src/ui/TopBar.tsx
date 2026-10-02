"use client";

import { RESOURCE_TYPES } from "@echoes/game-types";
import { computeFactionEconomy, ERA_NAMES } from "@echoes/game-engine";
import { useMemo } from "react";
import { useGame } from "@/store/gameStore";
import { fmt, RESOURCE_META, signed } from "./format";

export function TopBar() {
  const view = useGame((s) => s.view)!;
  const openPanel = useGame((s) => s.openPanel);
  const state = view.state;
  const player = state.factions.find((f) => f.id === "player")!;
  const econ = useMemo(() => computeFactionEconomy(state, "player"), [state]);
  const ai = view.ai;
  const aiTitle = `Narrative: ${ai.narrative} · Images: ${ai.images} · Strategy: ${ai.strategy}${ai.message ? ` — ${ai.message}` : ""}`;
  const worst = [ai.strategy, ai.narrative].includes("offline") ? "offline" : [ai.strategy, ai.narrative].includes("degraded") ? "degraded" : ai.strategy === "mock" && ai.narrative === "mock" ? "mock" : "online";

  return (
    <header className="panel topbar" aria-label="Resources">
      {RESOURCE_TYPES.map((r) => {
        const net = econ.net[r];
        const meta = RESOURCE_META[r];
        const tip = `${meta.label}: ${fmt(player.resources[r])} / ${fmt(econ.storageCap[r])} — income ${econ.income[r].toFixed(1)}, upkeep ${econ.upkeep[r].toFixed(1)}${econ.trade[r] ? `, trade ${econ.trade[r].toFixed(1)}` : ""}`;
        return (
          <div key={r} className="res" title={tip} aria-label={tip} data-testid={`res-${r}`}>
            <span className="icon" aria-hidden="true">{meta.icon}</span>
            <span className="val">{fmt(player.resources[r])}</span>
            <span className={`delta ${net > 0 ? "pos" : net < 0 ? "neg" : ""}`}>{signed(net)}</span>
          </div>
        );
      })}
      <div className="turnbadge" aria-label={`Year ${state.turn}, Era ${state.era}`}>
        Year <strong data-testid="turn">{state.turn}</strong> · Era {state.era} <span className="muted">{ERA_NAMES[state.era - 1]}</span>
      </div>
      <button className="btn small" title={aiTitle} aria-label={aiTitle} onClick={() => openPanel("dev")}>
        <span className={`ai-dot ${worst}`} /> AI
      </button>
      <button className="btn small" onClick={() => openPanel("saves")} data-testid="open-saves">Saves</button>
      <button className="btn small" onClick={() => openPanel("history")}>History <kbd>H</kbd></button>
      <button className="btn small" onClick={() => openPanel("settings")} aria-label="Settings">⚙</button>
    </header>
  );
}
