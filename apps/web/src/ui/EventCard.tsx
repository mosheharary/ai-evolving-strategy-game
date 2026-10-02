"use client";

import { eventKey } from "@echoes/game-types";
import { useGame } from "@/store/gameStore";
import { factionName, titleCase } from "./format";
import { Modal } from "./Modal";

/**
 * Event presentation. The deterministic facts (cause, consequences) are always shown;
 * Gemini narrative and artwork appear when ready, with graceful fallbacks meanwhile.
 */
export function EventCard() {
  const queue = useGame((s) => s.eventQueue);
  const report = useGame((s) => s.report);
  const view = useGame((s) => s.view);
  const pop = useGame((s) => s.popEvent);
  const focusTile = useGame((s) => s.focusTile);
  if (!view || queue.length === 0 || report) return null;
  const e = view.state.events.find((x) => x.id === queue[0]);
  if (!e) {
    pop();
    return null;
  }
  const key = eventKey(e);
  const n = view.narratives[key];
  const asset = view.assets[key];
  const imagePending = (e.major || e.type === "discovery" || e.type === "ancient_ruin_discovery") && !asset;
  return (
    <Modal title={n?.title ?? titleCase(e.type)} onClose={pop} testId="event-modal">
      {asset ? <img className="thumb" src={asset.url} alt={`Illustration of ${n?.title ?? e.type}`} style={{ marginBottom: "0.8rem" }} /> : imagePending ? <div className="thumb shimmer" style={{ marginBottom: "0.8rem" }} aria-label="Artwork is being painted" /> : null}
      <div className="row wrap" style={{ marginBottom: "0.6rem" }}>
        <span className="chip">Year {e.turn}</span>
        <span className="chip">{e.region}</span>
        <span className="chip">Severity {Math.round(e.severity * 100)}%</span>
        {e.duration > 0 ? <span className="chip">{e.duration} turns</span> : null}
        {n ? <span className="chip ai">{n.source === "gemini" ? "Chronicle by Gemini" : "Chronicle"}</span> : null}
      </div>
      <p className="prose" style={{ marginTop: 0 }}>{n?.body ?? (view.state.history.find((h) => h.eventId === e.id)?.summary ?? "The chroniclers are still writing…")}</p>
      {n?.reactions.length ? (
        <div className="card-list" style={{ margin: "0.6rem 0" }}>
          {n.reactions.map((r) => (
            <div key={r.factionId} className="card" style={{ fontSize: "0.88rem" }}>
              <strong style={{ color: view.state.factions.find((f) => f.id === r.factionId)?.color }}>{factionName(view.state, r.factionId)}:</strong> {r.text}
            </div>
          ))}
        </div>
      ) : null}
      <h3>What the engine decided</h3>
      <ul className="muted" style={{ marginTop: 0, paddingLeft: "1.1rem", lineHeight: 1.55, fontSize: "0.86rem" }}>
        {[...e.immediate, ...e.consequences].map((c, i) => <li key={i}>{c}</li>)}
        <li className="faint">Cause: {Object.entries(e.cause).map(([k, v]) => `${k} = ${String(v)}`).join(", ")}</li>
      </ul>
      <div className="row" style={{ justifyContent: "flex-end", gap: "0.5rem" }}>
        <button className="btn" onClick={() => focusTile(e.centerTile, 20)}>Show on map</button>
        <button className="btn primary" onClick={pop} autoFocus>{queue.length > 1 ? `Next (${queue.length - 1})` : "Dismiss"}</button>
      </div>
    </Modal>
  );
}
