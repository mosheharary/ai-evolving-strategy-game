"use client";

import type { GameState, Unit, UnitType } from "@echoes/game-types";
import { UNIT_TYPES } from "@echoes/game-types";
import { tileWorldPosition } from "@echoes/procedural-world";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Color, InstancedMesh, Matrix4, Vector3 } from "three";
import { tileHeight } from "./geometry";
import { UNIT_MODELS } from "./models";
import { capacity } from "./Nature";
import { composePartMatrix, type Placement } from "./Structures";

interface Anim {
  from: Vector3;
  to: Vector3;
  start: number;
  duration: number;
}

function worldOf(state: GameState, tile: number): Vector3 {
  const t = state.map.tiles[tile]!;
  const w = tileWorldPosition(t.col, t.row);
  return new Vector3(w.x + 0.32, tileHeight(t), w.z - 0.2);
}

/**
 * Units are instanced per (type, part). Movement is animated purely in useFrame by
 * interpolating between the previous and current tiles — no React state per frame.
 */
export function Units({ state, prevTiles, reducedMotion, shadows }: { state: GameState; prevTiles: Record<string, number>; reducedMotion: boolean; shadows: boolean }) {
  const colors = useMemo(() => Object.fromEntries(state.factions.map((f) => [f.id, f.color])), [state.factions]);
  const anims = useRef(new Map<string, Anim>());
  const played = useRef(new Set<string>());
  const byType = useMemo(() => {
    const g = new Map<UnitType, Unit[]>();
    for (const t of UNIT_TYPES) g.set(t, []);
    for (const u of state.units) g.get(u.type)!.push(u);
    return g;
  }, [state.units]);

  // Start animations for units whose tile changed (own moves via prevTiles; AI moves via prevTile).
  useEffect(() => {
    const now = performance.now();
    for (const u of state.units) {
      const from = prevTiles[u.id] ?? (u.prevTile !== u.tile ? u.prevTile : undefined);
      if (from === undefined || from === u.tile || reducedMotion) continue;
      const moveKey = `${u.id}:${from}>${u.tile}@${state.turn}`;
      if (played.current.has(moveKey)) continue;
      played.current.add(moveKey);
      const dist = worldOf(state, from).distanceTo(worldOf(state, u.tile));
      anims.current.set(u.id, { from: worldOf(state, from), to: worldOf(state, u.tile), start: now, duration: Math.min(1400, 350 + dist * 120) });
    }
  }, [state.units]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <group>
      {UNIT_TYPES.map((t) => {
        const list = byType.get(t) ?? [];
        return list.length ? <UnitTypeLayer key={t} type={t} units={list} state={state} colors={colors} anims={anims.current} shadows={shadows} reducedMotion={reducedMotion} /> : null;
      })}
    </group>
  );
}

function UnitTypeLayer({ type, units, state, colors, anims, shadows, reducedMotion }: {
  type: UnitType; units: Unit[]; state: GameState; colors: Record<string, string>; anims: Map<string, Anim>; shadows: boolean; reducedMotion: boolean;
}) {
  const parts = UNIT_MODELS[type];
  const refs = useRef<(InstancedMesh | null)[]>([]);
  const cap = capacity(units.length);
  const targets = useMemo(() => units.map((u) => worldOf(state, u.tile)), [units, state.map]); // eslint-disable-line react-hooks/exhaustive-deps
  const placement = useMemo<Placement>(() => ({ key: "", pos: new Vector3(), rotY: 0, scale: 1, factionColor: "#fff", construction: false }), []);
  const m = useMemo(() => new Matrix4(), []);

  useEffect(() => {
    const c = new Color();
    parts.forEach((part, pi) => {
      const mesh = refs.current[pi];
      if (!mesh) return;
      units.forEach((u, i) => {
        c.set(part.color === "faction" ? colors[u.ownerId] ?? "#ccc" : part.color);
        if (u.hp < u.maxHp * 0.4) c.lerp(new Color("#5a2020"), 0.35);
        mesh.setColorAt(i, c);
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }, [units, colors, parts]);

  useFrame(({ clock }) => {
    const now = performance.now();
    const time = clock.elapsedTime;
    units.forEach((u, i) => {
      const a = anims.get(u.id);
      let pos = targets[i]!;
      let moving = false;
      if (a) {
        const k = Math.min(1, (now - a.start) / a.duration);
        const eased = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        pos = placement.pos.copy(a.from).lerp(a.to, eased);
        pos.y += Math.sin(k * Math.PI) * 0.35;
        moving = k < 1;
        if (k >= 1) anims.delete(u.id);
        placement.rotY = Math.atan2(a.to.x - a.from.x, a.to.z - a.from.z);
      } else {
        placement.rotY = (i * 1.3) % (Math.PI * 2);
      }
      placement.pos.copy(pos);
      if (!reducedMotion && !moving) placement.pos.y += Math.abs(Math.sin(time * 2.2 + i)) * 0.03;
      placement.scale = (u.status === "fortified" ? 1.05 : 1) * 2.3;
      parts.forEach((part, pi) => {
        const mesh = refs.current[pi];
        if (mesh) mesh.setMatrixAt(i, composePartMatrix(m, placement, part));
      });
    });
    for (const mesh of refs.current) {
      if (!mesh) continue;
      mesh.count = units.length;
      mesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group>
      {parts.map((part, pi) => (
        <instancedMesh key={`${pi}-${cap}`} ref={(r) => { refs.current[pi] = r; }} args={[part.geo, undefined, cap]} castShadow={shadows} frustumCulled={false}>
          <meshStandardMaterial roughness={0.6} metalness={part.metal ?? 0.05} flatShading />
        </instancedMesh>
      ))}
    </group>
  );
}
