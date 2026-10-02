"use client";

import { BUILDINGS, UNITS } from "@echoes/game-engine";
import { useGame } from "@/store/gameStore";
import { factionName, titleCase } from "./format";

export function Toasts() {
  const toasts = useGame((s) => s.toasts);
  const dismiss = useGame((s) => s.dismissToast);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} className={`panel toast ${t.kind}`} onClick={() => dismiss(t.id)} style={{ textAlign: "left", cursor: "pointer" }} data-testid={`toast-${t.kind}`}>
          {t.text}
        </button>
      ))}
    </div>
  );
}

/** Small contextual tooltip for the hovered tile. */
export function HoverCard() {
  const view = useGame((s) => s.view);
  const tile = useGame((s) => s.hoverTile);
  if (!view || tile === null) return null;
  const t = view.state.map.tiles[tile];
  if (!t) return null;
  if (!t.explored) return <div className="panel hover-card">Unexplored</div>;
  const unit = view.state.units.find((u) => u.tile === tile);
  const settlement = view.state.settlements.find((s) => s.tile === tile);
  const building = t.buildingId ? view.state.buildings.find((b) => b.id === t.buildingId) : null;
  return (
    <div className="panel hover-card" aria-hidden="true">
      <strong>{settlement ? settlement.name : titleCase(t.biome)}</strong> <span className="faint">· {t.region}</span>
      <div className="faint">
        {factionName(view.state, t.ownerId)}
        {t.resource ? ` · ${titleCase(t.resource.type)}` : ""}
        {t.poi ? ` · ${titleCase(t.poi)}` : ""}
        {building && !settlement ? ` · ${BUILDINGS[building.type].name}` : ""}
        {t.pollution > 10 ? ` · pollution ${Math.round(t.pollution)}` : ""}
      </div>
      {unit ? <div>{UNITS[unit.type].name} ({factionName(view.state, unit.ownerId)}) {unit.hp}/{unit.maxHp}</div> : null}
    </div>
  );
}
