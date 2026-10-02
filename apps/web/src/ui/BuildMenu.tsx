"use client";

import type { BuildingType } from "@echoes/game-types";
import { BUILDING_TYPES } from "@echoes/game-types";
import { BUILDINGS, canBuild, TECH_BY_ID } from "@echoes/game-engine";
import { useMemo } from "react";
import { useGame } from "@/store/gameStore";
import { costText } from "./format";
import { Modal } from "./Modal";

export function BuildMenu() {
  const view = useGame((s) => s.view)!;
  const openPanel = useGame((s) => s.openPanel);
  const setBuildMode = useGame((s) => s.setBuildMode);
  const state = view.state;
  const player = state.factions.find((f) => f.id === "player")!;
  const options = useMemo(() => {
    const own = state.map.tiles.filter((t) => t.ownerId === "player");
    return BUILDING_TYPES.filter((b) => b !== "settlement_center").map((type) => {
      const def = BUILDINGS[type];
      const validTiles = own.filter((t) => canBuild(state, "player", type, t.i) === null).length;
      const techMissing = def.requiresTech && !player.research.known.includes(def.requiresTech) ? TECH_BY_ID.get(def.requiresTech)?.name ?? def.requiresTech : null;
      const affordable = Object.entries(def.cost).every(([r, v]) => (player.resources[r as keyof typeof player.resources] ?? 0) >= (v ?? 0));
      return { type, def, validTiles, techMissing, affordable };
    });
  }, [state, player]);
  const pick = (type: BuildingType): void => setBuildMode(type);
  return (
    <Modal title="Build" onClose={() => openPanel(null)} testId="build-menu">
      <p className="muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
        Choose a structure, then click a highlighted tile in your territory. New settlements are founded by a Worker standing on the site.
      </p>
      <div className="card-list">
        {options.map(({ type, def, validTiles, techMissing, affordable }) => {
          const disabled = !!techMissing || !affordable || validTiles === 0;
          const reason = techMissing ? `Requires ${techMissing}` : !affordable ? "Not enough resources" : validTiles === 0 ? "No valid tile in your territory" : `${validTiles} valid tiles`;
          return (
            <button key={type} className="card clickable" disabled={disabled} style={{ opacity: disabled ? 0.55 : 1 }} onClick={() => pick(type)} data-testid={`build-${type}`}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="title">{def.name}</span>
                <span className="faint" style={{ fontSize: "0.8rem" }}>{costText(def.cost)} · {def.buildTurns}t</span>
              </div>
              <div className="muted" style={{ fontSize: "0.8rem" }}>{def.description}</div>
              <div className="faint" style={{ fontSize: "0.74rem", marginTop: 3 }}>
                {Object.entries(def.output).length ? `Yields ${Object.entries(def.output).map(([k, v]) => `${v} ${k}`).join(", ")}. ` : ""}
                {Object.entries(def.upkeep).length ? `Upkeep ${Object.entries(def.upkeep).map(([k, v]) => `${v} ${k}`).join(", ")}. ` : ""}
                {def.jobs ? `${def.jobs} worker${def.jobs > 1 ? "s" : ""}. ` : ""}
                {def.pollution ? `Pollution ${def.pollution}. ` : ""}
                <span style={{ color: disabled ? "var(--danger)" : "var(--ok)" }}>{reason}</span>
              </div>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
