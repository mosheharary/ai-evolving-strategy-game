import { SeededRandom } from "@echoes/shared";

/**
 * Seeded 2D simplex noise (Gustavson's formulation) with a permutation table
 * shuffled by SeededRandom, so the same seed always produces the same terrain.
 */
const GRAD: readonly (readonly [number, number])[] = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

export class SimplexNoise {
  private readonly perm: Uint8Array;

  constructor(rng: SeededRandom) {
    const p = rng.shuffle(Array.from({ length: 256 }, (_, i) => i));
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255] ?? 0;
  }

  private grad(hash: number, x: number, y: number): number {
    const g = GRAD[hash & 7] ?? GRAD[0]!;
    return g[0] * x + g[1] * y;
  }

  /** Returns noise in approximately [-1, 1]. */
  noise2(xin: number, yin: number): number {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    const p = this.perm;
    let n0 = 0;
    let n1 = 0;
    let n2 = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      t0 *= t0;
      n0 = t0 * t0 * this.grad(p[ii + (p[jj] ?? 0)] ?? 0, x0, y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      t1 *= t1;
      n1 = t1 * t1 * this.grad(p[ii + i1 + (p[jj + j1] ?? 0)] ?? 0, x1, y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      t2 *= t2;
      n2 = t2 * t2 * this.grad(p[ii + 1 + (p[jj + 1] ?? 0)] ?? 0, x2, y2);
    }
    return 70 * (n0 + n1 + n2);
  }

  /** Fractal Brownian motion in [0, 1]. */
  fbm(x: number, y: number, octaves = 5, lacunarity = 2, gain = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise2(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return (sum / norm + 1) / 2;
  }
}
