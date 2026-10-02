"use client";

import type { GameState } from "@echoes/game-types";
import { getGrid, tileWorldPosition } from "@echoes/procedural-world";
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { AdditiveBlending, BufferAttribute, BufferGeometry, CircleGeometry, Color, InstancedMesh, LineBasicMaterial, Matrix4, Mesh, RingGeometry, Vector3 } from "three";
import { tileHeight } from "./geometry";
import { capacity } from "./Nature";
import { labelElements } from "./labelRegistry";

const HEX_CIRCLE = (() => {
  const g = new CircleGeometry(0.93, 6);
  g.rotateX(-Math.PI / 2);
  g.rotateY(Math.PI / 6);
  return g;
})();
const HEX_RING = (() => {
  const g = new RingGeometry(0.82, 0.98, 6);
  g.rotateX(-Math.PI / 2);
  g.rotateY(Math.PI / 6);
  return g;
})();

export function tileTop(state: GameState, i: number): Vector3 {
  const t = state.map.tiles[i]!;
  const w = tileWorldPosition(t.col, t.row);
  return new Vector3(w.x, Math.max(tileHeight(t), 0.33) + 0.03, w.z);
}

/** Animated hex outline for hover / selection. */
export function HexHighlight({ state, tile, color, pulse }: { state: GameState; tile: number | null; color: string; pulse: boolean }) {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const s = pulse ? 1 + Math.sin(clock.elapsedTime * 4) * 0.04 : 1;
    ref.current.scale.setScalar(s);
  });
  if (tile === null || !state.map.tiles[tile]) return null;
  const p = tileTop(state, tile);
  return (
    <mesh ref={ref} geometry={HEX_RING} position={[p.x, p.y + 0.02, p.z]} renderOrder={5}>
      <meshBasicMaterial color={color} transparent opacity={0.95} depthTest={false} />
    </mesh>
  );
}

export interface OverlayTile {
  tile: number;
  color: string;
  opacity?: number;
}

/** Instanced translucent hex discs (movement range, attack targets, build sites, map overlays). */
export function OverlayTiles({ state, tiles, opacity = 0.42 }: { state: GameState; tiles: OverlayTile[]; opacity?: number }) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new Matrix4();
    const c = new Color();
    tiles.forEach((o, i) => {
      const p = tileTop(state, o.tile);
      m.makeTranslation(p.x, p.y, p.z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.set(o.color));
    });
    mesh.count = tiles.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [tiles, state.map]); // eslint-disable-line react-hooks/exhaustive-deps
  const cap = capacity(tiles.length);
  return (
    <instancedMesh key={cap} ref={ref} args={[HEX_CIRCLE, undefined, cap]} frustumCulled={false} renderOrder={3}>
      <meshBasicMaterial transparent opacity={opacity} depthWrite={false} toneMapped={false} />
    </instancedMesh>
  );
}

/** Territory borders: line segments on hex edges where ownership changes, in faction colour. */
export function Borders({ state }: { state: GameState }) {
  const geo = useMemo(() => {
    const grid = getGrid(state.map.width, state.map.height);
    const colors = Object.fromEntries(state.factions.map((f) => [f.id, new Color(f.color)]));
    const pos: number[] = [];
    const col: number[] = [];
    const corners = Array.from({ length: 6 }, (_, k) => {
      const a = (Math.PI / 180) * (60 * k - 30);
      return [Math.cos(a) * 0.97, Math.sin(a) * 0.97] as const;
    });
    for (const t of state.map.tiles) {
      if (!t.ownerId || !t.explored) continue;
      const c = colors[t.ownerId];
      if (!c) continue;
      const w = tileWorldPosition(t.col, t.row);
      const y = Math.max(tileHeight(t), 0.33) + 0.05;
      // Edge k lies between corners k and k+1; find the neighbour across it by position.
      for (let k = 0; k < 6; k++) {
        const [ax, az] = corners[k]!;
        const [bx, bz] = corners[(k + 1) % 6]!;
        const mx = w.x + (ax + bx) * 0.9;
        const mz = w.z + (az + bz) * 0.9;
        const nb = grid.neighbors(t.i).find((n) => {
          const nt = state.map.tiles[n]!;
          const nw = tileWorldPosition(nt.col, nt.row);
          return Math.hypot(nw.x - mx, nw.z - mz) < 0.6;
        });
        const other = nb !== undefined ? state.map.tiles[nb]!.ownerId : null;
        if (other === t.ownerId) continue;
        pos.push(w.x + ax, y, w.z + az, w.x + bx, y, w.z + bz);
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
    return g;
  }, [state.map, state.factions]);
  const mat = useMemo(() => new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, toneMapped: false }), []);
  return <lineSegments geometry={geo} material={mat} renderOrder={4} />;
}

const PALETTE_COLORS: Record<string, string> = { fire: "#ff7a3d", water: "#59b8ff", earth: "#d8b26a", life: "#7ee08a", gold: "#ffd36b", shadow: "#a59cff", arcane: "#d29bff" };

/** Pulsing light beams over active world events — visible from afar, draws the eye. */
export function EventBeacons({ state }: { state: GameState }) {
  const events = state.events.filter((e) => e.status === "active" || e.turn >= state.turn - 1).filter((e) => state.map.tiles[e.centerTile]?.explored);
  const group = useRef<Mesh[]>([]);
  useFrame(({ clock }) => {
    group.current.forEach((m, i) => {
      if (!m) return;
      const s = 1 + Math.sin(clock.elapsedTime * 2 + i) * 0.15;
      m.scale.set(s, 1, s);
    });
  });
  return (
    <group>
      {events.map((e, i) => {
        const p = tileTop(state, e.centerTile);
        const color = PALETTE_COLORS[e.visual.palette] ?? "#ffffff";
        return (
          <group key={e.id} position={[p.x, p.y, p.z]}>
            <mesh ref={(r) => { if (r) group.current[i] = r; }} position={[0, 2.2, 0]}>
              <cylinderGeometry args={[0.12, 0.35, 4.4, 10, 1, true]} />
              <meshBasicMaterial color={color} transparent opacity={0.28} blending={AdditiveBlending} depthWrite={false} />
            </mesh>
            <mesh geometry={HEX_RING} position={[0, 0.04, 0]} scale={1.15}>
              <meshBasicMaterial color={color} transparent opacity={0.8} toneMapped={false} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/** Projects settlement positions to screen space each frame and moves the DOM labels. */
export function SettlementLabelProjector({ state }: { state: GameState }) {
  const points = useMemo(() => state.settlements.map((s) => ({ id: s.id, p: tileTop(state, s.tile).add(new Vector3(0, 1.2, 0)) })), [state.settlements, state.map]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const { id, p } of points) {
      const el = labelElements.get(id);
      if (!el) continue;
      v.copy(p).project(camera);
      const visible = v.z < 1 && v.x > -1.1 && v.x < 1.1 && v.y > -1.1 && v.y < 1.1;
      if (!visible) {
        el.style.display = "none";
        continue;
      }
      const dist = camera.position.distanceTo(p);
      const scale = Math.max(0.55, Math.min(1.15, 28 / dist));
      el.style.display = "";
      el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px) scale(${scale})`;
    }
  });
  return null;
}
