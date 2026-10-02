"use client";

import type { BuildingType, CommandBody, GameView, ServerPush, TurnReport } from "@echoes/game-types";
import { create } from "zustand";
import { api, ApiError } from "@/lib/api";

export type Overlay = "none" | "territory" | "resources" | "movement" | "danger" | "diplomacy";
export type Panel = null | "build" | "research" | "diplomacy" | "history" | "saves" | "settings" | "dev" | "help";
export type Selection = { kind: "tile"; tile: number } | { kind: "unit"; id: string } | { kind: "settlement"; id: string } | null;

export interface Toast {
  id: number;
  kind: "info" | "error" | "success" | "event";
  text: string;
}

export interface Settings {
  uiScale: number;
  reducedMotion: boolean;
  highContrast: boolean;
  shadows: boolean;
  postFx: boolean;
}

const SETTINGS_KEY = "echoes.settings.v1";

function loadSettings(): Settings {
  const defaults: Settings = { uiScale: 1, reducedMotion: false, highContrast: false, shadows: true, postFx: true };
  if (typeof window === "undefined") return defaults;
  try {
    const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    return { ...defaults, reducedMotion: prefersReduced, ...(raw ? (JSON.parse(raw) as Partial<Settings>) : {}) };
  } catch {
    return defaults;
  }
}

interface GameStore {
  gameId: string | null;
  view: GameView | null;
  loading: boolean;
  busy: boolean;
  endingTurn: boolean;
  error: string | null;
  selection: Selection;
  hoverTile: number | null;
  overlay: Overlay;
  panel: Panel;
  buildMode: BuildingType | null;
  report: TurnReport | null;
  introSeen: boolean;
  eventQueue: string[];
  toasts: Toast[];
  settings: Settings;
  focus: { tile: number; nonce: number; zoom?: number } | null;
  /** Previous unit tiles, captured just before a state update, for movement animation. */
  prevUnitTiles: Record<string, number>;
  liveAnnouncement: string;
  aiThinking: string[];

  load(gameId: string): Promise<void>;
  refresh(): Promise<void>;
  applyView(view: GameView): void;
  send(body: CommandBody): Promise<boolean>;
  endTurn(): Promise<void>;
  select(sel: Selection): void;
  setHover(tile: number | null): void;
  setOverlay(o: Overlay): void;
  openPanel(p: Panel): void;
  setBuildMode(b: BuildingType | null): void;
  dismissReport(): void;
  dismissIntro(): void;
  popEvent(): void;
  toast(kind: Toast["kind"], text: string): void;
  dismissToast(id: number): void;
  focusTile(tile: number, zoom?: number): void;
  updateSettings(s: Partial<Settings>): void;
  onPush(p: ServerPush): void;
}

let toastSeq = 0;

export const useGame = create<GameStore>((set, get) => ({
  gameId: null,
  view: null,
  loading: false,
  busy: false,
  endingTurn: false,
  error: null,
  selection: null,
  hoverTile: null,
  overlay: "none",
  panel: null,
  buildMode: null,
  report: null,
  introSeen: false,
  eventQueue: [],
  toasts: [],
  settings: loadSettings(),
  focus: null,
  prevUnitTiles: {},
  liveAnnouncement: "",
  aiThinking: [],

  async load(gameId) {
    set({ loading: true, gameId, error: null });
    try {
      const view = await api.getGame(gameId);
      const capital = view.state.settlements.find((s) => s.ownerId === "player" && s.isCapital) ?? view.state.settlements.find((s) => s.ownerId === "player");
      let introSeen = false;
      try {
        introSeen = window.sessionStorage.getItem(`echoes.intro.${gameId}`) === "1" || view.state.turn > 1;
      } catch {
        introSeen = view.state.turn > 1;
      }
      set({ view, loading: false, introSeen, prevUnitTiles: {}, selection: capital ? { kind: "settlement", id: capital.id } : null });
      if (capital) get().focusTile(capital.tile, 26);
    } catch (e) {
      set({ loading: false, error: e instanceof ApiError ? e.message : "Could not load the campaign." });
    }
  },

  async refresh() {
    const id = get().gameId;
    if (!id) return;
    try {
      get().applyView(await api.getGame(id));
    } catch {
      /* polling errors are non-fatal */
    }
  },

  applyView(view) {
    const prev = get().view;
    const prevUnitTiles: Record<string, number> = {};
    if (prev) for (const u of prev.state.units) prevUnitTiles[u.id] = u.tile;
    // Drop selection if the selected entity no longer exists.
    let selection = get().selection;
    if (selection?.kind === "unit") {
      const id = selection.id;
      if (!view.state.units.some((u) => u.id === id)) selection = null;
    } else if (selection?.kind === "settlement") {
      const id = selection.id;
      if (!view.state.settlements.some((s) => s.id === id)) selection = null;
    }
    set({ view, prevUnitTiles, selection });
  },

  async send(body) {
    const { gameId, view } = get();
    if (!gameId || !view || get().busy) return false;
    set({ busy: true });
    try {
      const r = await api.command(gameId, view.state.turn, body);
      get().applyView(r.view);
      for (const line of r.lines) get().toast(line.startsWith("Discovered") ? "event" : "info", line);
      if (r.lines.length) set({ liveAnnouncement: r.lines.join(" ") });
      return true;
    } catch (e) {
      get().toast("error", e instanceof ApiError ? e.message : "That order could not be given.");
      if (e instanceof ApiError && e.status === 409) await get().refresh();
      return false;
    } finally {
      set({ busy: false });
    }
  },

  async endTurn() {
    const { gameId } = get();
    if (!gameId || get().endingTurn) return;
    set({ endingTurn: true, buildMode: null, aiThinking: [] });
    try {
      const r = await api.endTurn(gameId);
      get().applyView(r.view);
      const newEvents = r.view.state.events.filter((e) => e.turn === r.report.turn && (e.major || e.factionIds.includes("player")));
      set({ report: r.report, eventQueue: newEvents.map((e) => e.id), liveAnnouncement: `Turn ${r.report.turn} complete. ${r.report.lines.slice(0, 4).join(" ")}` });
      if (r.view.ai.message) get().toast("info", r.view.ai.message);
      // Event camera: fly to major happenings unless motion is reduced.
      if (!get().settings.reducedMotion) {
        r.report.focusTiles.forEach((t, i) => setTimeout(() => get().focusTile(t, 22), 600 + i * 1800));
      }
    } catch (e) {
      get().toast("error", e instanceof ApiError ? e.message : "The turn could not be completed.");
      await get().refresh();
    } finally {
      set({ endingTurn: false });
    }
  },

  select(sel) {
    set({ selection: sel, buildMode: null });
  },
  setHover(tile) {
    if (get().hoverTile !== tile) set({ hoverTile: tile });
  },
  setOverlay(o) {
    set({ overlay: get().overlay === o ? "none" : o });
  },
  openPanel(p) {
    set({ panel: get().panel === p ? null : p });
  },
  setBuildMode(b) {
    set({ buildMode: b, panel: null, overlay: b ? "territory" : get().overlay });
  },
  dismissReport() {
    set({ report: null });
  },
  dismissIntro() {
    const id = get().gameId;
    try {
      if (id) window.sessionStorage.setItem(`echoes.intro.${id}`, "1");
    } catch {
      /* ignore */
    }
    set({ introSeen: true });
  },
  popEvent() {
    set({ eventQueue: get().eventQueue.slice(1) });
  },
  toast(kind, text) {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts.slice(-4), { id, kind, text }] });
    setTimeout(() => get().dismissToast(id), kind === "error" ? 7000 : 4500);
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
  focusTile(tile, zoom) {
    set({ focus: { tile, nonce: Date.now() + Math.random(), zoom } });
  },
  updateSettings(s) {
    const settings = { ...get().settings, ...s };
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
    set({ settings });
  },
  onPush(p) {
    switch (p.type) {
      case "ai_decision":
        set({ aiThinking: [...get().aiThinking, `${p.factionId}:${p.source}`] });
        break;
      case "narrative_ready":
      case "image_ready":
        void refreshPresentation();
        break;
      default:
        break;
    }
  },
}));

let presentationTimer: ReturnType<typeof setTimeout> | null = null;
/** Narrative / image arrivals only refresh presentation data, debounced. */
function refreshPresentation(): Promise<void> {
  if (presentationTimer) clearTimeout(presentationTimer);
  return new Promise((resolve) => {
    presentationTimer = setTimeout(async () => {
      const { gameId, view } = useGame.getState();
      if (!gameId || !view) return resolve();
      try {
        const ev = await api.events(gameId, Math.max(1, view.state.turn - 30));
        const cur = useGame.getState().view;
        if (cur) useGame.setState({ view: { ...cur, narratives: ev.narratives, assets: ev.assets, ai: ev.ai } });
      } catch {
        /* non-fatal */
      }
      resolve();
    }, 250);
  });
}
