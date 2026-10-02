import type { BuildingType, UnitType } from "@echoes/game-types";
import { BoxGeometry, ConeGeometry, CylinderGeometry, OctahedronGeometry, SphereGeometry, type BufferGeometry } from "three";

/**
 * Reusable procedural base assets. Every model is a list of primitive parts; each
 * part becomes ONE InstancedMesh shared by every building/unit of that type, so the
 * whole world renders in a few dozen draw calls. "faction" parts take the owner's colour.
 */
export interface Part {
  geo: BufferGeometry;
  color: string | "faction";
  pos: [number, number, number];
  scale?: [number, number, number];
  rotY?: number;
  emissive?: string;
  metal?: number;
}

const box = (w: number, h: number, d: number) => new BoxGeometry(w, h, d);
const roof = (r: number, h: number) => {
  const g = new ConeGeometry(r, h, 4);
  g.rotateY(Math.PI / 4);
  return g;
};
const cyl = (rt: number, rb: number, h: number, s = 8) => new CylinderGeometry(rt, rb, h, s);

const G = {
  hall: box(0.62, 0.42, 0.52),
  hallRoof: roof(0.52, 0.36),
  house: box(0.26, 0.22, 0.24),
  houseRoof: roof(0.22, 0.18),
  chimney: cyl(0.04, 0.05, 0.3, 6),
  plot: box(1.25, 0.05, 0.95),
  rows: box(1.1, 0.06, 0.08),
  barn: box(0.3, 0.24, 0.26),
  log: cyl(0.06, 0.06, 0.55, 6),
  hut: box(0.28, 0.2, 0.24),
  pit: cyl(0.45, 0.32, 0.12, 6),
  block: box(0.18, 0.14, 0.18),
  entrance: box(0.36, 0.3, 0.3),
  frame: box(0.05, 0.6, 0.05),
  beam: box(0.42, 0.05, 0.05),
  shed: box(0.6, 0.36, 0.42),
  warehouse: box(0.8, 0.32, 0.46),
  warehouseRoof: (() => {
    const g = new CylinderGeometry(0.26, 0.26, 0.82, 3, 1);
    g.rotateZ(Math.PI / 2);
    return g;
  })(),
  tower: cyl(0.16, 0.2, 0.45, 10),
  dome: new SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  stall: box(0.22, 0.14, 0.18),
  awning: box(0.26, 0.03, 0.22),
  pole: cyl(0.015, 0.015, 0.7, 4),
  flag: box(0.18, 0.11, 0.01),
  wallSeg: box(0.55, 0.28, 0.08),
  watch: cyl(0.07, 0.11, 0.85, 6),
  watchTop: new ConeGeometry(0.16, 0.22, 6),
  stack: cyl(0.06, 0.08, 0.75, 8),
  crystal: new OctahedronGeometry(0.12, 0),
  body: cyl(0.075, 0.1, 0.26, 8),
  head: new SphereGeometry(0.065, 10, 8),
  shield: box(0.02, 0.14, 0.11),
  spear: cyl(0.012, 0.012, 0.42, 4),
  bow: box(0.02, 0.28, 0.02),
  pack: box(0.09, 0.09, 0.06),
  mount: box(0.12, 0.12, 0.3),
  plinth: cyl(0.16, 0.18, 0.04, 12),
  base: cyl(0.2, 0.22, 0.035, 16),
  pillar: cyl(0.05, 0.06, 0.4, 6),
  monolith: box(0.12, 0.7, 0.06),
};

const STONE = "#b9ad97";
const WOOD = "#8a6a45";
const DARK = "#3d3a36";

export const BUILDING_MODELS: Record<BuildingType, Part[]> = {
  settlement_center: [
    { geo: G.hall, color: STONE, pos: [0, 0.21, 0] },
    { geo: G.hallRoof, color: "faction", pos: [0, 0.6, 0] },
    { geo: G.chimney, color: DARK, pos: [0.18, 0.62, 0.1] },
    { geo: G.house, color: "#c9b99a", pos: [-0.55, 0.11, 0.35] },
    { geo: G.houseRoof, color: "#8f4e3a", pos: [-0.55, 0.31, 0.35] },
    { geo: G.house, color: "#c9b99a", pos: [0.52, 0.11, -0.38] },
    { geo: G.houseRoof, color: "#8f4e3a", pos: [0.52, 0.31, -0.38] },
    { geo: G.house, color: "#c9b99a", pos: [0.35, 0.11, 0.5] },
    { geo: G.houseRoof, color: "#8f4e3a", pos: [0.35, 0.31, 0.5] },
  ],
  farm: [
    { geo: G.plot, color: "#9b8a4a", pos: [0, 0.025, 0] },
    { geo: G.rows, color: "#c9b54a", pos: [0, 0.06, -0.3] },
    { geo: G.rows, color: "#a8b94a", pos: [0, 0.06, 0] },
    { geo: G.rows, color: "#c9b54a", pos: [0, 0.06, 0.3] },
    { geo: G.barn, color: "#a2442f", pos: [0.48, 0.12, 0.4] },
    { geo: G.houseRoof, color: "#5b3a2a", pos: [0.48, 0.32, 0.4] },
  ],
  lumber_camp: [
    { geo: G.hut, color: WOOD, pos: [0.2, 0.1, 0.2] },
    { geo: G.houseRoof, color: "faction", pos: [0.2, 0.28, 0.2] },
    { geo: G.log, color: "#6b4b2e", pos: [-0.25, 0.06, -0.1], scale: [1, 1, 1], rotY: 0 },
    { geo: G.log, color: "#7a5636", pos: [-0.25, 0.14, -0.1] },
  ],
  quarry: [
    { geo: G.pit, color: "#5e584f", pos: [0, 0.0, 0] },
    { geo: G.block, color: "#cfc6b5", pos: [0.45, 0.07, 0.15] },
    { geo: G.block, color: "#bdb4a4", pos: [0.38, 0.07, -0.25] },
    { geo: G.block, color: "#d6cdbb", pos: [0.45, 0.2, 0.15] },
  ],
  mine: [
    { geo: G.entrance, color: "#4a4038", pos: [0, 0.15, 0] },
    { geo: G.frame, color: WOOD, pos: [-0.18, 0.45, 0.2] },
    { geo: G.frame, color: WOOD, pos: [0.18, 0.45, 0.2] },
    { geo: G.beam, color: WOOD, pos: [0, 0.74, 0.2] },
    { geo: G.flag, color: "faction", pos: [0, 0.85, 0.2] },
  ],
  workshop: [
    { geo: G.shed, color: "#8c7a62", pos: [0, 0.18, 0] },
    { geo: roof(0.5, 0.26), color: "faction", pos: [0, 0.49, 0] },
    { geo: G.stack, color: DARK, pos: [0.22, 0.6, -0.1] },
  ],
  warehouse: [
    { geo: G.warehouse, color: "#9a8466", pos: [0, 0.16, 0] },
    { geo: G.warehouseRoof, color: "faction", pos: [0, 0.34, 0], scale: [1, 0.6, 1] },
  ],
  laboratory: [
    { geo: G.tower, color: "#d9d4c8", pos: [0, 0.22, 0] },
    { geo: G.dome, color: "#6fa3c9", pos: [0, 0.45, 0], metal: 0.6, emissive: "#21455e" },
    { geo: G.house, color: "#c9c2b3", pos: [0.35, 0.11, 0.25] },
  ],
  market: [
    { geo: G.stall, color: WOOD, pos: [-0.25, 0.07, -0.2] },
    { geo: G.awning, color: "faction", pos: [-0.25, 0.18, -0.2] },
    { geo: G.stall, color: WOOD, pos: [0.25, 0.07, -0.15] },
    { geo: G.awning, color: "#d9a640", pos: [0.25, 0.18, -0.15] },
    { geo: G.stall, color: WOOD, pos: [0, 0.07, 0.28] },
    { geo: G.awning, color: "#b8463a", pos: [0, 0.18, 0.28] },
  ],
  barracks: [
    { geo: G.shed, color: "#7f735f", pos: [0, 0.18, 0] },
    { geo: roof(0.5, 0.24), color: "#5a4636", pos: [0, 0.48, 0] },
    { geo: G.pole, color: DARK, pos: [0.4, 0.35, 0.3] },
    { geo: G.flag, color: "faction", pos: [0.49, 0.62, 0.3] },
  ],
  wall: [
    { geo: G.wallSeg, color: STONE, pos: [0, 0.14, -0.62], rotY: 0 },
    { geo: G.wallSeg, color: STONE, pos: [0.54, 0.14, -0.31], rotY: -Math.PI / 3 },
    { geo: G.wallSeg, color: STONE, pos: [0.54, 0.14, 0.31], rotY: Math.PI / 3 },
    { geo: G.wallSeg, color: STONE, pos: [0, 0.14, 0.62], rotY: 0 },
    { geo: G.wallSeg, color: STONE, pos: [-0.54, 0.14, 0.31], rotY: -Math.PI / 3 },
    { geo: G.wallSeg, color: STONE, pos: [-0.54, 0.14, -0.31], rotY: Math.PI / 3 },
  ],
  watchtower: [
    { geo: G.watch, color: WOOD, pos: [0, 0.42, 0] },
    { geo: G.watchTop, color: "faction", pos: [0, 0.95, 0] },
  ],
  power_plant: [
    { geo: G.warehouse, color: "#6d675f", pos: [0, 0.16, 0] },
    { geo: G.stack, color: "#4a4540", pos: [-0.22, 0.6, 0.1] },
    { geo: G.stack, color: "#4a4540", pos: [0.22, 0.6, -0.1] },
    { geo: G.flag, color: "faction", pos: [0, 0.4, 0.24] },
  ],
};

const BASE: Part = { geo: G.base, color: "faction", pos: [0, 0.02, 0], emissive: "#222222" };

export const UNIT_MODELS: Record<UnitType, Part[]> = {
  worker: [
    BASE,
    { geo: G.body, color: "faction", pos: [0, 0.13, 0] },
    { geo: G.head, color: "#e0c8a8", pos: [0, 0.32, 0] },
    { geo: G.pack, color: WOOD, pos: [0, 0.18, -0.09] },
  ],
  scout: [
    BASE,
    { geo: G.body, color: "faction", pos: [0, 0.13, 0], scale: [0.9, 1.1, 0.9] },
    { geo: G.head, color: "#e0c8a8", pos: [0, 0.34, 0] },
    { geo: G.spear, color: "#cfc6b5", pos: [0.1, 0.25, 0] },
  ],
  explorer: [
    BASE,
    { geo: G.body, color: "faction", pos: [0, 0.13, 0] },
    { geo: G.head, color: "#e0c8a8", pos: [0, 0.32, 0] },
    { geo: G.pack, color: "#c9a96a", pos: [0, 0.2, -0.09], scale: [1.3, 1.3, 1.3] },
    { geo: G.pole, color: WOOD, pos: [0.1, 0.25, 0], scale: [1, 0.7, 1] },
  ],
  guard: [
    BASE,
    { geo: G.body, color: "faction", pos: [0, 0.13, 0], scale: [1.15, 1, 1.15] },
    { geo: G.head, color: "#9a9a9a", pos: [0, 0.32, 0], metal: 0.6 },
    { geo: G.shield, color: "faction", pos: [0.11, 0.17, 0.02] },
    { geo: G.spear, color: "#cfc6b5", pos: [-0.1, 0.28, 0] },
  ],
  ranged: [
    BASE,
    { geo: G.body, color: "faction", pos: [0, 0.13, 0] },
    { geo: G.head, color: "#e0c8a8", pos: [0, 0.32, 0] },
    { geo: G.bow, color: WOOD, pos: [0.11, 0.2, 0] },
  ],
  heavy: [
    BASE,
    { geo: G.mount, color: "#5a4a3a", pos: [0, 0.08, 0] },
    { geo: G.body, color: "faction", pos: [0, 0.27, 0], scale: [1.3, 1, 1.3] },
    { geo: G.head, color: "#8a8f96", pos: [0, 0.47, 0], metal: 0.7 },
    { geo: G.shield, color: "#8a8f96", pos: [0.14, 0.3, 0.02], scale: [1, 1.4, 1.4], metal: 0.6 },
  ],
};

export const RESOURCE_MODEL = { geo: G.crystal };
export const RESOURCE_COLORS: Record<string, { color: string; emissive?: string }> = {
  iron: { color: "#5d5650", emissive: "#3a1d10" },
  stone_deposit: { color: "#cfc7b6" },
  game_herd: { color: "#8a5a35" },
  fish: { color: "#9fd2e6", emissive: "#1d4a5a" },
  sunstone: { color: "#ffd05a", emissive: "#a46a00" },
  relic: { color: "#b38cff", emissive: "#4a2a8a" },
  salt: { color: "#f3f1ea" },
};

export const POI_PARTS = { plinth: G.plinth, pillar: G.pillar, monolith: G.monolith, block: G.block };
