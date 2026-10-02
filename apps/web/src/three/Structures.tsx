"use client";

import type { BuildingType, GameState } from "@echoes/game-types";
import { BUILDING_TYPES } from "@echoes/game-types";
import { tileWorldPosition } from "@echoes/procedural-world";
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { Color, Euler, InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import { tileHeight } from "./geometry";
import { BUILDING_MODELS, POI_PARTS, RESOURCE_COLORS, RESOURCE_MODEL, type Part } from "./models";
import { capacity } from "./Nature";
import { hashTile } from "./palette";

export interface Placement {
  key: string;
  pos: Vector3;
  rotY: number;
  scale: number;
  factionColor: string;
  construction: boolean;
}

const m1 = new Matrix4();
const m2 = new Matrix4();
const q = new Quaternion();
const e = new Euler();
const one = new Vector3(1, 1, 1);
const sv = new Vector3();
const pv = new Vector3();
const scaffold = new Color("#c9a46a");

export function composePartMatrix(out: Matrix4, p: Placement, part: Part): Matrix4 {
  q.setFromEuler(e.set(0, p.rotY, 0));
  m1.compose(p.pos, q, sv.set(p.scale, p.scale * (p.construction ? 0.55 : 1), p.scale));
  q.setFromEuler(e.set(0, part.rotY ?? 0, 0));
  pv.set(...part.pos);
  m2.compose(pv, q, part.scale ? sv.set(...part.scale) : one);
  return out.multiplyMatrices(m1, m2);
}

/** One InstancedMesh per model part, shared by every placement of that model. */
export function PartsLayer({ parts, placements, shadows }: { parts: Part[]; placements: Placement[]; shadows: boolean }) {
  const refs = useRef<(InstancedMesh | null)[]>([]);
  const cap = capacity(placements.length);
  useLayoutEffect(() => {
    const m = new Matrix4();
    const c = new Color();
    parts.forEach((part, pi) => {
      const mesh = refs.current[pi];
      if (!mesh) return;
      placements.forEach((p, i) => {
        mesh.setMatrixAt(i, composePartMatrix(m, p, part));
        c.set(part.color === "faction" ? p.factionColor : part.color);
        if (p.construction) c.lerp(scaffold, 0.65);
        mesh.setColorAt(i, c);
      });
      mesh.count = placements.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
  }, [parts, placements]);
  return (
    <group>
      {parts.map((part, pi) => (
        <instancedMesh key={`${pi}-${cap}`} ref={(r) => { refs.current[pi] = r; }} args={[part.geo, undefined, cap]} castShadow={shadows} receiveShadow frustumCulled={false}>
          <meshStandardMaterial roughness={0.7} metalness={part.metal ?? 0.05} emissive={part.emissive ?? "#000000"} emissiveIntensity={part.emissive ? 0.6 : 0} flatShading />
        </instancedMesh>
      ))}
    </group>
  );
}

function factionColorMap(state: GameState): Record<string, string> {
  return Object.fromEntries(state.factions.map((f) => [f.id, f.color]));
}

export function Buildings({ state, shadows }: { state: GameState; shadows: boolean }) {
  const colors = useMemo(() => factionColorMap(state), [state.factions]); // eslint-disable-line react-hooks/exhaustive-deps
  const byType = useMemo(() => {
    const groups = new Map<BuildingType, Placement[]>();
    for (const t of BUILDING_TYPES) groups.set(t, []);
    for (const b of state.buildings) {
      const tile = state.map.tiles[b.tile];
      if (!tile) continue;
      const w = tileWorldPosition(tile.col, tile.row);
      const settlement = b.type === "settlement_center" ? state.settlements.find((s) => s.tile === b.tile) : null;
      const scale = (settlement ? 1.0 + Math.min(0.6, settlement.population * 0.05) + (state.era >= 3 ? 0.1 : 0) : 1) * 1.25;
      groups.get(b.type)!.push({
        key: b.id,
        pos: new Vector3(w.x, tileHeight(tile), w.z),
        rotY: b.type === "wall" ? 0 : Math.floor(hashTile(b.tile, 3) * 6) * (Math.PI / 3),
        scale,
        factionColor: colors[b.ownerId] ?? "#999999",
        construction: b.turnsRemaining > 0,
      });
    }
    return groups;
  }, [state.buildings, state.settlements, state.map, state.era, colors]);
  return (
    <group>
      {BUILDING_TYPES.map((t) => {
        const list = byType.get(t) ?? [];
        return list.length ? <PartsLayer key={t} parts={BUILDING_MODELS[t]} placements={list} shadows={shadows} /> : null;
      })}
      <Smoke state={state} />
    </group>
  );
}

/** Smoke plumes from workshops and power plants — denser in industrial eras. Animated in useFrame. */
function Smoke({ state }: { state: GameState }) {
  const sources = useMemo(
    () =>
      state.buildings
        .filter((b) => (b.type === "power_plant" || b.type === "workshop") && b.turnsRemaining === 0)
        .map((b) => {
          const t = state.map.tiles[b.tile]!;
          const w = tileWorldPosition(t.col, t.row);
          return new Vector3(w.x, tileHeight(t) + 0.95, w.z);
        }),
    [state.buildings, state.map],
  );
  const ref = useRef<InstancedMesh>(null);
  const puffs = 6;
  const m = useMemo(() => new Matrix4(), []);
  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const time = clock.elapsedTime;
    let i = 0;
    for (const s of sources) {
      for (let k = 0; k < puffs; k++) {
        const phase = (time * 0.25 + k / puffs) % 1;
        const sc = 0.12 + phase * 0.35;
        m.compose(pv.set(s.x + phase * 0.6, s.y + phase * 1.6, s.z - phase * 0.3), q.identity(), sv.setScalar(sc));
        mesh.setMatrixAt(i++, m);
      }
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
  });
  const cap = capacity(sources.length * puffs);
  return (
    <instancedMesh key={cap} ref={ref} args={[undefined, undefined, cap]} frustumCulled={false}>
      <sphereGeometry args={[1, 8, 6]} />
      <meshStandardMaterial color="#8c8a86" transparent opacity={0.35} roughness={1} depthWrite={false} />
    </instancedMesh>
  );
}

export function ResourceNodes({ state }: { state: GameState }) {
  const items = useMemo(() => state.map.tiles.filter((t) => t.resource && t.explored), [state.map]);
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const mm = new Matrix4();
    const c = new Color();
    items.forEach((t, i) => {
      const w = tileWorldPosition(t.col, t.row);
      const water = t.biome === "shallows" || t.biome === "ocean" || t.biome === "lake";
      const y = water ? 0.4 : tileHeight(t) + 0.12;
      const sz = 0.7 + (t.resource!.amount / Math.max(1, t.resource!.initialAmount)) * 0.6;
      mm.compose(pv.set(w.x - 0.42, y, w.z + 0.35), q.setFromEuler(e.set(0.3, hashTile(t.i) * 6, 0)), sv.setScalar(sz));
      mesh.setMatrixAt(i, mm);
      mesh.setColorAt(i, c.set(RESOURCE_COLORS[t.resource!.type]?.color ?? "#ffffff"));
    });
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [items]);
  const cap = capacity(items.length);
  return (
    <instancedMesh key={cap} ref={ref} args={[RESOURCE_MODEL.geo, undefined, cap]} castShadow frustumCulled={false}>
      <meshStandardMaterial roughness={0.35} metalness={0.3} emissive="#3a2a10" emissiveIntensity={0.35} flatShading />
    </instancedMesh>
  );
}

/** Points of interest: ruins as broken pillars, monoliths as black needles, others as plinths. */
export function PointsOfInterest({ state }: { state: GameState }) {
  const items = useMemo(() => state.map.tiles.filter((t) => t.poi && t.explored && !state.settlements.some((s) => s.tile === t.i)), [state.map, state.settlements]);
  return (
    <group>
      {items.map((t) => {
        const w = tileWorldPosition(t.col, t.row);
        const h = tileHeight(t);
        const glow = t.poiDiscovered ? 0.15 : 0.9;
        if (t.poi === "monolith") {
          return (
            <mesh key={t.i} geometry={POI_PARTS.monolith} position={[w.x, h + 0.35, w.z]} castShadow>
              <meshStandardMaterial color="#141418" roughness={0.2} metalness={0.6} emissive="#5a3aa0" emissiveIntensity={glow} />
            </mesh>
          );
        }
        const pillars = [0, 1, 2, 3].map((k) => {
          const a = (k / 4) * Math.PI * 2 + hashTile(t.i);
          const hh = 0.4 + hashTile(t.i, k) * 0.5;
          return (
            <mesh key={k} geometry={POI_PARTS.pillar} position={[w.x + Math.cos(a) * 0.4, h + hh * 0.5 * 0.4 + 0.02, w.z + Math.sin(a) * 0.4]} scale={[1, hh, 1]} castShadow>
              <meshStandardMaterial color={t.poi === "ruins" ? "#6e6760" : "#c4b89c"} roughness={0.9} emissive={t.poi === "ancient_ruin" ? "#c79a3a" : "#000000"} emissiveIntensity={t.poi === "ancient_ruin" ? glow * 0.4 : 0} />
            </mesh>
          );
        });
        return (
          <group key={t.i}>
            <mesh geometry={POI_PARTS.plinth} position={[w.x, h + 0.02, w.z]} scale={[2.6, 1, 2.6]}>
              <meshStandardMaterial color="#8a8070" roughness={1} />
            </mesh>
            {pillars}
          </group>
        );
      })}
    </group>
  );
}
