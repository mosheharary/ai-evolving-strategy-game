"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect } from "react";
import { installDebugHooks } from "@/lib/interaction";
import { connectUpdates } from "@/lib/updates";
import { useGame } from "@/store/gameStore";
import { BottomBar } from "./BottomBar";
import { BuildMenu } from "./BuildMenu";
import { DevPanel } from "./DevPanel";
import { DiplomacyPanel } from "./DiplomacyPanel";
import { EventCard } from "./EventCard";
import { HistoryPanel } from "./HistoryPanel";
import { HoverCard } from "./HoverCard";
import { IntroScreen } from "./IntroScreen";
import { ResearchPanel } from "./ResearchPanel";
import { RightPanel } from "./RightPanel";
import { SavesPanel } from "./SavesPanel";
import { SelectionPanel } from "./SelectionPanel";
import { SettlementLabels } from "./SettlementLabels";
import { HelpPanel, SettingsPanel } from "./SettingsPanel";
import { Toasts } from "./Toasts";
import { TopBar } from "./TopBar";
import { TurnSummary } from "./TurnSummary";
import { VictoryBanner } from "./VictoryBanner";

// The 3D scene is client-only and lazily loaded.
const GameScene = dynamic(() => import("@/three/Scene"), {
  ssr: false,
  loading: () => <div className="game-root" style={{ display: "grid", placeItems: "center" }}><div className="spinner" /></div>,
});

export function GameScreen({ gameId }: { gameId: string }) {
  const load = useGame((s) => s.load);
  const view = useGame((s) => s.view);
  const loading = useGame((s) => s.loading);
  const error = useGame((s) => s.error);
  const panel = useGame((s) => s.panel);
  const settings = useGame((s) => s.settings);
  const endingTurn = useGame((s) => s.endingTurn);
  const aiThinking = useGame((s) => s.aiThinking);
  const live = useGame((s) => s.liveAnnouncement);

  useEffect(() => {
    void load(gameId);
    installDebugHooks();
    return connectUpdates(gameId);
  }, [gameId, load]);

  useEffect(() => {
    document.documentElement.style.setProperty("--ui-scale", String(settings.uiScale));
    document.documentElement.dataset.contrast = settings.highContrast ? "high" : "normal";
    document.documentElement.dataset.motion = settings.reducedMotion ? "reduced" : "full";
  }, [settings]);

  useKeyboardShortcuts();

  if (error) {
    return (
      <main className="menu-root">
        <div className="panel" style={{ padding: "1.5rem", maxWidth: 460 }} role="alert">
          <h2 style={{ fontFamily: "var(--serif)" }}>The frontier is unreachable</h2>
          <p className="muted">{error}</p>
          <Link className="btn" href="/">Back to menu</Link>
        </div>
      </main>
    );
  }
  if (loading || !view) {
    return <main className="menu-root"><div className="col" style={{ alignItems: "center" }}><div className="spinner" /><p className="muted">Unrolling the map…</p></div></main>;
  }

  return (
    <div className="game-root" data-testid="game-root" data-turn={view.state.turn}>
      <div className="canvas-wrap"><GameScene /></div>
      <div className="hud">
        <SettlementLabels />
        <TopBar />
        <SelectionPanel />
        <RightPanel />
        <BottomBar />
        <HoverCard />
        {endingTurn ? (
          <div className="panel ai-thinking" role="status" data-testid="turn-processing">
            <div className="spinner" /> The world turns… {aiThinking.length ? `${aiThinking.length} factions decided` : "factions deliberate"}
          </div>
        ) : null}
        {panel === "build" && <BuildMenu />}
        {panel === "research" && <ResearchPanel />}
        {panel === "diplomacy" && <DiplomacyPanel />}
        {panel === "history" && <HistoryPanel />}
        {panel === "saves" && <SavesPanel />}
        {panel === "settings" && <SettingsPanel />}
        {panel === "help" && <HelpPanel />}
        {panel === "dev" && <DevPanel />}
        <TurnSummary />
        <EventCard />
        <IntroScreen />
        <VictoryBanner />
        <Toasts />
        <div className="sr-only" aria-live="polite">{live}</div>
      </div>
    </div>
  );
}

function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      const g = useGame.getState();
      if (!g.view) return;
      const k = e.key.toLowerCase();
      if (k === "escape") {
        if (g.buildMode) g.setBuildMode(null);
        else if (g.panel) g.openPanel(null);
        else g.select(null);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (k === "enter" && e.shiftKey) {
        e.preventDefault();
        void g.endTurn();
      } else if (k === "b") g.openPanel("build");
      else if (k === "r") g.openPanel("research");
      else if (k === "t") g.openPanel("diplomacy");
      else if (k === "h") g.openPanel("history");
      else if (k === "?") g.openPanel("help");
      else if (k === "f") {
        const sel = g.selection;
        const tile = sel?.kind === "unit" ? g.view.state.units.find((u) => u.id === sel.id)?.tile
          : sel?.kind === "settlement" ? g.view.state.settlements.find((s) => s.id === sel.id)?.tile : sel?.kind === "tile" ? sel.tile : undefined;
        if (tile !== undefined) g.focusTile(tile, 18);
      } else if (k === "tab" || k === "n") {
        e.preventDefault();
        const mine = g.view.state.units.filter((u) => u.ownerId === "player");
        if (mine.length === 0) return;
        const idle = mine.filter((u) => u.movesLeft > 0 && u.status !== "fortified");
        const pool = idle.length ? idle : mine;
        const cur = g.selection?.kind === "unit" ? pool.findIndex((u) => u.id === (g.selection as { id: string }).id) : -1;
        const next = pool[(cur + (e.shiftKey ? pool.length - 1 : 1)) % pool.length]!;
        g.select({ kind: "unit", id: next.id });
        g.focusTile(next.tile, 18);
      } else if (["1", "2", "3", "4", "5"].includes(k)) {
        g.setOverlay((["territory", "resources", "movement", "danger", "diplomacy"] as const)[Number(k) - 1]!);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
