import type { MapState, Tile } from "@echoes/game-types";
import { tileWorldPosition } from "@echoes/procedural-world";
import { BufferAttribute, BufferGeometry, Color } from "three";
import { tileColor } from "./palette";

export const WATER_LEVEL = 0.32;
const SEA = 0.34;

/** Visual height of a tile's top surface. */
export function tileHeight(t: Pick<Tile, "biome" | "elevation">): number {
  switch (t.biome) {
    case "ocean":
      return 0.02;
    case "shallows":
      return 0.18;
    case "lake":
      return 0.2;
    default: {
      let h = 0.4 + Math.max(0, t.elevation - SEA) * 2.0;
      if (t.biome === "hills") h += 0.25;
      if (t.biome === "mountain" || t.biome === "snow") h += 0.55;
      return h;
    }
  }
}

export function tileCenter(map: MapState, i: number): [number, number, number] {
  const t = map.tiles[i]!;
  const p = tileWorldPosition(t.col, t.row);
  return [p.x, tileHeight(t), p.z];
}

export function mapBounds(map: MapState): { cx: number; cz: number; w: number; h: number } {
  const last = tileWorldPosition(map.width - 1, map.height - 1);
  return { cx: last.x / 2, cz: last.z / 2, w: last.x + 2, h: last.z + 2 };
}

const CORNERS: [number, number][] = Array.from({ length: 6 }, (_, k) => {
  const a = (Math.PI / 180) * (60 * k - 30);
  return [Math.cos(a), Math.sin(a)];
});

export interface ChunkGeometry {
  geometry: BufferGeometry;
  /** triangle index → tile index (for raycast picking) */
  faceToTile: Int32Array;
  tiles: number[];
}

/**
 * Build one merged geometry for a chunk of hex prisms. Each hex top is a 6-triangle
 * fan (centre slightly lighter → soft painterly hex shading) plus 6 side quads.
 */
export function buildChunk(map: MapState, tiles: number[], opts: { highContrast: boolean }): ChunkGeometry {
  const triPerTile = 6 + 12;
  const triCount = tiles.length * triPerTile;
  const pos = new Float32Array(triCount * 9);
  const nor = new Float32Array(triCount * 9);
  const col = new Float32Array(triCount * 9);
  const faceToTile = new Int32Array(triCount);
  const c = new Color();
  const cEdge = new Color();
  const cCenter = new Color();
  const cSide = new Color();
  let v = 0;
  let f = 0;
  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number, color: Color): void => {
    pos[v * 3] = x;
    pos[v * 3 + 1] = y;
    pos[v * 3 + 2] = z;
    nor[v * 3] = nx;
    nor[v * 3 + 1] = ny;
    nor[v * 3 + 2] = nz;
    col[v * 3] = color.r;
    col[v * 3 + 1] = color.g;
    col[v * 3 + 2] = color.b;
    v++;
  };
  const R = 1.0;
  for (const i of tiles) {
    const t = map.tiles[i]!;
    const { x, z } = tileWorldPosition(t.col, t.row);
    const h = tileHeight(t);
    tileColor(t.biome, i, t.pollution, t.explored, opts.highContrast, c);
    cCenter.copy(c).offsetHSL(0, 0.02, 0.035);
    cEdge.copy(c).offsetHSL(0, -0.02, -0.04);
    cSide.copy(c).multiplyScalar(0.62);
    for (let k = 0; k < 6; k++) {
      const [ax, az] = CORNERS[k]!;
      const [bx, bz] = CORNERS[(k + 1) % 6]!;
      push(x, h, z, 0, 1, 0, cCenter);
      push(x + bx * R, h, z + bz * R, 0, 1, 0, cEdge);
      push(x + ax * R, h, z + az * R, 0, 1, 0, cEdge);
      faceToTile[f++] = i;
    }
    const bottom = -0.3;
    for (let k = 0; k < 6; k++) {
      const [ax, az] = CORNERS[k]!;
      const [bx, bz] = CORNERS[(k + 1) % 6]!;
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      const len = Math.hypot(mx, mz);
      const nx = mx / len;
      const nz = mz / len;
      const x1 = x + ax * R, z1 = z + az * R, x2 = x + bx * R, z2 = z + bz * R;
      push(x1, h, z1, nx, 0, nz, cSide);
      push(x2, h, z2, nx, 0, nz, cSide);
      push(x2, bottom, z2, nx, 0, nz, cSide);
      faceToTile[f++] = i;
      push(x1, h, z1, nx, 0, nz, cSide);
      push(x2, bottom, z2, nx, 0, nz, cSide);
      push(x1, bottom, z1, nx, 0, nz, cSide);
      faceToTile[f++] = i;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(pos, 3));
  geometry.setAttribute("normal", new BufferAttribute(nor, 3));
  geometry.setAttribute("color", new BufferAttribute(col, 3));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return { geometry, faceToTile, tiles };
}

/** Split the map into square chunks for frustum culling and cheap partial rebuilds. */
export function chunkTiles(map: MapState, size = 12): number[][] {
  const chunks: number[][] = [];
  for (let cy = 0; cy < map.height; cy += size) {
    for (let cx = 0; cx < map.width; cx += size) {
      const list: number[] = [];
      for (let r = cy; r < Math.min(cy + size, map.height); r++) for (let q = cx; q < Math.min(cx + size, map.width); q++) list.push(r * map.width + q);
      chunks.push(list);
    }
  }
  return chunks;
}

/** Signature of the visual inputs of a chunk; rebuild only when it changes. */
export function chunkSignature(map: MapState, tiles: number[]): string {
  let s = "";
  for (const i of tiles) {
    const t = map.tiles[i]!;
    s += `${t.biome[0]}${t.biome[1]}${t.explored ? 1 : 0}${Math.round(t.pollution / 8)}`;
  }
  return s;
}
