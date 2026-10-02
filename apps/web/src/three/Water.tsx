"use client";

import type { MapState } from "@echoes/game-types";
import { tileWorldPosition } from "@echoes/procedural-world";
import { useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import { CatmullRomCurve3, Color, ShaderMaterial, TubeGeometry, Vector3 } from "three";
import { mapBounds, tileHeight, WATER_LEVEL } from "./geometry";

const vertex = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorld;
  varying float vWave;
  void main() {
    vec3 p = position;
    float w = sin(p.x * 0.55 + uTime * 0.9) * 0.025 + cos(p.y * 0.42 + uTime * 0.7) * 0.025;
    p.z += w;
    vWave = w;
    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uFoam;
  uniform float uTime;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec3 vWorld;
  varying float vWave;
  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - clamp(viewDir.y, 0.0, 1.0), 2.5);
    float ripple = sin(vWorld.x * 2.1 + uTime * 1.6) * sin(vWorld.z * 1.7 - uTime * 1.2);
    vec3 col = mix(uShallow, uDeep, 0.55 + vWave * 6.0);
    col = mix(col, uFoam, smoothstep(0.86, 1.0, ripple) * 0.18);
    col = mix(col, vec3(0.85, 0.9, 0.95), fres * 0.35);
    float depth = length(cameraPosition - vWorld);
    float fog = smoothstep(uFogNear, uFogFar, depth);
    gl_FragColor = vec4(mix(col, uFogColor, fog), 0.72 + fres * 0.2);
  }
`;

/** Animated stylised water plane. Uniforms are mutated in useFrame — no React state. */
export function Water({ map, fogColor, fogNear, fogFar }: { map: MapState; fogColor: string; fogNear: number; fogFar: number }) {
  const b = mapBounds(map);
  const mat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uTime: { value: 0 },
          uDeep: { value: new Color("#1b4a6b") },
          uShallow: { value: new Color("#3d8ea3") },
          uFoam: { value: new Color("#e8f6f7") },
          uFogColor: { value: new Color(fogColor) },
          uFogNear: { value: fogNear },
          uFogFar: { value: fogFar },
        },
      }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  mat.uniforms.uFogColor!.value.set(fogColor);
  mat.uniforms.uFogNear!.value = fogNear;
  mat.uniforms.uFogFar!.value = fogFar;
  useFrame((_, dt) => {
    mat.uniforms.uTime!.value += dt;
  });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[b.cx, WATER_LEVEL, b.cz]} material={mat}>
      <planeGeometry args={[b.w + 120, b.h + 120, 160, 160]} />
    </mesh>
  );
}

/** Rivers: smooth tubes along downstream tile chains. */
export function Rivers({ map }: { map: MapState }) {
  const geos = useMemo(() => {
    const visited = new Set<number>();
    const out: TubeGeometry[] = [];
    const sources = map.tiles.filter((t) => t.river && t.explored && !map.tiles.some((o) => o.riverTo === t.i && o.explored));
    for (const s of sources) {
      const pts: Vector3[] = [];
      let cur = s;
      let guard = 0;
      while (cur && cur.explored && guard++ < 80) {
        const p = tileWorldPosition(cur.col, cur.row);
        pts.push(new Vector3(p.x, tileHeight(cur) + 0.04, p.z));
        visited.add(cur.i);
        if (cur.riverTo < 0) break;
        const next = map.tiles[cur.riverTo];
        if (!next) break;
        if (!next.river) {
          const q = tileWorldPosition(next.col, next.row);
          pts.push(new Vector3(q.x, Math.max(WATER_LEVEL, tileHeight(next)) + 0.02, q.z));
          break;
        }
        cur = next;
      }
      if (pts.length >= 2) out.push(new TubeGeometry(new CatmullRomCurve3(pts), pts.length * 6, 0.16, 5, false));
    }
    return out;
  }, [map.tiles.map((t) => (t.explored ? 1 : 0)).join("")]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group>
      {geos.map((g, i) => (
        <mesh key={i} geometry={g} receiveShadow>
          <meshStandardMaterial color="#3e8ea8" roughness={0.25} metalness={0.1} emissive="#123848" emissiveIntensity={0.25} />
        </mesh>
      ))}
    </group>
  );
}
