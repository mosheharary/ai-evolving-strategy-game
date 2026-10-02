"use client";

import type { MapState } from "@echoes/game-types";
import { tileWorldPosition } from "@echoes/procedural-world";
import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { Color, ConeGeometry, CylinderGeometry, DodecahedronGeometry, IcosahedronGeometry, InstancedMesh, Matrix4, Object3D, Quaternion, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { tileHeight } from "./geometry";
import { hashTile } from "./palette";

/** Merge a cone crown + cylinder trunk into one geometry per tree style (one draw call per style). */
function makePine(segments: number) {
  const crown = new ConeGeometry(0.28, 0.9, segments);
  crown.translate(0, 0.65, 0);
  const crown2 = new ConeGeometry(0.22, 0.6, segments);
  crown2.translate(0, 1.0, 0);
  const trunk = new CylinderGeometry(0.05, 0.07, 0.3, 5);
  trunk.translate(0, 0.15, 0);
  return mergeGeometries([crown.toNonIndexed(), crown2.toNonIndexed(), trunk.toNonIndexed()])!;
}
function makeBroadleaf(detail: number) {
  const crown = new IcosahedronGeometry(0.34, detail);
  crown.translate(0, 0.7, 0);
  const trunk = new CylinderGeometry(0.05, 0.08, 0.45, 5);
  trunk.translate(0, 0.22, 0);
  return mergeGeometries([crown.toNonIndexed(), trunk.toNonIndexed()])!;
}

interface TreeInstance {
  pos: Vector3;
  scale: number;
  rot: number;
  color: Color;
}

function treeInstances(map: MapState, kind: "pine" | "broad"): TreeInstance[] {
  const out: TreeInstance[] = [];
  for (const t of map.tiles) {
    if (t.forest < 8 || !t.explored) continue;
    const isPine = t.biome === "taiga" || t.biome === "hills" || t.biome === "snow" || (t.biome === "forest" && hashTile(t.i, 7) < 0.3);
    if ((kind === "pine") !== isPine) continue;
    const n = Math.min(6, Math.round(t.forest / 17));
    const base = tileWorldPosition(t.col, t.row);
    const h = tileHeight(t);
    for (let k = 0; k < n; k++) {
      const a = hashTile(t.i, k * 3 + 1) * Math.PI * 2;
      const r = 0.15 + hashTile(t.i, k * 3 + 2) * 0.65;
      const scale = 0.7 + hashTile(t.i, k * 3 + 3) * 0.6;
      const color = new Color(isPine ? "#2f5a3a" : "#4f7f3a").offsetHSL((hashTile(t.i, k) - 0.5) * 0.05, 0, (hashTile(t.i, k + 9) - 0.5) * 0.12);
      if (t.pollution > 20) color.lerp(new Color("#6b5a3e"), Math.min(0.6, t.pollution / 90));
      if (t.biome === "scrubland") color.lerp(new Color("#7a6a3a"), 0.4);
      out.push({ pos: new Vector3(base.x + Math.cos(a) * r, h, base.z + Math.sin(a) * r), scale, rot: a, color });
    }
  }
  return out;
}

const tmpObj = new Object3D();
/** Instanced capacity bucket — the mesh is remounted (via key) only when it outgrows its buffer. */
export const capacity = (n: number): number => Math.max(64, Math.ceil(n / 256) * 256);

function useInstances(ref: React.RefObject<InstancedMesh | null>, items: TreeInstance[]) {
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    items.forEach((it, i) => {
      tmpObj.position.copy(it.pos);
      tmpObj.rotation.set(0, it.rot, 0);
      tmpObj.scale.setScalar(it.scale);
      tmpObj.updateMatrix();
      mesh.setMatrixAt(i, tmpObj.matrix);
      mesh.setColorAt(i, it.color);
    });
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [ref, items]);
}

/**
 * Forests: instanced trees with procedural variation (scale/rotation/tint). LOD: when the
 * camera is far away we swap to low-poly geometries (checked a few times per second via refs).
 */
export function Forests({ map, shadows }: { map: MapState; shadows: boolean }) {
  const sig = useMemo(() => map.tiles.map((t) => (t.explored ? Math.round(t.forest / 17) : 0)).join("") + map.tiles.map((t) => Math.round(t.pollution / 20)).join(""), [map]);
  const pines = useMemo(() => treeInstances(map, "pine"), [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const broads = useMemo(() => treeInstances(map, "broad"), [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const geo = useMemo(() => ({ pineHi: makePine(7), pineLo: makePine(4), broadHi: makeBroadleaf(1), broadLo: makeBroadleaf(0) }), []);
  const pineRef = useRef<InstancedMesh>(null);
  const broadRef = useRef<InstancedMesh>(null);
  useInstances(pineRef, pines);
  useInstances(broadRef, broads);
  const { camera } = useThree();
  const lod = useRef<"hi" | "lo">("hi");
  const acc = useRef(0);
  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current < 0.3) return;
    acc.current = 0;
    const next = camera.position.y > 42 ? "lo" : "hi";
    if (next !== lod.current) {
      lod.current = next;
      if (pineRef.current) pineRef.current.geometry = next === "hi" ? geo.pineHi : geo.pineLo;
      if (broadRef.current) broadRef.current.geometry = next === "hi" ? geo.broadHi : geo.broadLo;
    }
  });
  return (
    <group>
      <instancedMesh key={`p${capacity(pines.length)}`} ref={pineRef} args={[geo.pineHi, undefined, capacity(pines.length)]} castShadow={shadows} receiveShadow frustumCulled={false}>
        <meshStandardMaterial roughness={0.85} flatShading />
      </instancedMesh>
      <instancedMesh key={`b${capacity(broads.length)}`} ref={broadRef} args={[geo.broadHi, undefined, capacity(broads.length)]} castShadow={shadows} receiveShadow frustumCulled={false}>
        <meshStandardMaterial roughness={0.85} flatShading />
      </instancedMesh>
    </group>
  );
}

/** Mountains and hills: instanced craggy rock clusters with snow caps on high peaks. */
export function Rocks({ map, shadows }: { map: MapState; shadows: boolean }) {
  const items = useMemo(() => {
    const out: { pos: Vector3; scale: Vector3; rot: number; color: Color }[] = [];
    for (const t of map.tiles) {
      if (!t.explored) continue;
      const mountain = t.biome === "mountain" || t.biome === "snow";
      if (!mountain && t.biome !== "hills" && t.biome !== "ashland") continue;
      const base = tileWorldPosition(t.col, t.row);
      const h = tileHeight(t);
      const n = mountain ? 3 : t.biome === "ashland" ? 1 : 2;
      for (let k = 0; k < n; k++) {
        const a = hashTile(t.i, k + 21) * Math.PI * 2;
        const r = k === 0 ? 0 : 0.35 + hashTile(t.i, k + 22) * 0.3;
        const big = mountain ? (k === 0 ? 1.2 + hashTile(t.i, 5) * 0.6 : 0.6) : 0.35;
        const color = new Color(t.biome === "snow" || (mountain && t.elevation > 0.88) ? "#e9edf0" : t.biome === "ashland" ? "#3f3a36" : "#7a6f63");
        color.offsetHSL(0, 0, (hashTile(t.i, k + 40) - 0.5) * 0.1);
        out.push({ pos: new Vector3(base.x + Math.cos(a) * r, h - 0.05, base.z + Math.sin(a) * r), scale: new Vector3(big * 0.9, big * (mountain ? 1.5 : 0.7), big * 0.9), rot: a, color });
      }
    }
    return out;
  }, [map.tiles.map((t) => `${t.biome}${t.explored ? 1 : 0}`).join("")]); // eslint-disable-line react-hooks/exhaustive-deps
  const geo = useMemo(() => new DodecahedronGeometry(0.6, 0), []);
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new Matrix4();
    const q = new Quaternion();
    items.forEach((it, i) => {
      q.setFromAxisAngle(new Vector3(0, 1, 0), it.rot);
      m.compose(it.pos, q, it.scale);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, it.color);
    });
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);
  return (
    <instancedMesh key={capacity(items.length)} ref={ref} args={[geo, undefined, capacity(items.length)]} castShadow={shadows} receiveShadow frustumCulled={false}>
      <meshStandardMaterial roughness={0.95} flatShading />
    </instancedMesh>
  );
}
