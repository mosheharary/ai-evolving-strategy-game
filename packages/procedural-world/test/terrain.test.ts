import { describe, expect, it } from "vitest";
import { findStartSites, generateWorld, getGrid, isWater } from "../src";
import { hashObject } from "@echoes/shared";

describe("procedural terrain", () => {
  it("is deterministic from worldSeed", () => {
    expect(hashObject(generateWorld({ seed: "alpha" }))).toBe(hashObject(generateWorld({ seed: "alpha" })));
  });

  it("differs between seeds", () => {
    expect(hashObject(generateWorld({ seed: "alpha" }))).not.toBe(hashObject(generateWorld({ seed: "omega" })));
  });

  it("produces a 48x48 map with varied biomes, rivers, resources and POIs", () => {
    const map = generateWorld({ seed: "variety" });
    expect(map.width).toBe(48);
    expect(map.tiles).toHaveLength(48 * 48);
    const biomes = new Set(map.tiles.map((t) => t.biome));
    for (const b of ["ocean", "plains", "forest", "hills"]) expect(biomes.has(b as never)).toBe(true);
    expect(biomes.size).toBeGreaterThanOrEqual(8);
    expect(map.tiles.some((t) => t.river)).toBe(true);
    expect(map.tiles.filter((t) => t.resource).length).toBeGreaterThan(20);
    expect(map.tiles.filter((t) => t.poi === "ancient_ruin").length).toBeGreaterThan(0);
    expect(new Set(map.tiles.map((t) => t.region)).size).toBe(9);
  });

  it("keeps the map edge as water and derives biome from elevation/moisture/temperature", () => {
    const map = generateWorld({ seed: "edges" });
    const corners = [0, 47, 48 * 47, 48 * 48 - 1].map((i) => map.tiles[i]!);
    for (const c of corners) expect(isWater(c.biome)).toBe(true);
    for (const t of map.tiles) {
      if (t.biome === "mountain" || t.biome === "snow") expect(t.elevation).toBeGreaterThan(0.68);
      if (t.biome === "ocean") expect(t.elevation).toBeLessThan(0.34);
    }
  });

  it("places well-separated start sites on land", () => {
    const map = generateWorld({ seed: "starts" });
    const sites = findStartSites(map, ["balanced", "coastal", "highlands", "forest", "river", "desert"], "starts");
    const grid = getGrid(48, 48);
    expect(sites).toHaveLength(6);
    for (const s of sites) expect(isWater(map.tiles[s]!.biome)).toBe(false);
    for (let i = 0; i < sites.length; i++) for (let j = i + 1; j < sites.length; j++) expect(grid.distance(sites[i]!, sites[j]!)).toBeGreaterThanOrEqual(4);
  });

  it("hex neighbours are symmetric", () => {
    const grid = getGrid(48, 48);
    for (const i of [0, 49, 500, 1200, 2303]) for (const n of grid.neighbors(i)) expect(grid.neighbors(n)).toContain(i);
  });
});
