import type { Biome, MapState, PoiType, ResourceNode, ResourceNodeType, Tile } from "@echoes/game-types";
import { SeededRandom, round } from "@echoes/shared";
import { getGrid, type HexGrid } from "./hex";
import { SimplexNoise } from "./noise";

export const DEFAULT_MAP_SIZE = 48;
export const SEA_LEVEL = 0.34;
const SHALLOW_LEVEL = 0.4;

export const WATER_BIOMES: ReadonlySet<Biome> = new Set(["ocean", "shallows", "lake"]);
export const isWater = (b: Biome): boolean => WATER_BIOMES.has(b);

export interface WorldGenOptions {
  seed: string;
  width?: number;
  height?: number;
}

/**
 * Deterministic world generation:
 *   elevation + moisture + temperature  →  biome  →  rivers/lakes  →  resources  →  POIs  →  regions
 * Uses only SeededRandom streams derived from the world seed.
 */
export function generateWorld(opts: WorldGenOptions): MapState {
  const width = opts.width ?? DEFAULT_MAP_SIZE;
  const height = opts.height ?? DEFAULT_MAP_SIZE;
  const grid = getGrid(width, height);
  const elevNoise = new SimplexNoise(SeededRandom.derive(opts.seed, "elevation"));
  const ridgeNoise = new SimplexNoise(SeededRandom.derive(opts.seed, "ridge"));
  const moistNoise = new SimplexNoise(SeededRandom.derive(opts.seed, "moisture"));
  const tempNoise = new SimplexNoise(SeededRandom.derive(opts.seed, "temperature"));

  const tiles: Tile[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = grid.index(col, row);
      const nx = col / width;
      const ny = row / height;
      // Continental shape: fbm minus a soft radial falloff so the edges become ocean.
      const dx = nx - 0.5;
      const dy = ny - 0.5;
      const radial = Math.sqrt(dx * dx + dy * dy) * 2; // 0 centre .. ~1.4 corners
      const base = elevNoise.fbm(nx * 3.2, ny * 3.2, 5);
      const ridge = 1 - Math.abs(ridgeNoise.noise2(nx * 4.5, ny * 4.5));
      let elevation = base * 0.75 + ridge * ridge * 0.3 - Math.pow(radial, 2.2) * 0.55 + 0.12;
      elevation = clamp01(elevation);

      const latitude = row / (height - 1); // 0 north (cold) .. 1 south (warm)
      let temperature = 0.15 + latitude * 0.7 + (tempNoise.fbm(nx * 2.5, ny * 2.5, 3) - 0.5) * 0.35;
      temperature -= Math.max(0, elevation - SEA_LEVEL) * 0.45;
      temperature = clamp01(temperature);

      const moisture = clamp01(moistNoise.fbm(nx * 3.8 + 11, ny * 3.8 - 7, 4) * 1.15 - 0.05);

      tiles.push({
        i,
        col,
        row,
        elevation: round(elevation, 3),
        moisture: round(moisture, 3),
        temperature: round(temperature, 3),
        biome: "plains",
        baseBiome: "plains",
        river: false,
        riverTo: -1,
        forest: 0,
        fertility: 0,
        pollution: 0,
        habitat: 0,
        prosperity: 0,
        resource: null,
        ownerId: null,
        settlementId: null,
        buildingId: null,
        poi: null,
        poiDiscovered: false,
        explored: false,
        region: "",
      });
    }
  }

  // Coastal moisture: tiles near water are wetter.
  for (const t of tiles) {
    if (t.elevation >= SEA_LEVEL) {
      const nearWater = grid.neighbors(t.i).some((n) => (tiles[n]?.elevation ?? 1) < SEA_LEVEL);
      if (nearWater) t.moisture = round(clamp01(t.moisture + 0.12), 3);
    }
  }

  for (const t of tiles) t.biome = classifyBiome(t);
  carveLakes(tiles, grid, SeededRandom.derive(opts.seed, "lakes"));
  carveRivers(tiles, grid, SeededRandom.derive(opts.seed, "rivers"));
  markBeaches(tiles, grid);

  const ecoRng = SeededRandom.derive(opts.seed, "ecology");
  for (const t of tiles) {
    t.baseBiome = t.biome;
    initialiseEcology(t, ecoRng);
  }

  placeResources(tiles, grid, SeededRandom.derive(opts.seed, "resources"));
  placePOIs(tiles, grid, SeededRandom.derive(opts.seed, "poi"));
  nameRegions(tiles, width, height, SeededRandom.derive(opts.seed, "regions"));

  return { width, height, tiles };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function classifyBiome(t: Pick<Tile, "elevation" | "moisture" | "temperature">): Biome {
  const { elevation: e, moisture: m, temperature: temp } = t;
  if (e < SEA_LEVEL - 0.06) return "ocean";
  if (e < SEA_LEVEL) return "shallows";
  if (e > 0.8) return temp < 0.3 ? "snow" : "mountain";
  if (e > 0.68) return temp < 0.2 ? "snow" : "hills";
  if (temp < 0.2) return "tundra";
  if (temp < 0.36 && m > 0.42) return "taiga";
  if (m > 0.74 && e < SHALLOW_LEVEL + 0.12) return "wetland";
  if (m < 0.3 && temp > 0.52) return "desert";
  if (m > 0.55) return "forest";
  if (m > 0.4) return "grassland";
  return "plains";
}

function carveLakes(tiles: Tile[], grid: HexGrid, rng: SeededRandom): void {
  // Inland local minima become lakes (deterministic order + seeded acceptance).
  for (const t of tiles) {
    if (isWater(t.biome) || t.elevation > 0.6) continue;
    const ns = grid.neighbors(t.i);
    if (ns.length < 6) continue;
    const isMin = ns.every((n) => (tiles[n]?.elevation ?? 0) >= t.elevation);
    const inland = ns.every((n) => !isWater(tiles[n]?.biome ?? "ocean"));
    if (isMin && inland && t.moisture > 0.45 && rng.chance(0.85)) {
      t.biome = "lake";
    }
  }
}

function carveRivers(tiles: Tile[], grid: HexGrid, rng: SeededRandom): void {
  const sources = tiles
    .filter((t) => (t.biome === "hills" || t.biome === "mountain") && t.moisture > 0.45)
    .map((t) => t.i);
  const chosen = rng.shuffle(sources).slice(0, 10);
  for (const start of chosen) {
    let current = start;
    const visited = new Set<number>([current]);
    for (let step = 0; step < 60; step++) {
      const tile = tiles[current];
      if (!tile) break;
      const next = grid
        .neighbors(current)
        .filter((n) => !visited.has(n))
        .sort((a, b) => (tiles[a]?.elevation ?? 9) - (tiles[b]?.elevation ?? 9) || a - b)[0];
      if (next === undefined) {
        if (!isWater(tile.biome) && tile.biome !== "mountain") tile.biome = "lake";
        break;
      }
      const nt = tiles[next];
      if (!nt) break;
      if (!isWater(tile.biome)) {
        tile.river = true;
        tile.riverTo = next;
        tile.moisture = round(clamp01(tile.moisture + 0.15), 3);
      }
      if (isWater(nt.biome) || nt.river) break;
      if (nt.elevation > tile.elevation + 0.04) {
        // Uphill: pool into a lake.
        if (!isWater(tile.biome) && tile.biome !== "mountain") {
          tile.biome = "lake";
          tile.river = false;
          tile.riverTo = -1;
        }
        break;
      }
      visited.add(next);
      current = next;
    }
  }
  // River banks are fertile, wetter terrain.
  for (const t of tiles) {
    if (t.river && (t.biome === "desert" || t.biome === "plains")) {
      t.biome = t.biome === "desert" ? "plains" : "grassland";
    }
  }
}

function markBeaches(tiles: Tile[], grid: HexGrid): void {
  for (const t of tiles) {
    if (isWater(t.biome) || t.river) continue;
    if (t.elevation > SEA_LEVEL + 0.05) continue;
    if (t.biome === "wetland" || t.biome === "snow" || t.biome === "tundra") continue;
    const coastal = grid.neighbors(t.i).some((n) => {
      const b = tiles[n]?.biome;
      return b === "ocean" || b === "shallows";
    });
    if (coastal) t.biome = "beach";
  }
}

const BASE_FERTILITY: Record<Biome, number> = {
  ocean: 0, shallows: 0, lake: 0, beach: 25, plains: 55, grassland: 70, forest: 50, taiga: 35,
  desert: 10, tundra: 15, wetland: 60, hills: 35, mountain: 5, snow: 0, scrubland: 30, ashland: 75, blighted: 5,
};

function initialiseEcology(t: Tile, rng: SeededRandom): void {
  if (isWater(t.biome)) {
    t.habitat = 80;
    return;
  }
  switch (t.biome) {
    case "forest":
      t.forest = rng.int(65, 95);
      break;
    case "taiga":
      t.forest = rng.int(55, 85);
      break;
    case "wetland":
      t.forest = rng.int(15, 40);
      break;
    case "grassland":
      t.forest = rng.int(0, 18);
      break;
    case "hills":
      t.forest = rng.int(0, 30);
      break;
    default:
      t.forest = 0;
  }
  t.fertility = Math.min(100, BASE_FERTILITY[t.biome] + (t.river ? 20 : 0) + rng.int(-5, 5));
  t.habitat = rng.int(60, 90);
}

const RESOURCE_TABLE: Partial<Record<Biome, readonly [ResourceNodeType, number][]>> = {
  hills: [["iron", 0.14], ["stone_deposit", 0.16]],
  mountain: [["iron", 0.12], ["stone_deposit", 0.1], ["sunstone", 0.04]],
  forest: [["game_herd", 0.07]],
  taiga: [["game_herd", 0.08]],
  grassland: [["game_herd", 0.05], ["salt", 0.02]],
  plains: [["stone_deposit", 0.03], ["salt", 0.03]],
  desert: [["sunstone", 0.1], ["salt", 0.06]],
  beach: [["salt", 0.05]],
  shallows: [["fish", 0.12]],
  tundra: [["iron", 0.05]],
  wetland: [["game_herd", 0.03]],
};

function placeResources(tiles: Tile[], _grid: HexGrid, rng: SeededRandom): void {
  for (const t of tiles) {
    const table = RESOURCE_TABLE[t.biome];
    if (!table) continue;
    for (const [type, p] of table) {
      if (rng.chance(p)) {
        const amount = rng.int(180, 420);
        const node: ResourceNode = { type, amount, initialAmount: amount };
        t.resource = node;
        break;
      }
    }
  }
}

function placePOIs(tiles: Tile[], grid: HexGrid, rng: SeededRandom): void {
  const land = tiles.filter((t) => !isWater(t.biome) && t.biome !== "mountain" && t.biome !== "snow");
  const placed: number[] = [];
  const tryPlace = (poi: PoiType, count: number, filter: (t: Tile) => boolean): void => {
    const candidates = rng.shuffle(land.filter(filter));
    let n = 0;
    for (const c of candidates) {
      if (n >= count) break;
      if (c.poi || c.resource) continue;
      if (placed.some((p) => grid.distance(p, c.i) < 6)) continue;
      c.poi = poi;
      placed.push(c.i);
      n++;
    }
  };
  tryPlace("ancient_ruin", 7, () => true);
  tryPlace("monolith", 2, (t) => t.biome === "plains" || t.biome === "desert" || t.biome === "tundra");
  tryPlace("hot_springs", 2, (t) => t.biome === "hills");
  tryPlace("crater", 1, (t) => t.biome === "desert" || t.biome === "plains" || t.biome === "scrubland");
  tryPlace("shipwreck", 2, (t) => t.biome === "beach");
}

const REGION_ADJ = ["Black", "Amber", "Silent", "Ashen", "Gilded", "Hollow", "Thorn", "Glass", "Ember", "Pale", "Iron", "Moss", "Storm", "Copper", "Whisper", "Salt"];
const REGION_FORM: Partial<Record<Biome, readonly string[]>> = {
  forest: ["Wilds", "Weald", "Thicket"],
  taiga: ["Pinewood", "Frostwood"],
  grassland: ["Meadows", "Downs", "Steppe"],
  plains: ["Plains", "Flats", "Expanse"],
  desert: ["Dunes", "Waste", "Sands"],
  hills: ["Highlands", "Ridges", "Tors"],
  mountain: ["Peaks", "Spires", "Crown"],
  snow: ["Crown", "Peaks"],
  wetland: ["Fens", "Mire", "Marsh"],
  tundra: ["Barrens", "Tundra"],
  beach: ["Coast", "Shore"],
  ocean: ["Sea", "Deep"],
  shallows: ["Sound", "Shoals"],
  lake: ["Lakes"],
};

function nameRegions(tiles: Tile[], width: number, height: number, rng: SeededRandom): void {
  const sectors = 3;
  const adjectives = rng.shuffle(REGION_ADJ);
  for (let sy = 0; sy < sectors; sy++) {
    for (let sx = 0; sx < sectors; sx++) {
      const members = tiles.filter(
        (t) => Math.min(sectors - 1, Math.floor((t.col / width) * sectors)) === sx &&
          Math.min(sectors - 1, Math.floor((t.row / height) * sectors)) === sy,
      );
      const counts = new Map<Biome, number>();
      for (const m of members) if (!isWater(m.biome) || members.every((x) => isWater(x.biome))) counts.set(m.biome, (counts.get(m.biome) ?? 0) + 1);
      let dominant: Biome = "ocean";
      let best = -1;
      for (const [b, c] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        if (c > best) {
          best = c;
          dominant = b;
        }
      }
      const forms = REGION_FORM[dominant] ?? ["Lands"];
      const adj = adjectives[(sy * sectors + sx) % adjectives.length] ?? "Far";
      const name = `the ${adj} ${rng.pick(forms)}`;
      for (const m of members) m.region = name;
    }
  }
}
