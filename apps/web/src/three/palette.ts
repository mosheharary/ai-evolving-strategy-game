import type { Biome } from "@echoes/game-types";
import { Color } from "three";

/** Art direction: a restrained, slightly painterly palette with warm light / cool shadow. */
export const BIOME_COLORS: Record<Biome, string> = {
  ocean: "#1d3f5c",
  shallows: "#2f6f86",
  lake: "#2c6a80",
  beach: "#d8c48f",
  plains: "#a9b05c",
  grassland: "#7fa452",
  forest: "#4c7a3d",
  taiga: "#4b6b4c",
  desert: "#d6b06a",
  tundra: "#a7a99a",
  wetland: "#5f7d55",
  hills: "#8d8a5a",
  mountain: "#7d7468",
  snow: "#e8ecef",
  scrubland: "#a89463",
  ashland: "#5a524c",
  blighted: "#6d5f4a",
};

export interface EraGrade {
  sky: string;
  fog: string;
  sun: string;
  ambient: string;
  sunIntensity: number;
  fogNear: number;
  fogFar: number;
}

/** Each era visually transforms the world: light, haze and atmosphere shift. */
export const ERA_GRADES: EraGrade[] = [
  { sky: "#9fc4d9", fog: "#b8cdd6", sun: "#fff1d6", ambient: "#a7b8c8", sunIntensity: 2.6, fogNear: 60, fogFar: 150 },
  { sky: "#a9c9dc", fog: "#c6d3d6", sun: "#ffe9c4", ambient: "#b0bcc6", sunIntensity: 2.7, fogNear: 65, fogFar: 160 },
  { sky: "#b7b4a6", fog: "#b9b2a2", sun: "#ffd9a3", ambient: "#a59f94", sunIntensity: 2.4, fogNear: 45, fogFar: 135 },
  { sky: "#9fb8c9", fog: "#b5c2c7", sun: "#fff0dc", ambient: "#a9b7c2", sunIntensity: 2.8, fogNear: 60, fogFar: 160 },
  { sky: "#c3b8e0", fog: "#cfc6e0", sun: "#fff6e8", ambient: "#b8b4d0", sunIntensity: 3.0, fogNear: 70, fogFar: 175 },
];

export function hashTile(i: number, salt = 0): number {
  let h = (i * 374761393 + salt * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const tmp = new Color();
const pollutedTint = new Color("#5b4f45");
const fogTint = new Color("#1a2128");

/** Final per-tile colour: biome + painterly jitter + pollution + fog of war. */
export function tileColor(biome: Biome, i: number, pollution: number, explored: boolean, highContrast: boolean, out: Color): Color {
  out.set(BIOME_COLORS[biome]);
  const j = hashTile(i) - 0.5;
  out.offsetHSL(j * 0.025, j * 0.06, j * 0.06);
  if (pollution > 5) out.lerp(pollutedTint, Math.min(0.55, pollution / 120));
  if (highContrast) out.offsetHSL(0, 0.1, 0);
  if (!explored) {
    tmp.copy(out);
    out.copy(fogTint).lerp(tmp, 0.18);
  }
  return out;
}
