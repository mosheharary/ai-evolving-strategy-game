"use client";

import type { MapState } from "@echoes/game-types";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { DoubleSide, type BufferGeometry } from "three";
import { buildChunk, chunkSignature, chunkTiles, type ChunkGeometry } from "./geometry";

interface Props {
  map: MapState;
  highContrast: boolean;
  shadows: boolean;
  onHover: (tile: number | null) => void;
  onClick: (tile: number, e: ThreeEvent<MouseEvent>) => void;
  onContext: (tile: number) => void;
}

/**
 * Terrain = chunked merged hex-prism meshes. Chunks are frustum-culled by three.js
 * and only rebuilt when their visual signature (biome / fog / pollution) changes.
 */
export function Terrain({ map, highContrast, shadows, onHover, onClick, onContext }: Props) {
  const chunks = useMemo(() => chunkTiles(map), [map.width, map.height]); // eslint-disable-line react-hooks/exhaustive-deps
  const cache = useRef(new Map<number, { sig: string; geo: ChunkGeometry }>());
  const built = chunks.map((tiles, idx) => {
    const sig = `${chunkSignature(map, tiles)}|${highContrast}`;
    const cached = cache.current.get(idx);
    if (cached && cached.sig === sig) return cached.geo;
    cached?.geo.geometry.dispose();
    const geo = buildChunk(map, tiles, { highContrast });
    cache.current.set(idx, { sig, geo });
    return geo;
  });

  useEffect(() => () => {
    for (const c of cache.current.values()) c.geo.geometry.dispose();
    cache.current.clear();
  }, []);

  return (
    <group>
      {built.map((c, idx) => (
        <ChunkMesh key={idx} chunk={c} shadows={shadows} onHover={onHover} onClick={onClick} onContext={onContext} />
      ))}
    </group>
  );
}

function ChunkMesh({ chunk, shadows, onHover, onClick, onContext }: { chunk: ChunkGeometry; shadows: boolean } & Pick<Props, "onHover" | "onClick" | "onContext">) {
  const tileOf = (e: ThreeEvent<PointerEvent | MouseEvent>): number | null => {
    if (e.faceIndex === undefined || e.faceIndex === null) return null;
    return chunk.faceToTile[e.faceIndex] ?? null;
  };
  return (
    <mesh
      geometry={chunk.geometry as BufferGeometry}
      receiveShadow={shadows}
      onPointerMove={(e) => {
        e.stopPropagation();
        onHover(tileOf(e));
      }}
      onPointerOut={() => onHover(null)}
      onClick={(e) => {
        e.stopPropagation();
        const t = tileOf(e);
        if (t !== null && e.delta < 6) onClick(t, e);
      }}
      onContextMenu={(e) => {
        e.stopPropagation();
        e.nativeEvent.preventDefault();
        const t = tileOf(e);
        if (t !== null) onContext(t);
      }}
    >
      <meshStandardMaterial vertexColors roughness={0.92} metalness={0.02} side={DoubleSide} />
    </mesh>
  );
}
