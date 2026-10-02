/**
 * Hex grid utilities. The map uses pointy-top hexes in "odd-r" offset layout
 * (odd rows shoved right). Tile index = row * width + col.
 */

export interface Axial {
  q: number;
  r: number;
}

export function offsetToAxial(col: number, row: number): Axial {
  return { q: col - (row - (row & 1)) / 2, r: row };
}

export function axialToOffset(q: number, r: number): { col: number; row: number } {
  return { col: q + (r - (r & 1)) / 2, row: r };
}

export function axialDistance(a: Axial, b: Axial): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

const AXIAL_DIRS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export class HexGrid {
  readonly width: number;
  readonly height: number;
  private readonly neighborCache: number[][];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.neighborCache = [];
    for (let i = 0; i < width * height; i++) this.neighborCache.push(this.computeNeighbors(i));
  }

  index(col: number, row: number): number {
    return row * this.width + col;
  }

  colRow(i: number): { col: number; row: number } {
    return { col: i % this.width, row: Math.floor(i / this.width) };
  }

  inBounds(col: number, row: number): boolean {
    return col >= 0 && row >= 0 && col < this.width && row < this.height;
  }

  axial(i: number): Axial {
    const { col, row } = this.colRow(i);
    return offsetToAxial(col, row);
  }

  private computeNeighbors(i: number): number[] {
    const a = this.axial(i);
    const out: number[] = [];
    for (const d of AXIAL_DIRS) {
      const { col, row } = axialToOffset(a.q + d.q, a.r + d.r);
      if (this.inBounds(col, row)) out.push(this.index(col, row));
    }
    return out;
  }

  neighbors(i: number): readonly number[] {
    return this.neighborCache[i] ?? [];
  }

  distance(a: number, b: number): number {
    return axialDistance(this.axial(a), this.axial(b));
  }

  /** All tile indices within `radius` of `center` (inclusive), sorted by index for determinism. */
  within(center: number, radius: number): number[] {
    const c = this.axial(center);
    const out: number[] = [];
    for (let dq = -radius; dq <= radius; dq++) {
      for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
        const { col, row } = axialToOffset(c.q + dq, c.r + dr);
        if (this.inBounds(col, row)) out.push(this.index(col, row));
      }
    }
    return out.sort((x, y) => x - y);
  }
}

const gridCache = new Map<string, HexGrid>();
export function getGrid(width: number, height: number): HexGrid {
  const key = `${width}x${height}`;
  let g = gridCache.get(key);
  if (!g) {
    g = new HexGrid(width, height);
    gridCache.set(key, g);
  }
  return g;
}

/** World-space position of a tile centre (pointy-top, hex "size" = circumradius). */
export const HEX_SIZE = 1;
export function tileWorldPosition(col: number, row: number, size = HEX_SIZE): { x: number; z: number } {
  const x = size * Math.sqrt(3) * (col + 0.5 * (row & 1));
  const z = size * 1.5 * row;
  return { x, z };
}
