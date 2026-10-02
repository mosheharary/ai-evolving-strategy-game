"use client";

import { RESOURCE_TYPES } from "@echoes/game-types";
import { useGame } from "@/store/gameStore";
import { RESOURCE_META } from "./format";
import { Modal } from "./Modal";

/** "TURN COMPLETE" — what changed, what the world did, and what to look at next. */
export function TurnSummary() {
  const report = useGame((s) => s.report);
  const dismiss = useGame((s) => s.dismissReport);
  const view = useGame((s) => s.view);
  if (!report || !view) return null;
  const deltas = RESOURCE_TYPES.filter((r) => Math.abs(report.resourceDelta[r]) >= 0.5);
  return (
    <Modal title={`Turn ${report.turn} complete`} onClose={dismiss} testId="turn-summary">
      <div className="row wrap" style={{ gap: "0.75rem", marginBottom: "0.8rem" }}>
        {deltas.length === 0 ? <span className="muted">Stores unchanged.</span> : deltas.map((r) => (
          <span key={r} className={`delta ${report.resourceDelta[r] > 0 ? "pos" : "neg"}`} style={{ fontSize: "1.05rem", fontWeight: 600 }}>
            {report.resourceDelta[r] > 0 ? "+" : ""}{Math.round(report.resourceDelta[r])} {RESOURCE_META[r].icon} {RESOURCE_META[r].label}
          </span>
        ))}
      </div>
      {report.lines.length ? (
        <ul style={{ margin: "0 0 0.8rem", paddingLeft: "1.1rem", lineHeight: 1.6 }}>
          {report.lines.slice(0, 12).map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      ) : null}
      <h3>The world moved</h3>
      <ul className="muted" style={{ margin: 0, paddingLeft: "1.1rem", lineHeight: 1.55, fontSize: "0.88rem" }} data-testid="faction-actions">
        {report.factionActions.map((a) => (
          <li key={a.factionId}>
            {a.summary} <span className={`chip ${a.source === "ai" ? "ai" : ""}`}>{a.source === "ai" ? "strategic AI" : "fallback"}</span>
          </li>
        ))}
      </ul>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: "1rem" }}>
        <button className="btn primary" onClick={dismiss} autoFocus data-testid="continue-turn">Continue</button>
      </div>
    </Modal>
  );
}
