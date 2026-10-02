import { resourceLabel } from "../content/labels";
import type { Biome } from "@echoes/game-types";
import { PLAYER_ID } from "@echoes/game-types";
import { isWater } from "@echoes/procedural-world";
import { clamp, round } from "@echoes/shared";
import { techModifiers } from "../content/techs";
import type { EngineContext } from "../context";
import { computeFactionEconomy } from "./economy";

/**
 * World evolution — the permanent consequences of how the frontier is used.
 * Called once per turn in the WORLD_EVOLUTION phase. Returns notable changes
 * (also recorded in history) which the event director may react to.
 */
export interface EvolutionResult {
  depletedNodes: { tile: number; type: string; ownerId: string | null }[];
  deforested: number[];
  blighted: number[];
  recovered: number[];
  lines: string[];
}

const FOREST_CAPACITY: Partial<Record<Biome, number>> = { forest: 95, taiga: 85, wetland: 40, grassland: 20, hills: 30, scrubland: 55 };

export function evolveWorld(ctx: EngineContext): EvolutionResult {
  const state = ctx.state;
  const tiles = state.map.tiles;
  const result: EvolutionResult = { depletedNodes: [], deforested: [], blighted: [], recovered: [], lines: [] };
  const modsByFaction = new Map(state.factions.map((f) => [f.id, techModifiers(f.research.known)]));

  // 1. Building-driven depletion and pollution.
  const pollutionAdd = new Float64Array(tiles.length);
  for (const f of state.factions) {
    if (!f.alive) continue;
    const econ = computeFactionEconomy(state, f.id);
    const mods = modsByFaction.get(f.id)!;
    for (const se of econ.settlements) {
      for (const by of se.buildings) {
        const b = state.buildings.find((x) => x.id === by.buildingId);
        if (!b) continue;
        const t = tiles[b.tile]!;
        pollutionAdd[b.tile] = (pollutionAdd[b.tile] ?? 0) + by.pollution * 2.2;
        if (by.staffed <= 0) continue;
        if (b.type === "farm") {
          t.fertility = round(clamp(t.fertility - 0.8 * Math.max(0, 1 + mods.fertilityDepletionMult), 5, 100), 1);
          if (t.resource?.type === "game_herd") {
            t.resource.amount = Math.max(0, t.resource.amount - 3);
            if (t.resource.amount <= 0) {
              result.depletedNodes.push({ tile: t.i, type: "game_herd", ownerId: t.ownerId });
              t.resource = null;
            }
          }
        } else if (b.type === "lumber_camp") {
          const before = t.forest;
          t.forest = round(Math.max(0, t.forest - 3 * Math.max(0.2, 1 + mods.forestDepletionMult) * by.staffed), 1);
          t.habitat = round(clamp(t.habitat - 0.6, 0, 100), 1);
          if (before >= 8 && t.forest < 8 && (t.biome === "forest" || t.biome === "taiga")) {
            t.biome = "scrubland";
            result.deforested.push(t.i);
            ctx.remember("verdant", f.id, "deforested", -6);
            ctx.history({
              type: "TERRAIN_CHANGED", importance: 2, actorId: f.id, targetId: null, tile: t.i,
              summary: `The forest of ${t.region} has been cut down by ${ctx.factionName(f.id)}. Only scrub remains.`,
              effects: ["Timber production here collapses", "Habitat quality -10", "The Verdant Assembly's opinion falls"],
              tags: ["ecology", "deforestation", `region:${t.region}`],
            });
            t.habitat = Math.max(0, t.habitat - 10);
          }
        } else if ((b.type === "mine" || b.type === "quarry") && t.resource) {
          const drain = b.type === "mine" ? 6 : 4;
          t.resource.amount = Math.max(0, t.resource.amount - drain * by.staffed);
          if (t.resource.amount <= 0) {
            result.depletedNodes.push({ tile: t.i, type: t.resource.type, ownerId: t.ownerId });
            ctx.history({
              type: "RESOURCE_DEPLETED", importance: 2, actorId: f.id, targetId: null, tile: t.i,
              summary: `The ${resourceLabel(t.resource.type)} deposit in ${t.region} is exhausted.`,
              effects: [`${b.type === "mine" ? "Mine" : "Quarry"} output drops sharply`], tags: ["economy", "depletion"],
            });
            t.resource = null;
          }
        }
      }
    }
  }

  // 2. Pollution diffusion: spreads to neighbours, rivers carry it downstream, then decays.
  const next = new Float64Array(tiles.length);
  for (const t of tiles) next[t.i] = t.pollution + (pollutionAdd[t.i] ?? 0);
  for (const t of tiles) {
    const p = (next[t.i] ?? 0) * 0.12;
    if (p < 0.05) continue;
    const ns = ctx.grid.neighbors(t.i);
    for (const n of ns) next[n] = (next[n] ?? 0) + p / ns.length;
    next[t.i] = (next[t.i] ?? 0) - p;
    if (t.river && t.riverTo >= 0) {
      const carried = (next[t.i] ?? 0) * 0.25;
      next[t.riverTo] = (next[t.riverTo] ?? 0) + carried;
      next[t.i] = (next[t.i] ?? 0) - carried * 0.6;
    }
  }
  for (const t of tiles) {
    const ownerMods = t.ownerId ? modsByFaction.get(t.ownerId) : undefined;
    const decay = 0.6 + (ownerMods?.pollutionDecay ?? 0) * 0.8 + (t.forest > 50 ? 0.4 : 0);
    t.pollution = round(clamp((next[t.i] ?? 0) - decay, 0, 100), 1);
  }

  // 3. Ecology: habitat, blight, forest regrowth, recovery.
  for (const t of tiles) {
    if (isWater(t.biome)) {
      t.habitat = round(clamp(t.habitat + (t.pollution > 20 ? -1 : 0.3), 0, 100), 1);
      continue;
    }
    if (t.pollution > 25) t.habitat = round(clamp(t.habitat - (t.pollution - 25) * 0.05, 0, 100), 1);
    else if (t.pollution < 8) t.habitat = round(clamp(t.habitat + 0.35, 0, 90), 1);

    if (t.pollution > 60 && (t.biome === "wetland" || t.biome === "forest" || t.biome === "grassland")) {
      t.biome = "blighted";
      t.forest = Math.min(t.forest, 10);
      t.fertility = Math.min(t.fertility, 15);
      result.blighted.push(t.i);
      ctx.history({
        type: "TERRAIN_CHANGED", importance: 2, actorId: t.ownerId, targetId: null, tile: t.i,
        summary: `Pollution has blighted the land in ${t.region}.`, effects: ["Biome becomes blighted", "Fertility collapses"],
        tags: ["ecology", "pollution", `region:${t.region}`],
      });
    }
    const hasCamp = t.buildingId !== null && state.buildings.some((b) => b.id === t.buildingId && b.type === "lumber_camp");
    const cap = FOREST_CAPACITY[t.baseBiome === "forest" || t.baseBiome === "taiga" ? t.baseBiome : t.biome] ?? 0;
    if (!hasCamp && t.forest < cap && t.pollution < 20) {
      const forestedNeighbors = ctx.grid.neighbors(t.i).filter((n) => (tiles[n]?.forest ?? 0) > 40).length;
      if (forestedNeighbors >= 2 || t.forest > 15) {
        const regrowth = 0.35 + (t.ownerId ? (modsByFaction.get(t.ownerId)?.forestRegrowth ?? 0) * 0.5 : 0);
        t.forest = round(Math.min(cap, t.forest + regrowth), 1);
      }
    }
    if (t.biome === "scrubland" && t.forest > 45 && (t.baseBiome === "forest" || t.baseBiome === "taiga")) {
      t.biome = t.baseBiome;
      result.recovered.push(t.i);
      ctx.history({
        type: "TERRAIN_CHANGED", importance: 2, actorId: null, targetId: null, tile: t.i,
        summary: `The forest has returned to ${t.region}.`, effects: ["Forest restored", "Habitat recovering"], tags: ["ecology", "recovery"],
      });
    }
    if (t.biome === "blighted" && t.pollution < 5 && t.habitat > 50) {
      t.biome = t.baseBiome === "forest" ? "scrubland" : t.baseBiome;
      result.recovered.push(t.i);
    }
    // Fallow soil slowly recovers.
    if (!t.buildingId && t.fertility < 60 && t.pollution < 15) t.fertility = round(t.fertility + 0.2, 1);
  }

  // 4. Trade routes enrich the land between partner capitals.
  for (const t of tiles) if (t.prosperity > 0) t.prosperity = round(Math.max(0, t.prosperity - 0.5), 1);
  for (const rel of state.relations) {
    if (!rel.trade) continue;
    const ca = state.settlements.find((s) => s.ownerId === rel.a && s.isCapital) ?? state.settlements.find((s) => s.ownerId === rel.a);
    const cb = state.settlements.find((s) => s.ownerId === rel.b && s.isCapital) ?? state.settlements.find((s) => s.ownerId === rel.b);
    if (!ca || !cb) continue;
    for (const i of hexLine(ctx, ca.tile, cb.tile)) {
      const t = tiles[i]!;
      if (!isWater(t.biome)) t.prosperity = round(Math.min(100, t.prosperity + 2.5), 1);
    }
  }

  // 5. Climate: seeded random walk, pushed by industrial warming.
  const land = tiles.filter((t) => !isWater(t.biome));
  const globalPollution = land.reduce((a, t) => a + t.pollution, 0) / Math.max(1, land.length);
  const w = state.world;
  w.globalPollution = round(globalPollution, 2);
  w.warming = round(clamp(w.warming + globalPollution * 0.004 - 0.004, 0, 3), 3);
  w.rainfall = round(clamp(w.rainfall + ctx.rng.range(-0.1, 0.1) + (0.52 - w.rainfall) * 0.1 - w.warming * 0.015, 0.05, 0.95), 3);
  w.forestCover = round(land.filter((t) => t.forest > 30).length / Math.max(1, land.length), 3);

  // 6. Pollution near the Verdant Assembly sours them toward the polluter.
  const verdant = ctx.factionOrNull("verdant");
  if (verdant?.alive) {
    const playerPollution = tiles.filter((t) => t.ownerId === PLAYER_ID).reduce((a, t) => a + t.pollution, 0);
    if (playerPollution > 60) ctx.remember("verdant", PLAYER_ID, "polluted_land", -Math.min(4, playerPollution / 80));
  }
  return result;
}

/** Tiles on the hex line between two tiles (cube lerp), for trade route visualisation and prosperity. */
export function hexLine(ctx: EngineContext, a: number, b: number): number[] {
  const A = ctx.grid.axial(a);
  const B = ctx.grid.axial(b);
  const n = ctx.grid.distance(a, b);
  const out: number[] = [];
  for (let k = 0; k <= n; k++) {
    const t = n === 0 ? 0 : k / n;
    const q = A.q + (B.q - A.q) * t + 1e-6;
    const r = A.r + (B.r - A.r) * t + 1e-6;
    const s = -q - r;
    let rq = Math.round(q);
    let rr = Math.round(r);
    const rs = Math.round(s);
    const dq = Math.abs(rq - q);
    const dr = Math.abs(rr - r);
    const ds = Math.abs(rs - s);
    if (dq > dr && dq > ds) rq = -rr - rs;
    else if (dr > ds) rr = -rq - rs;
    const col = rq + (rr - (rr & 1)) / 2;
    const row = rr;
    if (ctx.grid.inBounds(col, row)) out.push(ctx.grid.index(col, row));
  }
  return out;
}
