"use client";

import type { SaveSummary } from "@echoes/game-types";
import { ERA_NAMES } from "@echoes/game-engine";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useGame } from "@/store/gameStore";
import { Modal } from "./Modal";

export function SavesPanel() {
  const view = useGame((s) => s.view)!;
  const gameId = useGame((s) => s.gameId)!;
  const openPanel = useGame((s) => s.openPanel);
  const toast = useGame((s) => s.toast);
  const load = useGame((s) => s.load);
  const router = useRouter();
  const [saves, setSaves] = useState<SaveSummary[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const refresh = async (): Promise<void> => setSaves((await api.listSaves()).saves);
  useEffect(() => {
    void refresh();
  }, []);

  const doSave = async (asName?: string): Promise<void> => {
    setBusy(true);
    try {
      const s = await api.save(gameId, asName);
      toast("success", `Saved "${s.name}".`);
      setName("");
      await refresh();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const doLoad = async (saveId: string): Promise<void> => {
    setBusy(true);
    try {
      const r = await api.loadSave(saveId);
      if (r.migratedFrom) toast("info", `Save upgraded from schema v${r.migratedFrom}.`);
      openPanel(null);
      if (r.gameId === gameId) await load(gameId);
      else router.push(`/play/${r.gameId}`);
      toast("success", "Save loaded.");
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "Load failed.");
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (saveId: string): Promise<void> => {
    await api.deleteSave(saveId).catch(() => toast("error", "Delete failed."));
    setConfirmDelete(null);
    await refresh();
  };

  return (
    <Modal title="Saves" onClose={() => openPanel(null)} testId="saves-panel">
      <div className="row wrap" style={{ marginBottom: "0.8rem" }}>
        <button className="btn primary" disabled={busy} onClick={() => void doSave()} data-testid="save-game">Save Game</button>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Save as…" aria-label="Save name" style={{ background: "#0008", color: "var(--text)", border: "1px solid var(--panel-border)", borderRadius: 8, padding: "0.45rem 0.6rem" }} />
        <button className="btn" disabled={busy || !name.trim()} onClick={() => void doSave(name.trim())} data-testid="save-as">Save As</button>
        <span className="grow" />
        <Link className="btn" href="/">New Game / Menu</Link>
      </div>
      <p className="faint" style={{ fontSize: "0.78rem", marginTop: 0 }}>
        Autosaves happen after every turn, major events, major diplomacy and research. Current campaign: {view.name} · seed {view.state.seed} · hash {view.stateHash.slice(0, 10)}
      </p>
      <div className="card-list">
        {saves.map((s) => (
          <div key={s.saveId} className="card" data-testid="save-row">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="title">{s.name}</span>
              {s.autosave ? <span className="chip">autosave</span> : null}
            </div>
            <div className="faint" style={{ fontSize: "0.78rem", margin: "0.2rem 0 0.4rem" }}>
              {s.civilizationName} · Era {s.era} {ERA_NAMES[s.era - 1]} · Year {s.turn} · seed {s.seed} · {new Date(s.createdAt).toLocaleString()} · v{s.schemaVersion}
            </div>
            <div className="row">
              <button className="btn small" disabled={busy} onClick={() => void doLoad(s.saveId)} data-testid="load-save">Load</button>
              {confirmDelete === s.saveId ? (
                <>
                  <button className="btn small danger" onClick={() => void doDelete(s.saveId)}>Confirm delete</button>
                  <button className="btn small" onClick={() => setConfirmDelete(null)}>Keep</button>
                </>
              ) : <button className="btn small" onClick={() => setConfirmDelete(s.saveId)}>Delete</button>}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
