import type { Biome, MapState, Tile } from "@echoes/game-types";
import { SeededRandom } from "@echoes/shared";
import { isWater } from "./generate";
import { getGrid } from "./hex";

export type SitePreference = "balanced" | "coastal" | "river" | "highlands" | "forest" | Biome;

/** Score a tile as a settlement site for a given preference. Higher is better. */
export function scoreSite(map: MapState, tileIndex: number, pref: SitePreference): number {
  const grid = getGrid(map.width, map.height);
  const t = map.tiles[tileIndex];
  if (!t || isWater(t.biome) || t.biome === "mountain" || t.biome === "snow") return -Infinity;
  const area = grid.within(tileIndex, 2).map((i) => map.tiles[i]).filter((x): x is Tile => !!x);
  let land = 0;
  let fertility = 0;
  let forest = 0;
  let resources = 0;
  let coastal = 0;
  let river = 0;
  let hills = 0;
  let biomeMatch = 0;
  for (const a of area) {
    if (!isWater(a.biome)) {
      land++;
      fertility += a.fertility;
      forest += a.forest;
      if (a.resource) resources++;
      if (a.river) river++;
      if (a.biome === "hills" || a.biome === "mountain") hills++;
    } else if (a.biome !== "lake") coastal++;
    if (a.biome === pref) biomeMatch++;
  }
  if (land < 10) return -Infinity;
  let score = fertility / 25 + forest / 60 + resources * 3 + river * 1.5 + Math.min(coastal, 4) * 0.5 + hills * 0.6;
  switch (pref) {
    case "coastal":
      score += coastal > 0 ? 12 + coastal : -10;
      break;
    case "river":
      score += t.river ? 14 : river > 0 ? 8 : -10;
      break;
    case "highlands":
      score += hills * 3;
      break;
    case "forest":
      score += forest / 20;
      break;
    case "balanced":
      score += t.biome === "grassland" || t.biome === "plains" ? 3 : 0;
      break;
    default:
      score += biomeMatch * 2.5;
  }
  return score;
}

/**
 * Choose well-separated start sites. The first preference is the human player.
 * Deterministic: candidate order is fixed and ties are broken by tile index.
 */
export function findStartSites(map: MapState, prefs: readonly SitePreference[], seed: string, minDistance = 10): number[] {
  const grid = getGrid(map.width, map.height);
  const rng = SeededRandom.derive(seed, "start-sites");
  const result: number[] = [];
  const margin = 3;
  const candidates = map.tiles.filter(
    (t) => t.col >= margin && t.row >= margin && t.col < map.width - margin && t.row < map.height - margin,
  );
  for (const pref of prefs) {
    let distance = minDistance;
    let chosen: number | null = null;
    while (chosen === null && distance >= 4) {
      let best = -Infinity;
      for (const c of candidates) {
        if (result.some((r) => grid.distance(r, c.i) < distance)) continue;
        // Small seeded jitter so different seeds do not always pick the global optimum.
        const s = scoreSite(map, c.i, pref) + rng.next() * 2;
        if (s > best) {
          best = s;
          chosen = c.i;
        }
      }
      if (chosen === null || best === -Infinity) {
        chosen = null;
        distance -= 2;
      }
    }
    if (chosen === null) throw new Error(`World generation failed: no start site for ${pref}`);
    result.push(chosen);
  }
  return result;
}
