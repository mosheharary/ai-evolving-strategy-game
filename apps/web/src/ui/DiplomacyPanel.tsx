"use client";

import type { DiplomacyActionType, ResourceType } from "@echoes/game-types";
import { factionAssetKey, RESOURCE_TYPES } from "@echoes/game-types";
import { OPINION_LABEL, techModifiers } from "@echoes/game-engine";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useGame } from "@/store/gameStore";
import { factionName, RESOURCE_META, relationOf, titleCase } from "./format";
import { Modal } from "./Modal";

export function DiplomacyPanel() {
  const view = useGame((s) => s.view)!;
  const gameId = useGame((s) => s.gameId)!;
  const openPanel = useGame((s) => s.openPanel);
  const send = useGame((s) => s.send);
  const busy = useGame((s) => s.busy);
  const state = view.state;
  const ai = state.factions.filter((f) => f.kind === "ai" && f.alive);
  const [selected, setSelected] = useState(ai[0]?.id ?? "");
  const [giftRes, setGiftRes] = useState<ResourceType>("food");
  const [giftAmt, setGiftAmt] = useState(20);
  const [confirmWar, setConfirmWar] = useState(false);
  const f = state.factions.find((x) => x.id === selected);
  const player = state.factions.find((x) => x.id === "player")!;
  const canAlly = techModifiers(player.research.known).allowAlliance > 0;
  const incoming = state.proposals.filter((p) => p.to === "player");

  // Lazily request (once) a portrait and an envoy greeting for the faction being viewed.
  useEffect(() => {
    if (!f) return;
    if (!view.assets[factionAssetKey(f.id, state.era)]) void api.requestAsset(gameId, { kind: "faction", factionId: f.id }).catch(() => {});
    if (!view.narratives[`faction:${f.id}:${state.turn}`]) void api.requestFactionNarrative(gameId, f.id).catch(() => {});
    setConfirmWar(false);
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = (action: DiplomacyActionType): void => {
    if (!f) return;
    if (action === "declare_war" && !confirmWar) {
      setConfirmWar(true);
      return;
    }
    setConfirmWar(false);
    void send({ type: "DIPLOMACY_ACTION", payload: action === "gift" ? { factionId: f.id, action, resource: giftRes, amount: giftAmt } : { factionId: f.id, action } });
  };

  const rel = f ? relationOf(state, "player", f.id) : undefined;
  const status = rel?.status ?? "peace";
  const op = f ? Math.round(f.opinions.player ?? 0) : 0;
  const portrait = f ? view.assets[factionAssetKey(f.id, state.era)] : undefined;
  const greeting = f ? view.narratives[`faction:${f.id}:${state.turn}`] : undefined;
  const pendingOut = state.proposals.find((p) => p.from === "player" && p.to === selected);

  return (
    <Modal title="Diplomacy" onClose={() => openPanel(null)} wide testId="diplomacy-panel">
      {incoming.length ? (
        <div className="card-list" style={{ marginBottom: "0.8rem" }}>
          <h3>Proposals awaiting your answer</h3>
          {incoming.map((p) => (
            <div key={p.id} className="card row" style={{ justifyContent: "space-between" }}>
              <span>{factionName(state, p.from)} proposes <strong>{p.type}</strong> (year {p.turn})</span>
              <span className="row">
                <button className="btn small primary" disabled={busy} onClick={() => void send({ type: "RESPOND_PROPOSAL", payload: { proposalId: p.id, accept: true } })} data-testid="accept-proposal">Accept</button>
                <button className="btn small" disabled={busy} onClick={() => void send({ type: "RESPOND_PROPOSAL", payload: { proposalId: p.id, accept: false } })}>Decline</button>
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="row" style={{ alignItems: "stretch", gap: "1rem" }}>
        <div className="col" style={{ width: 230, flexShrink: 0 }}>
          {ai.map((x) => {
            const r = relationOf(state, "player", x.id);
            return (
              <button key={x.id} className={`card clickable ${x.id === selected ? "active" : ""}`} style={{ borderColor: x.id === selected ? x.color : undefined }} onClick={() => setSelected(x.id)} data-testid={`dip-${x.id}`}>
                <div className="title" style={{ color: x.color }}>{x.name}</div>
                <div className="faint" style={{ fontSize: "0.75rem" }}>{r?.status ?? "peace"}{r?.trade ? " · trade" : ""} · {OPINION_LABEL(x.opinions.player ?? 0)}</div>
              </button>
            );
          })}
        </div>
        {f ? (
          <div className="col grow">
            <div className="row" style={{ alignItems: "flex-start", gap: "1rem" }}>
              <div style={{ width: 150, flexShrink: 0 }}>
                {portrait ? <img className="thumb" style={{ aspectRatio: "3/4" }} src={portrait.url} alt={`Portrait of a leader of ${f.name}`} /> : <div className="thumb shimmer" style={{ aspectRatio: "3/4" }} aria-label="Portrait loading" />}
              </div>
              <div className="col grow">
                <h2 style={{ color: f.color, margin: 0 }}>{f.name}</h2>
                <div className="row wrap">
                  <span className={`chip ${status === "war" ? "war" : status === "alliance" ? "alliance" : ""}`}>{status}</span>
                  <span className="chip">{titleCase(f.archetype)}</span>
                  {rel?.trade ? <span className="chip alliance">trade route</span> : null}
                  {rel?.sanctionsBy.includes("player") ? <span className="chip war">sanctioned by you</span> : null}
                  {rel?.sanctionsBy.includes(f.id) ? <span className="chip war">sanctioning you</span> : null}
                </div>
                <p className="muted" style={{ fontSize: "0.85rem", lineHeight: 1.5, margin: 0 }}>{f.identity}</p>
                <div style={{ fontSize: "0.82rem" }}>Opinion of you: <strong>{op > 0 ? "+" : ""}{op}</strong> ({OPINION_LABEL(op)})</div>
                <div className="bar"><span style={{ width: `${(op + 100) / 2}%`, background: op < -20 ? "var(--danger)" : op > 20 ? "var(--ok)" : "var(--accent)" }} /></div>
              </div>
            </div>
            {greeting ? <blockquote className="prose card" style={{ margin: 0, fontSize: "0.92rem" }}>{greeting.body}</blockquote> : <div className="card shimmer" style={{ height: 48 }} aria-label="Envoy is on the way" />}
            {f.memories.length ? (
              <div className="faint" style={{ fontSize: "0.78rem" }}>
                They remember: {f.memories.slice(-5).map((m) => `${titleCase(m.kind)} (year ${m.turn}, ${m.weight > 0 ? "+" : ""}${m.weight})`).join(" · ")}
              </div>
            ) : null}
            <div className="divider" />
            <div className="row wrap">
              <button className="btn small" disabled={busy || status === "war" || rel?.trade || !!pendingOut} onClick={() => void send({ type: "DECLARE_TRADE", payload: { factionId: f.id } })} data-testid="propose-trade">Propose trade</button>
              <button className="btn small" disabled={busy || status !== "peace" || !canAlly || !!pendingOut} title={canAlly ? "" : "Requires the Diplomacy technology"} onClick={() => act("propose_alliance")}>Propose alliance</button>
              <button className="btn small" disabled={busy || status !== "war" || !!pendingOut} onClick={() => act("propose_ceasefire")}>Propose ceasefire</button>
              <button className="btn small" disabled={busy || (status !== "war" && status !== "ceasefire") || !!pendingOut} onClick={() => act("propose_peace")}>Propose peace</button>
              <button className="btn small" disabled={busy || status === "war"} onClick={() => act(rel?.sanctionsBy.includes("player") ? "lift_sanction" : "sanction")}>{rel?.sanctionsBy.includes("player") ? "Lift sanctions" : "Sanction"}</button>
              <button className="btn small" disabled={busy || player.resources.influence < 15} title="Costs 15 influence; may be caught" onClick={() => act("espionage")}>Espionage (15 👑)</button>
              <button className="btn small danger" disabled={busy || status === "war"} onClick={() => act("declare_war")} data-testid="declare-war">{confirmWar ? `Confirm war on ${f.name}?` : "Declare war"}</button>
              {confirmWar ? <button className="btn small" onClick={() => setConfirmWar(false)}>Cancel</button> : null}
            </div>
            {pendingOut ? <p className="faint" style={{ fontSize: "0.78rem", margin: 0 }}>Your {pendingOut.type} proposal awaits their answer at the end of the turn.</p> : null}
            <div className="row">
              <span style={{ fontSize: "0.82rem" }}>Gift</span>
              <select value={giftRes} onChange={(e) => setGiftRes(e.target.value as ResourceType)} aria-label="Gift resource" style={{ background: "#0008", color: "var(--text)", border: "1px solid var(--panel-border)", borderRadius: 6 }}>
                {RESOURCE_TYPES.map((r) => <option key={r} value={r}>{RESOURCE_META[r].label}</option>)}
              </select>
              <input type="number" min={1} max={500} value={giftAmt} onChange={(e) => setGiftAmt(Math.max(1, Number(e.target.value) || 1))} aria-label="Gift amount" style={{ width: 70, background: "#0008", color: "var(--text)", border: "1px solid var(--panel-border)", borderRadius: 6, padding: "0.2rem" }} />
              <button className="btn small" disabled={busy || player.resources[giftRes] < giftAmt} onClick={() => act("gift")} data-testid="send-gift">Send gift</button>
            </div>
          </div>
        ) : <p className="muted">No factions remain.</p>}
      </div>
    </Modal>
  );
}
