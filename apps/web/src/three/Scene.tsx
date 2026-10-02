"use client";

import type { GameState } from "@echoes/game-types";
import { PLAYER_ID } from "@echoes/game-types";
import { canBuild, reachableTiles, unitLegalActions } from "@echoes/game-engine";
import { handleTileClick, handleTileContext } from "@/lib/interaction";
import { getGrid } from "@echoes/procedural-world";
import { AdaptiveDpr, PerformanceMonitor } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import { ACESFilmicToneMapping, type DirectionalLight, type Object3D, Vector3 } from "three";
import { useGame } from "@/store/gameStore";
import { CameraRig } from "./CameraRig";
import { mapBounds } from "./geometry";
import { Forests, Rocks } from "./Nature";
import { Borders, EventBeacons, HexHighlight, OverlayTiles, SettlementLabelProjector, tileTop, type OverlayTile } from "./Overlays";
import { ERA_GRADES } from "./palette";
import { Buildings, PointsOfInterest, ResourceNodes } from "./Structures";
import { Terrain } from "./Terrain";
import { Units } from "./Units";
import { Rivers, Water } from "./Water";
import { RESOURCE_COLORS } from "./models";

function relationStatus(state: GameState, a: string, b: string): string {
  const [x, y] = a < b ? [a, b] : [b, a];
  return state.relations.find((r) => r.key === `${x}|${y}`)?.status ?? "peace";
}

function useOverlayTiles(state: GameState): { tiles: OverlayTile[]; opacity: number } {
  const selection = useGame((s) => s.selection);
  const buildMode = useGame((s) => s.buildMode);
  const overlay = useGame((s) => s.overlay);
  return useMemo(() => {
    const out: OverlayTile[] = [];
    if (buildMode) {
      for (const t of state.map.tiles) if (t.ownerId === PLAYER_ID && canBuild(state, PLAYER_ID, buildMode, t.i) === null) out.push({ tile: t.i, color: "#6ee59a" });
      return { tiles: out, opacity: 0.45 };
    }
    if (selection?.kind === "unit") {
      const legal = unitLegalActions(state, selection.id);
      if (legal) {
        for (const m of legal.moves) out.push({ tile: m.tile, color: "#7fd3ff" });
        for (const a of legal.attacks) out.push({ tile: a.tile, color: "#ff5a4a" });
        return { tiles: out, opacity: 0.4 };
      }
    }
    const colors = Object.fromEntries(state.factions.map((f) => [f.id, f.color]));
    switch (overlay) {
      case "territory":
        for (const t of state.map.tiles) if (t.ownerId && t.explored) out.push({ tile: t.i, color: colors[t.ownerId] ?? "#999" });
        return { tiles: out, opacity: 0.32 };
      case "resources":
        for (const t of state.map.tiles) if (t.resource && t.explored) out.push({ tile: t.i, color: RESOURCE_COLORS[t.resource.type]?.color ?? "#fff" });
        for (const t of state.map.tiles) if (t.poi && t.explored) out.push({ tile: t.i, color: "#ffd36b" });
        return { tiles: out, opacity: 0.55 };
      case "movement": {
        const seen = new Set<number>();
        for (const u of state.units) if (u.ownerId === PLAYER_ID) for (const tile of reachableTiles(state, u).keys()) if (!seen.has(tile)) { seen.add(tile); out.push({ tile, color: "#7fd3ff" }); }
        return { tiles: out, opacity: 0.35 };
      }
      case "danger": {
        const grid = getGrid(state.map.width, state.map.height);
        const level = new Map<number, number>();
        for (const u of state.units) {
          if (u.ownerId === PLAYER_ID || u.type === "worker" || u.type === "explorer") continue;
          const f = state.factions.find((x) => x.id === u.ownerId);
          const hostile = relationStatus(state, PLAYER_ID, u.ownerId) === "war" ? 1 : (f?.opinions[PLAYER_ID] ?? 0) < -40 ? 0.5 : 0;
          if (!hostile) continue;
          for (const i of grid.within(u.tile, 3)) level.set(i, Math.max(level.get(i) ?? 0, hostile * (1 - grid.distance(u.tile, i) / 4)));
        }
        for (const [tile, v] of level) out.push({ tile, color: v > 0.6 ? "#ff3b30" : v > 0.3 ? "#ff8a3d" : "#ffc24a" });
        return { tiles: out, opacity: 0.4 };
      }
      case "diplomacy":
        for (const t of state.map.tiles) {
          if (!t.ownerId || !t.explored) continue;
          if (t.ownerId === PLAYER_ID) { out.push({ tile: t.i, color: "#36c2b4" }); continue; }
          const op = state.factions.find((f) => f.id === t.ownerId)?.opinions[PLAYER_ID] ?? 0;
          const status = relationStatus(state, PLAYER_ID, t.ownerId);
          out.push({ tile: t.i, color: status === "war" ? "#ff2d2d" : status === "alliance" ? "#3cff8a" : op > 25 ? "#9be36b" : op < -25 ? "#ff8a5a" : "#e8d36a" });
        }
        return { tiles: out, opacity: 0.38 };
      default:
        return { tiles: out, opacity: 0.4 };
    }
  }, [state, selection, buildMode, overlay]);
}

/** Development/test hook: exposes the scene graph for debugging and e2e assertions. */
function DebugHook() {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || (typeof window !== "undefined" && window.location.search.includes("debug=1"))) {
      (window as unknown as { __echoesScene?: unknown }).__echoesScene = scene;
    }
  }, [scene]);
  return null;
}

function World({ state }: { state: GameState }) {
  const settings = useGame((s) => s.settings);
  const selection = useGame((s) => s.selection);
  const hoverTile = useGame((s) => s.hoverTile);
  const prevUnitTiles = useGame((s) => s.prevUnitTiles);
  const overlay = useOverlayTiles(state);
  const grade = ERA_GRADES[Math.min(ERA_GRADES.length - 1, state.era - 1)]!;
  const b = mapBounds(state.map);
  const center = useMemo(() => new Vector3(b.cx, 0, b.cz), [b.cx, b.cz]);
  const light = useRef<DirectionalLight>(null);
  const target = useRef<Object3D>(null);
  useEffect(() => {
    if (light.current && target.current) light.current.target = target.current;
  }, []);

  const selectedTile = selection?.kind === "tile" ? selection.tile
    : selection?.kind === "unit" ? state.units.find((u) => u.id === selection.id)?.tile ?? null
      : selection?.kind === "settlement" ? state.settlements.find((s) => s.id === selection.id)?.tile ?? null : null;

  return (
    <>
      <color attach="background" args={[grade.sky]} />
      <fog attach="fog" args={[grade.fog, grade.fogNear, grade.fogFar]} />
      <hemisphereLight args={[grade.ambient, "#3b3428", 0.9]} />
      <object3D ref={target} position={[b.cx, 0, b.cz]} />
      <directionalLight
        ref={light}
        position={[b.cx + 30, 55, b.cz - 25]}
        intensity={grade.sunIntensity}
        color={grade.sun}
        castShadow={settings.shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-camera-left={-b.w * 0.6}
        shadow-camera-right={b.w * 0.6}
        shadow-camera-top={b.h * 0.6}
        shadow-camera-bottom={-b.h * 0.6}
        shadow-camera-far={200}
      />
      <CameraRig center={center} bounds={b} focusPoint={(tile) => (state.map.tiles[tile] ? tileTop(state, tile) : null)} />
      <MapInteraction state={state} highContrast={settings.highContrast} shadows={settings.shadows} />
      <Water map={state.map} fogColor={grade.fog} fogNear={grade.fogNear} fogFar={grade.fogFar} />
      <Rivers map={state.map} />
      <Forests map={state.map} shadows={settings.shadows} />
      <Rocks map={state.map} shadows={settings.shadows} />
      <ResourceNodes state={state} />
      <PointsOfInterest state={state} />
      <Buildings state={state} shadows={settings.shadows} />
      <Units state={state} prevTiles={prevUnitTiles} reducedMotion={settings.reducedMotion} shadows={settings.shadows} />
      <Borders state={state} />
      <OverlayTiles state={state} tiles={overlay.tiles} opacity={overlay.opacity} />
      <EventBeacons state={state} />
      <HexHighlight state={state} tile={hoverTile} color="#ffffff" pulse={false} />
      <HexHighlight state={state} tile={selectedTile} color="#ffd36b" pulse={!settings.reducedMotion} />
      <SettlementLabelProjector state={state} />
      {settings.postFx ? (
        <EffectComposer multisampling={4}>
          <Bloom luminanceThreshold={0.82} luminanceSmoothing={0.2} intensity={0.45} mipmapBlur />
          <Vignette eskil={false} offset={0.22} darkness={0.55} />
        </EffectComposer>
      ) : null}
    </>
  );
}

/** Pointer → game intent. Clicks become validated commands on the server. */
function MapInteraction({ state, highContrast, shadows }: { state: GameState; highContrast: boolean; shadows: boolean }) {
  return <Terrain map={state.map} highContrast={highContrast} shadows={shadows} onHover={(t) => useGame.getState().setHover(t)} onClick={handleTileClick} onContext={handleTileContext} />;
}

export default function GameScene() {
  const view = useGame((s) => s.view);
  const [dpr, setDpr] = useState(1.5);
  if (!view) return null;
  return (
    <Canvas
      shadows
      dpr={dpr}
      gl={{ antialias: true, powerPreference: "high-performance", toneMapping: ACESFilmicToneMapping }}
      camera={{ fov: 42, near: 0.5, far: 400, position: [40, 46, 70] }}
      aria-label="3D strategic map"
      role="img"
    >
      <PerformanceMonitor onDecline={() => setDpr(1)} onIncline={() => setDpr(1.5)} />
      <AdaptiveDpr pixelated={false} />
      <World state={view.state} />
      <DebugHook />
    </Canvas>
  );
}
