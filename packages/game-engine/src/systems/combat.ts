import type { GameState, Settlement, Unit } from "@echoes/game-types";
import { getGrid } from "@echoes/procedural-world";
import { clamp, round, type SeededRandom } from "@echoes/shared";
import { techModifiers } from "../content/techs";
import { DEFENSE_TERRAIN, UNITS } from "../content/units";
import type { EngineContext } from "../context";
import { releaseTerritory, transferTerritory } from "./territory";

/**
 * Deterministic combat. Damage is computed from:
 *   attackPower, defensePower, terrainModifier, technologyModifier, moraleModifier,
 *   flanking, fortification, walls — and a SeededRandom variance roll.
 * No AI provider is ever involved in calculating combat outcomes.
 */

export interface CombatPreview {
  attackPower: number;
  defensePower: number;
  expectedDamage: number;
  expectedCounter: number;
  ratio: number;
}

export interface CombatResult extends CombatPreview {
  damage: number;
  counter: number;
  defenderDestroyed: boolean;
  attackerDestroyed: boolean;
  settlementOutcome: "none" | "damaged" | "captured" | "razed";
  lines: string[];
}

const hpFactor = (hp: number, max: number): number => 0.5 + 0.5 * (hp / Math.max(1, max));
const moraleFactor = (m: number): number => 0.75 + 0.5 * (m / 100);

function flankCount(state: GameState, attacker: Unit, targetTile: number): number {
  const grid = getGrid(state.map.width, state.map.height);
  let n = 0;
  for (const nb of grid.neighbors(targetTile)) {
    const u = state.units.find((x) => x.tile === nb);
    if (u && u.id !== attacker.id && u.ownerId === attacker.ownerId && UNITS[u.type].military) n++;
  }
  return n;
}

export function attackPower(state: GameState, attacker: Unit, targetTile: number): number {
  const def = UNITS[attacker.type];
  const owner = state.factions.find((f) => f.id === attacker.ownerId);
  const mods = techModifiers(owner?.research.known ?? []);
  const flank = Math.min(3, flankCount(state, attacker, targetTile)) * 0.1 * (1 + mods.flankMult);
  return round(def.attack * hpFactor(attacker.hp, attacker.maxHp) * moraleFactor(attacker.morale + mods.morale) * (1 + mods.attackMult) * (1 + flank), 2);
}

export function unitDefensePower(state: GameState, defender: Unit): number {
  const def = UNITS[defender.type];
  const owner = state.factions.find((f) => f.id === defender.ownerId);
  const mods = techModifiers(owner?.research.known ?? []);
  const tile = state.map.tiles[defender.tile];
  let terrain = tile ? DEFENSE_TERRAIN[tile.biome] ?? 1 : 1;
  if (tile?.river) terrain *= 1.1;
  const fort = defender.status === "fortified" ? 1.25 : 1;
  const inSettlement = state.settlements.some((s) => s.tile === defender.tile && s.ownerId === defender.ownerId);
  const grid = getGrid(state.map.width, state.map.height);
  const tower = state.buildings.some(
    (b) => b.type === "watchtower" && b.ownerId === defender.ownerId && b.turnsRemaining === 0 && grid.distance(b.tile, defender.tile) <= 1,
  );
  return round(
    def.defense * hpFactor(defender.hp, defender.maxHp) * moraleFactor(defender.morale + mods.morale) * (1 + mods.defenseMult) *
      terrain * fort * (inSettlement ? 1.25 : 1) * (tower ? 1.15 : 1),
    2,
  );
}

export function settlementDefensePower(state: GameState, s: Settlement): number {
  const owner = state.factions.find((f) => f.id === s.ownerId);
  const mods = techModifiers(owner?.research.known ?? []);
  const wall = state.buildings.some((b) => b.settlementId === s.id && b.type === "wall" && b.turnsRemaining === 0);
  const tile = state.map.tiles[s.tile];
  const terrain = tile ? DEFENSE_TERRAIN[tile.biome] ?? 1 : 1;
  return round((8 + s.population * 1.5) * hpFactor(s.hp, s.maxHp) * (wall ? 1.5 : 1) * (1 + mods.settlementDefense) * terrain, 2);
}

export function previewAttack(state: GameState, attacker: Unit, targetTile: number): CombatPreview | null {
  const defender = state.units.find((u) => u.tile === targetTile);
  const settlement = state.settlements.find((s) => s.tile === targetTile);
  if (!defender && !settlement) return null;
  const a = attackPower(state, attacker, targetTile);
  const d = defender ? unitDefensePower(state, defender) : settlementDefensePower(state, settlement!);
  const ratio = a / (a + d);
  const ranged = UNITS[attacker.type].range >= 2;
  return {
    attackPower: a,
    defensePower: d,
    ratio: round(ratio, 3),
    expectedDamage: Math.round(40 * ratio),
    expectedCounter: ranged ? 0 : Math.round(40 * (1 - ratio) * (defender ? 0.6 : 0.3)),
  };
}

function roll(rng: SeededRandom): number {
  return 0.8 + rng.next() * 0.4;
}

export function canAttack(state: GameState, attacker: Unit, targetTile: number): string | null {
  const def = UNITS[attacker.type];
  if (!def.military && attacker.type !== "explorer") return "This unit cannot attack.";
  if (def.attack <= 0) return "This unit cannot attack.";
  if (attacker.attacked) return "This unit has already attacked this turn.";
  if (attacker.movesLeft <= 0) return "This unit has no actions left.";
  const grid = getGrid(state.map.width, state.map.height);
  const dist = grid.distance(attacker.tile, targetTile);
  if (dist < 1 || dist > Math.max(1, def.range)) return "Target is out of range.";
  const defender = state.units.find((u) => u.tile === targetTile);
  const settlement = state.settlements.find((s) => s.tile === targetTile);
  const targetOwner = defender?.ownerId ?? settlement?.ownerId;
  if (!targetOwner) return "There is nothing to attack there.";
  if (targetOwner === attacker.ownerId) return "You cannot attack your own forces.";
  const [a, b] = attacker.ownerId < targetOwner ? [attacker.ownerId, targetOwner] : [targetOwner, attacker.ownerId];
  const rel = state.relations.find((r) => r.key === `${a}|${b}`);
  if (rel?.status !== "war") return "You must be at war to attack.";
  return null;
}

/** Resolve an attack. Assumes canAttack() already passed. */
export function resolveAttack(ctx: EngineContext, attacker: Unit, targetTile: number, raze = false): CombatResult {
  const state = ctx.state;
  const preview = previewAttack(state, attacker, targetTile)!;
  const defender = ctx.unitAt(targetTile);
  const settlement = ctx.settlementAt(targetTile);
  const ranged = UNITS[attacker.type].range >= 2;
  const lines: string[] = [];
  const attackerName = ctx.factionName(attacker.ownerId);
  attacker.attacked = true;
  attacker.movesLeft = 0;
  attacker.status = "exhausted";

  let damage = 0;
  let counter = 0;
  let defenderDestroyed = false;
  let settlementOutcome: CombatResult["settlementOutcome"] = "none";

  if (defender) {
    damage = Math.max(1, Math.round(40 * preview.ratio * roll(ctx.rng)));
    defender.hp = Math.max(0, defender.hp - damage);
    defender.morale = clamp(defender.morale - 8, 0, 100);
    lines.push(`${attackerName}'s ${UNITS[attacker.type].name} hits ${ctx.factionName(defender.ownerId)}'s ${UNITS[defender.type].name} for ${damage}.`);
    if (defender.hp <= 0) {
      defenderDestroyed = true;
      state.units = state.units.filter((u) => u.id !== defender.id);
      ctx.invalidateUnits();
      attacker.xp += 2;
      attacker.morale = clamp(attacker.morale + 10, 0, 100);
      lines.push(`The ${UNITS[defender.type].name} is destroyed.`);
      onDefeat(ctx, attacker.ownerId, defender.ownerId, "unit");
      ctx.history({
        type: "UNIT_DEFEATED", importance: 1, actorId: attacker.ownerId, targetId: defender.ownerId, tile: targetTile,
        summary: `${attackerName} destroyed a ${UNITS[defender.type].name} of ${ctx.factionName(defender.ownerId)} in ${ctx.tile(targetTile).region}.`,
        tags: ["combat"],
      });
    } else if (!ranged) {
      counter = Math.round(40 * (1 - preview.ratio) * 0.6 * roll(ctx.rng));
    }
  } else if (settlement) {
    damage = Math.max(1, Math.round(40 * preview.ratio * roll(ctx.rng)));
    settlement.hp = Math.max(0, settlement.hp - damage);
    settlement.stability = clamp(settlement.stability - 5, 0, 100);
    settlementOutcome = "damaged";
    lines.push(`${attackerName} assaults ${settlement.name} for ${damage} damage.`);
    ctx.history({
      type: "FACTION_ATTACKED_SETTLEMENT", importance: 2, actorId: attacker.ownerId, targetId: settlement.ownerId, tile: targetTile,
      summary: `${attackerName} attacked ${settlement.name}.`, tags: ["combat", "war"],
    });
    ctx.remember(settlement.ownerId, attacker.ownerId, "attacked_us", -6);
    if (!ranged) counter = Math.round(40 * (1 - preview.ratio) * 0.3 * roll(ctx.rng));
    if (settlement.hp <= 0 && !ranged) {
      settlementOutcome = raze ? "razed" : "captured";
      if (raze) razeSettlement(ctx, settlement, attacker.ownerId);
      else captureSettlement(ctx, settlement, attacker.ownerId);
      lines.push(raze ? `${settlement.name} is razed to the ground.` : `${settlement.name} falls to ${attackerName}.`);
      // Melee attacker moves in.
      attacker.prevTile = attacker.tile;
      attacker.tile = targetTile;
      ctx.invalidateUnits();
    }
  }

  let attackerDestroyed = false;
  if (counter > 0) {
    attacker.hp = Math.max(0, attacker.hp - counter);
    lines.push(`Counter-attack deals ${counter}.`);
    if (attacker.hp <= 0) {
      attackerDestroyed = true;
      state.units = state.units.filter((u) => u.id !== attacker.id);
      ctx.invalidateUnits();
      lines.push(`The attacking ${UNITS[attacker.type].name} falls.`);
      const victimOwner = defender?.ownerId ?? settlement?.ownerId;
      if (victimOwner) onDefeat(ctx, victimOwner, attacker.ownerId, "unit");
    }
  }
  return { ...preview, damage, counter, defenderDestroyed, attackerDestroyed, settlementOutcome, lines };
}

function onDefeat(ctx: EngineContext, winner: string, loser: string, _what: "unit" | "settlement"): void {
  const lf = ctx.factionOrNull(loser);
  if (lf && winner === "player") lf.defeatsByPlayer += 1;
  ctx.remember(loser, winner, "defeated_us", -4);
}

export function captureSettlement(ctx: EngineContext, s: Settlement, newOwner: string): void {
  const oldOwner = s.ownerId;
  const old = ctx.factionOrNull(oldOwner);
  if (old) old.settlementsLost += 1;
  if (newOwner === "player" && old) old.defeatsByPlayer += 2;
  transferTerritory(ctx, s, newOwner);
  s.ownerId = newOwner;
  s.hp = Math.round(s.maxHp * 0.4);
  s.stability = 30;
  s.population = Math.max(1, Math.floor(s.population * 0.7));
  s.training = null;
  s.isCapital = false;
  ctx.remember(oldOwner, newOwner, "captured_settlement", -30);
  ctx.history({
    type: "SETTLEMENT_CAPTURED", importance: 3, actorId: newOwner, targetId: oldOwner, tile: s.tile,
    summary: `${ctx.factionName(newOwner)} captured ${s.name} from ${ctx.factionName(oldOwner)}.`,
    effects: [`${s.name} changes hands`, `${ctx.factionName(oldOwner)} opinion of ${ctx.factionName(newOwner)} plummets`],
    tags: ["war", "conquest"],
  });
  checkElimination(ctx, oldOwner);
}

export function razeSettlement(ctx: EngineContext, s: Settlement, by: string): void {
  const oldOwner = s.ownerId;
  const old = ctx.factionOrNull(oldOwner);
  if (old) old.settlementsLost += 1;
  for (const b of ctx.state.buildings.filter((x) => x.settlementId === s.id)) {
    const t = ctx.tile(b.tile);
    t.buildingId = null;
  }
  ctx.state.buildings = ctx.state.buildings.filter((b) => b.settlementId !== s.id);
  releaseTerritory(ctx, s.id);
  const tile = ctx.tile(s.tile);
  tile.poi = "ruins";
  tile.poiDiscovered = true;
  tile.habitat = Math.max(0, tile.habitat - 20);
  ctx.state.settlements = ctx.state.settlements.filter((x) => x.id !== s.id);
  ctx.remember(oldOwner, by, "razed_settlement", -45);
  for (const f of ctx.aliveFactions()) {
    if (f.id !== oldOwner && f.id !== by && f.kind === "ai") ctx.remember(f.id, by, "razed_settlement", -6);
  }
  ctx.history({
    type: "SETTLEMENT_RAZED", importance: 3, actorId: by, targetId: oldOwner, tile: s.tile,
    summary: `${ctx.factionName(by)} razed ${s.name}, founded by ${ctx.factionName(s.founderId)}. Only ruins remain.`,
    effects: [`${s.name} destroyed`, "Ruins left on the map", "Neighbours remember the destruction"],
    tags: ["war", "ruins", `founder:${s.founderId}`, `settlement:${s.name}`],
  });
  checkElimination(ctx, oldOwner);
}

export function checkElimination(ctx: EngineContext, factionId: string): void {
  const f = ctx.factionOrNull(factionId);
  if (!f || !f.alive) return;
  if (ctx.settlementsOf(factionId).length > 0) return;
  if (f.kind === "player") return; // defeat is handled by victory checks
  f.alive = false;
  f.eliminatedTurn = ctx.state.turn;
  ctx.state.units = ctx.state.units.filter((u) => u.ownerId !== factionId);
  ctx.invalidateUnits();
  for (const rel of ctx.state.relations) {
    if (rel.a === factionId || rel.b === factionId) {
      rel.status = "peace";
      rel.trade = false;
    }
  }
  ctx.history({
    type: "FACTION_ELIMINATED", importance: 3, actorId: null, targetId: factionId, tile: null,
    summary: `${f.name} has fallen. Their people scatter across the frontier.`,
    tags: ["faction", `faction:${factionId}`],
  });
}
