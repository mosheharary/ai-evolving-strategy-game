"use client";

import type { GameState, UnitType } from "@echoes/game-types";
import { UNIT_TYPES } from "@echoes/game-types";
import { BUILDINGS, canTrain, computeFactionEconomy, UNITS, unitLegalActions } from "@echoes/game-engine";
import { getGrid } from "@echoes/procedural-world";
import { useMemo } from "react";
import { useGame } from "@/store/gameStore";
import { costText, factionName, titleCase } from "./format";

export function SelectionPanel() {
  const view = useGame((s) => s.view)!;
  const selection = useGame((s) => s.selection);
  if (!selection) {
    return (
      <aside className="panel left-panel" aria-label="Selection">
        <h2>{view.state.civilizationName}</h2>
        <p className="muted" style={{ fontSize: "0.86rem", lineHeight: 1.5 }}>
          Select a settlement, unit or tile. <strong>Tab</strong> cycles your units; drag to pan, right-drag to rotate, scroll to zoom.
        </p>
        <PlayerOverview state={view.state} />
      </aside>
    );
  }
  return (
    <aside className="panel left-panel scroll" aria-label="Selection details" data-testid="selection-panel">
      {selection.kind === "unit" && <UnitDetails state={view.state} id={selection.id} />}
      {selection.kind === "settlement" && <SettlementDetails state={view.state} id={selection.id} />}
      {selection.kind === "tile" && <TileDetails state={view.state} tile={selection.tile} />}
    </aside>
  );
}

function PlayerOverview({ state }: { state: GameState }) {
  const select = useGame((s) => s.select);
  const focusTile = useGame((s) => s.focusTile);
  const mine = state.settlements.filter((s) => s.ownerId === "player");
  const units = state.units.filter((u) => u.ownerId === "player");
  return (
    <div className="col">
      <h3>Settlements</h3>
      {mine.map((s) => (
        <button key={s.id} className="card clickable" onClick={() => { select({ kind: "settlement", id: s.id }); focusTile(s.tile, 20); }} data-testid={`settlement-${s.id}`}>
          <div className="title">{s.isCapital ? "★ " : ""}{s.name}</div>
          <div className="faint" style={{ fontSize: "0.78rem" }}>Pop {s.population} · Stability {Math.round(s.stability)}</div>
        </button>
      ))}
      <h3>Units</h3>
      <div className="row wrap">
        {units.map((u) => (
          <button key={u.id} className="btn small" onClick={() => { select({ kind: "unit", id: u.id }); focusTile(u.tile, 18); }} data-testid={`unit-${u.type}`}>
            {UNITS[u.type].name}{u.movesLeft > 0 ? "" : " ✓"}
          </button>
        ))}
      </div>
    </div>
  );
}

function UnitDetails({ state, id }: { state: GameState; id: string }) {
  const send = useGame((s) => s.send);
  const busy = useGame((s) => s.busy);
  const u = state.units.find((x) => x.id === id);
  const legal = useMemo(() => (u && u.ownerId === "player" ? unitLegalActions(state, id) : null), [state, id, u]);
  if (!u) return <p className="muted">Unit not found.</p>;
  const def = UNITS[u.type];
  const own = u.ownerId === "player";
  const tile = state.map.tiles[u.tile]!;
  return (
    <div className="col">
      <h2>{def.name}</h2>
      <div className="muted" style={{ fontSize: "0.82rem" }}>{factionName(state, u.ownerId)} · {titleCase(u.status)}</div>
      <p className="faint" style={{ fontSize: "0.82rem", margin: 0 }}>{def.description}</p>
      <dl className="stat-grid">
        <dt>Health</dt><dd>{u.hp} / {u.maxHp}</dd>
        <dt>Attack / Defense</dt><dd>{def.attack} / {def.defense}</dd>
        <dt>Moves</dt><dd>{u.movesLeft} / {def.moves}</dd>
        <dt>Morale</dt><dd>{Math.round(u.morale)}</dd>
        <dt>Range</dt><dd>{def.range}</dd>
        <dt>Terrain</dt><dd>{titleCase(tile.biome)}</dd>
      </dl>
      {own && legal ? (
        <>
          <p className="faint" style={{ fontSize: "0.78rem", margin: 0 }}>
            Click a <span style={{ color: "#7fd3ff" }}>blue</span> tile to move ({legal.moves.length} reachable)
            {legal.attacks.length ? <>, a <span style={{ color: "#ff5a4a" }}>red</span> tile to attack</> : null}.
          </p>
          {legal.attacks.map((a) => (
            <div key={a.tile} className="card" style={{ fontSize: "0.8rem" }}>
              Target in {state.map.tiles[a.tile]!.region}: expected damage ~{a.preview?.expectedDamage}, counter ~{a.preview?.expectedCounter} ({Math.round((a.preview?.ratio ?? 0) * 100)}% edge)
              <div className="row" style={{ marginTop: 4 }}>
                <button className="btn small" disabled={busy} onClick={() => void send({ type: "ATTACK", payload: { unitId: u.id, target: a.tile } })}>Attack</button>
                {state.settlements.some((s) => s.tile === a.tile) ? <button className="btn small danger" disabled={busy} onClick={() => void send({ type: "ATTACK", payload: { unitId: u.id, target: a.tile, raze: true } })}>Attack & raze</button> : null}
              </div>
            </div>
          ))}
          <div className="row wrap">
            {u.type === "worker" ? (
              <>
                <button className="btn small" disabled={busy || !legal.canGather} onClick={() => void send({ type: "GATHER_RESOURCE", payload: { unitId: u.id } })} data-testid="gather" title="Gather resources from this tile (depletes it)">Gather</button>
                <button className="btn small primary" disabled={busy || !legal.canFound} title={legal.foundError ?? "Found a settlement here"} onClick={() => void send({ type: "BUILD_STRUCTURE", payload: { buildingType: "settlement_center", tile: u.tile, workerId: u.id } })} data-testid="found-settlement">
                  Found settlement ({costText(BUILDINGS.settlement_center.cost)})
                </button>
                {!legal.canFound && legal.foundError ? <span className="faint" style={{ fontSize: "0.75rem" }}>{legal.foundError}</span> : null}
              </>
            ) : null}
            {legal.canFortify ? <button className="btn small" disabled={busy} onClick={() => void send({ type: "FORTIFY_UNIT", payload: { unitId: u.id } })}>Fortify</button> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function SettlementDetails({ state, id }: { state: GameState; id: string }) {
  const send = useGame((s) => s.send);
  const busy = useGame((s) => s.busy);
  const openPanel = useGame((s) => s.openPanel);
  const s = state.settlements.find((x) => x.id === id);
  const econ = useMemo(() => (s ? computeFactionEconomy(state, s.ownerId) : null), [state, s]);
  if (!s || !econ) return <p className="muted">Settlement not found.</p>;
  const own = s.ownerId === "player";
  const se = econ.settlements.find((x) => x.settlementId === s.id);
  const buildings = state.buildings.filter((b) => b.settlementId === s.id && b.type !== "settlement_center");
  const threshold = 8 + s.population * 3;
  return (
    <div className="col">
      <h2>{s.isCapital ? "★ " : ""}{s.name}</h2>
      <div className="muted" style={{ fontSize: "0.82rem" }}>{factionName(state, s.ownerId)} · founded year {s.foundedTurn}{s.founderId !== s.ownerId ? ` by ${factionName(state, s.founderId)}` : ""}</div>
      <dl className="stat-grid">
        <dt>Population</dt><dd>{s.population} / {se?.housing ?? "?"}</dd>
        <dt>Growth</dt><dd>{Math.round(s.growth)} / {threshold}</dd>
        <dt>Stability</dt><dd style={{ color: s.stability < 30 ? "var(--danger)" : undefined }}>{Math.round(s.stability)}</dd>
        <dt>Defense HP</dt><dd>{s.hp} / {s.maxHp}</dd>
        {own && se ? <><dt>Jobs filled</dt><dd>{se.jobsFilled} / {se.jobsTotal}</dd></> : null}
      </dl>
      <div className="bar" aria-label="Growth progress"><span style={{ width: `${Math.min(100, (s.growth / threshold) * 100)}%` }} /></div>
      {s.training ? <div className="card" style={{ fontSize: "0.82rem" }}>Training {UNITS[s.training.unitType].name} — {s.training.turnsRemaining} turn(s)</div> : null}
      <h3>Buildings</h3>
      {buildings.length === 0 ? <p className="faint" style={{ fontSize: "0.8rem", margin: 0 }}>Nothing built yet.</p> : (
        <ul style={{ margin: 0, paddingLeft: "1rem", fontSize: "0.82rem", lineHeight: 1.6 }}>
          {buildings.map((b) => {
            const y = se?.buildings.find((x) => x.buildingId === b.id);
            const out = y ? Object.entries(y.output).filter(([, v]) => v > 0).map(([k, v]) => `+${v.toFixed(1)} ${k}`).join(", ") : "";
            return <li key={b.id}>{BUILDINGS[b.type].name}{b.turnsRemaining > 0 ? ` (building, ${b.turnsRemaining}t)` : y && y.staffed < 1 ? " (understaffed)" : ""} <span className="faint">{out}</span></li>;
          })}
        </ul>
      )}
      {own ? (
        <>
          <button className="btn primary" onClick={() => openPanel("build")} data-testid="open-build">Build… <kbd>B</kbd></button>
          <h3>Train</h3>
          <div className="col" style={{ gap: "0.3rem" }}>
            {UNIT_TYPES.map((t: UnitType) => {
              const err = canTrain(state, "player", s.id, t);
              return (
                <button key={t} className="btn small" style={{ justifyContent: "space-between" }} disabled={busy || err !== null} title={err ?? UNITS[t].description} onClick={() => void send({ type: "TRAIN_UNIT", payload: { settlementId: s.id, unitType: t } })} data-testid={`train-${t}`}>
                  <span>{UNITS[t].name}</span><span className="faint">{costText(UNITS[t].cost)}</span>
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

function TileDetails({ state, tile }: { state: GameState; tile: number }) {
  const send = useGame((s) => s.send);
  const busy = useGame((s) => s.busy);
  const t = state.map.tiles[tile];
  if (!t) return null;
  if (!t.explored) return <div><h2>Unexplored</h2><p className="muted">Send scouts to reveal this land.</p></div>;
  const building = t.buildingId ? state.buildings.find((b) => b.id === t.buildingId) : null;
  const grid = getGrid(state.map.width, state.map.height);
  const claimable = t.ownerId !== "player" && !building && grid.neighbors(tile).some((n) => state.map.tiles[n]?.ownerId === "player") &&
    state.settlements.some((s) => s.ownerId === "player" && grid.distance(s.tile, tile) <= 3);
  return (
    <div className="col">
      <h2>{titleCase(t.biome)}</h2>
      <div className="muted" style={{ fontSize: "0.82rem" }}>{t.region}{t.biome !== t.baseBiome ? ` · once ${titleCase(t.baseBiome)}` : ""}</div>
      <dl className="stat-grid">
        <dt>Owner</dt><dd>{factionName(state, t.ownerId)}</dd>
        <dt>Elevation</dt><dd>{Math.round(t.elevation * 100)}</dd>
        <dt>Fertility</dt><dd>{Math.round(t.fertility)}</dd>
        <dt>Forest</dt><dd>{Math.round(t.forest)}</dd>
        <dt>Habitat</dt><dd>{Math.round(t.habitat)}</dd>
        <dt>Pollution</dt><dd style={{ color: t.pollution > 25 ? "var(--danger)" : undefined }}>{t.pollution.toFixed(1)}</dd>
        {t.prosperity > 0 ? <><dt>Prosperity</dt><dd>{Math.round(t.prosperity)}</dd></> : null}
        {t.river ? <><dt>River</dt><dd>yes</dd></> : null}
        {t.resource ? <><dt>Resource</dt><dd>{titleCase(t.resource.type)} ({Math.round(t.resource.amount)})</dd></> : null}
        {t.poi ? <><dt>Site</dt><dd>{titleCase(t.poi)}{t.poiDiscovered ? "" : " (unexplored)"}</dd></> : null}
        {building ? <><dt>Building</dt><dd>{BUILDINGS[building.type].name}</dd></> : null}
      </dl>
      {claimable ? (
        <button className="btn small" disabled={busy} onClick={() => void send({ type: "CLAIM_TERRITORY", payload: { tile } })} title="Costs influence; claiming foreign land angers its owner">
          Claim territory ({t.ownerId ? 25 : 10} 👑)
        </button>
      ) : null}
    </div>
  );
}
