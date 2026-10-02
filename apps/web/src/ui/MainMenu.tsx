"use client";

import type { SaveSummary } from "@echoes/game-types";
import { ERA_NAMES } from "@echoes/game-engine";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError, type GameListItem } from "@/lib/api";

const START_OPTIONS = [
  { value: "balanced", label: "Balanced plains" },
  { value: "river", label: "River valley" },
  { value: "coastal", label: "Coastal" },
  { value: "highlands", label: "Highlands" },
  { value: "forest", label: "Deep forest" },
] as const;

const randomSeed = (): string => Math.random().toString(36).slice(2, 8) + "-" + Math.floor(Math.random() * 999);

export function MainMenu() {
  const router = useRouter();
  const [games, setGames] = useState<GameListItem[]>([]);
  const [saves, setSaves] = useState<SaveSummary[]>([]);
  const [demo, setDemo] = useState(false);
  const [mode, setMode] = useState<"home" | "new" | "load">("home");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ civilizationName: "The Hearthborn", gameName: "", difficulty: "governor", seed: randomSeed(), startPreference: "balanced" });

  useEffect(() => {
    void (async () => {
      try {
        await api.session();
        const [g, s, d] = await Promise.all([api.listGames(), api.listSaves(), api.demo().catch(() => ({ available: false }))]);
        setGames(g.games);
        setSaves(s.saves);
        setDemo(d.available);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "The game server is unreachable.");
      }
    })();
  }, []);

  const start = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.createGame({
        civilizationName: form.civilizationName,
        gameName: form.gameName || undefined,
        difficulty: form.difficulty as "governor",
        seed: form.seed || undefined,
        startPreference: form.startPreference as "balanced",
      });
      router.push(`/play/${r.gameId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create the world.");
      setBusy(false);
    }
  };

  const quickStart = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await api.createGame({ civilizationName: "The Hearthborn", difficulty: "governor", startPreference: "balanced" });
      router.push(`/play/${r.gameId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create the world.");
      setBusy(false);
    }
  };

  const load = async (saveId: string): Promise<void> => {
    setBusy(true);
    try {
      const r = await api.loadSave(saveId);
      router.push(`/play/${r.gameId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the save.");
      setBusy(false);
    }
  };

  const latest = games[0];

  return (
    <main className="menu-root">
      <svg className="ridge" viewBox="0 0 1200 300" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 300 L0 190 L120 140 L210 175 L330 95 L450 160 L560 120 L690 180 L800 110 L930 150 L1050 90 L1200 150 L1200 300 Z" fill="#1d2630" />
        <path d="M0 300 L0 230 L150 200 L280 235 L420 190 L560 225 L700 195 L860 235 L1000 200 L1200 230 L1200 300 Z" fill="#141b22" />
      </svg>
      <section className="panel menu-card" aria-labelledby="title">
        <div className="col" style={{ gap: "1rem" }}>
          <h1 id="title" className="menu-title"><span>A FRONTIER THAT REMEMBERS</span>Echoes of the Frontier</h1>
          <p className="muted" style={{ lineHeight: 1.6, margin: 0 }}>
            Lead the last surviving civilization across an evolving frontier. Forests fall and return, rivers sicken, factions remember
            every gift and every war — and the chronicle of your choices becomes the history of the world.
          </p>
          <ul className="muted" style={{ margin: 0, paddingLeft: "1.1rem", lineHeight: 1.7, fontSize: "0.9rem" }}>
            <li>Server-authoritative deterministic simulation with replay</li>
            <li>Rival factions decide with TypeSafe strategic judgement</li>
            <li>Gemini writes the chronicle and paints its great moments</li>
          </ul>
          {error ? <p role="alert" style={{ color: "var(--danger)", margin: 0 }}>{error}</p> : null}
        </div>

        <div className="col" style={{ gap: "0.6rem" }}>
          {mode === "home" && (
            <>
              {latest ? (
                <button className="btn primary" disabled={busy} onClick={() => router.push(`/play/${latest.id}`)} data-testid="continue">
                  Continue — {latest.civilizationName}, Year {latest.currentTurn}
                </button>
              ) : (
                <button className="btn primary" disabled={busy} onClick={quickStart} data-testid="quick-start">Quick Start</button>
              )}
              <button className="btn" disabled={busy} onClick={() => setMode("new")} data-testid="new-game">New Game</button>
              <button className="btn" disabled={busy || saves.length === 0} onClick={() => setMode("load")} data-testid="load-game">Load Game ({saves.length})</button>
              {demo ? <button className="btn" disabled={busy} onClick={async () => { setBusy(true); try { const r = await api.claimDemo(); router.push(`/play/${r.gameId}`); } catch (e) { setError(e instanceof ApiError ? e.message : "Demo unavailable."); setBusy(false); } }}>Open Demo Campaign</button> : null}
              {games.length > 1 ? (
                <div className="col" style={{ marginTop: "0.5rem" }}>
                  <span className="faint" style={{ fontSize: "0.8rem" }}>Your campaigns</span>
                  {games.slice(0, 5).map((g) => (
                    <button key={g.id} className="card clickable" onClick={() => router.push(`/play/${g.id}`)}>
                      <div className="title">{g.name}</div>
                      <div className="faint" style={{ fontSize: "0.78rem" }}>Year {g.currentTurn} · Era {g.era} {ERA_NAMES[g.era - 1]} · seed {g.seed}</div>
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          )}

          {mode === "new" && (
            <form className="col" onSubmit={(e) => { e.preventDefault(); void start(); }} aria-label="New game">
              <h2 style={{ fontFamily: "var(--serif)", margin: 0 }}>Found a Civilization</h2>
              <label className="field">Civilization name
                <input required minLength={2} maxLength={40} value={form.civilizationName} onChange={(e) => setForm({ ...form, civilizationName: e.target.value })} data-testid="civ-name" />
              </label>
              <label className="field">Campaign name (optional)
                <input maxLength={60} value={form.gameName} onChange={(e) => setForm({ ...form, gameName: e.target.value })} />
              </label>
              <div className="row">
                <label className="field grow">Difficulty
                  <select value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}>
                    <option value="settler">Settler — forgiving</option>
                    <option value="governor">Governor — balanced</option>
                    <option value="warlord">Warlord — ruthless</option>
                  </select>
                </label>
                <label className="field grow">Starting location
                  <select value={form.startPreference} onChange={(e) => setForm({ ...form, startPreference: e.target.value })}>
                    {START_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              </div>
              <label className="field">World seed
                <div className="row">
                  <input className="grow" maxLength={40} pattern="[A-Za-z0-9-]*" value={form.seed} onChange={(e) => setForm({ ...form, seed: e.target.value })} data-testid="seed" />
                  <button type="button" className="btn small" onClick={() => setForm({ ...form, seed: randomSeed() })}>Random</button>
                </div>
              </label>
              <div className="row">
                <button type="button" className="btn" onClick={() => setMode("home")}>Back</button>
                <button type="submit" className="btn primary grow" disabled={busy} data-testid="start-game">{busy ? "Generating world…" : "Generate World"}</button>
              </div>
            </form>
          )}

          {mode === "load" && (
            <div className="col">
              <h2 style={{ fontFamily: "var(--serif)", margin: 0 }}>Load Game</h2>
              <div className="col scroll" style={{ maxHeight: "50vh" }}>
                {saves.map((s) => (
                  <button key={s.saveId} className="card clickable" onClick={() => void load(s.saveId)} disabled={busy}>
                    <div className="title">{s.name}</div>
                    <div className="faint" style={{ fontSize: "0.78rem" }}>
                      {s.civilizationName} · Year {s.turn} · Era {s.era} {ERA_NAMES[s.era - 1]} · seed {s.seed} · {new Date(s.createdAt).toLocaleString()}
                    </div>
                  </button>
                ))}
              </div>
              <button className="btn" onClick={() => setMode("home")}>Back</button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
