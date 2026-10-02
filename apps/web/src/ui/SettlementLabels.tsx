"use client";

import { labelElements } from "@/three/labelRegistry";
import { useGame } from "@/store/gameStore";

/** Accessible DOM name plates for settlements; positioned by the 3D scene each frame. */
export function SettlementLabels() {
  const view = useGame((s) => s.view);
  const select = useGame((s) => s.select);
  if (!view) return null;
  const colors = Object.fromEntries(view.state.factions.map((f) => [f.id, f.color]));
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
      {view.state.settlements.map((s) => (
        <button
          key={s.id}
          ref={(el) => {
            if (el) labelElements.set(s.id, el);
            else labelElements.delete(s.id);
          }}
          type="button"
          className="settlement-label"
          style={{ position: "absolute", left: 0, top: 0, display: "none", pointerEvents: "auto", borderColor: colors[s.ownerId] ?? "#999", transformOrigin: "50% 100%" }}
          onClick={() => select({ kind: "settlement", id: s.id })}
          aria-label={`${s.name}, population ${s.population}`}
        >
          <span className="dot" style={{ background: colors[s.ownerId] ?? "#999" }} />
          {s.isCapital ? "★ " : ""}
          {s.name}
          <span className="pop">{s.population}</span>
        </button>
      ))}
    </div>
  );
}
