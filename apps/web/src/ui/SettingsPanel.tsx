"use client";

import { useGame } from "@/store/gameStore";
import { Modal } from "./Modal";

export function SettingsPanel() {
  const settings = useGame((s) => s.settings);
  const update = useGame((s) => s.updateSettings);
  const openPanel = useGame((s) => s.openPanel);
  return (
    <Modal title="Settings" onClose={() => openPanel(null)}>
      <div className="col">
        <label className="field">UI scale: {Math.round(settings.uiScale * 100)}%
          <input type="range" min={0.8} max={1.5} step={0.05} value={settings.uiScale} onChange={(e) => update({ uiScale: Number(e.target.value) })} />
        </label>
        {([
          ["reducedMotion", "Reduced animation (no camera flights, no idle motion)"],
          ["highContrast", "High-contrast interface"],
          ["shadows", "Shadows"],
          ["postFx", "Bloom and vignette post-processing"],
        ] as const).map(([k, label]) => (
          <label key={k} className="row" style={{ fontSize: "0.9rem" }}>
            <input type="checkbox" checked={settings[k]} onChange={(e) => update({ [k]: e.target.checked })} /> {label}
          </label>
        ))}
        <button className="btn small" onClick={() => openPanel("help")}>Keyboard controls</button>
      </div>
    </Modal>
  );
}

export function HelpPanel() {
  const openPanel = useGame((s) => s.openPanel);
  const rows: [string, string][] = [
    ["W A S D / Arrows", "Pan the camera"], ["Q / E", "Rotate"], ["+ / − / wheel", "Zoom"], ["Drag / right-drag", "Pan / rotate"],
    ["Click", "Select; with a unit selected, move or attack"], ["Right-click", "Move selected unit / cancel"], ["Tab / Shift+Tab, N", "Cycle units"],
    ["F", "Focus selection"], ["B / R / T / H", "Build / Research / Diplomacy (Treaties) / History"], ["1–5", "Overlays: territory, resources, movement, danger, diplomacy"],
    ["Shift+Enter", "End turn"], ["Esc", "Close / cancel"], ["?", "This help"],
  ];
  return (
    <Modal title="Controls" onClose={() => openPanel(null)}>
      <dl className="stat-grid" style={{ gridTemplateColumns: "auto 1fr" }}>
        {rows.map(([k, v]) => [<dt key={`${k}-k`}><kbd>{k}</kbd></dt>, <dd key={`${k}-v`} style={{ textAlign: "left" }}>{v}</dd>])}
      </dl>
    </Modal>
  );
}
