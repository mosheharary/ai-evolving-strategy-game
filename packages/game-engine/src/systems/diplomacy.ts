import type { DiplomaticProposal, DiplomaticStatus, ResourceType } from "@echoes/game-types";
import { PLAYER_ID } from "@echoes/game-types";
import { clamp, round } from "@echoes/shared";
import { techModifiers } from "../content/techs";
import type { EngineContext } from "../context";

/**
 * Diplomacy rules. Relationships are numeric opinions (-100 hostile … +100 allied)
 * plus a status state machine with legal transitions:
 *
 *   peace ──declare_war──▶ war ──ceasefire──▶ ceasefire ──(expires)──▶ peace
 *   war ──peace──▶ peace          peace ──alliance──▶ alliance ──(break)──▶ war
 *   trade / sanctions are flags valid only outside of war.
 */

export const OPINION_LABEL = (v: number): string =>
  v <= -60 ? "hostile" : v <= -20 ? "unfriendly" : v < 20 ? "neutral" : v < 60 ? "friendly" : "devoted";

export function legalStatusTransition(from: DiplomaticStatus, to: DiplomaticStatus): boolean {
  const allowed: Record<DiplomaticStatus, DiplomaticStatus[]> = {
    peace: ["war", "alliance"],
    war: ["ceasefire", "peace"],
    ceasefire: ["peace", "war"],
    alliance: ["peace", "war"],
  };
  return allowed[from].includes(to);
}

export function declareWar(ctx: EngineContext, aggressor: string, target: string): string | null {
  const rel = ctx.relation(aggressor, target);
  if (rel.status === "war") return "Already at war.";
  if (rel.status === "ceasefire" && (rel.ceasefireUntil ?? 0) > ctx.state.turn) return "A ceasefire is in force.";
  const brokeAlliance = rel.status === "alliance";
  rel.status = "war";
  rel.sinceTurn = ctx.state.turn;
  rel.trade = false;
  rel.wars += 1;
  rel.ceasefireUntil = null;
  ctx.remember(target, aggressor, "attacked_us", -35);
  if (brokeAlliance) {
    ctx.remember(target, aggressor, "broke_treaty", -30);
    for (const f of ctx.aliveFactions()) if (f.id !== target && f.id !== aggressor) ctx.remember(f.id, aggressor, "broke_treaty", -10);
  }
  // Allies of the target resent the aggressor.
  for (const other of ctx.state.relations) {
    if (other.status !== "alliance") continue;
    if (other.a === target || other.b === target) {
      const ally = other.a === target ? other.b : other.a;
      if (ally !== aggressor) ctx.remember(ally, aggressor, "attacked_us", -15);
    }
  }
  ctx.history({
    type: aggressor === PLAYER_ID ? "PLAYER_DECLARED_WAR" : "WAR_DECLARED", importance: 3, actorId: aggressor, targetId: target,
    summary: `${ctx.factionName(aggressor)} declared war on ${ctx.factionName(target)}${brokeAlliance ? ", shattering their alliance" : ""}.`,
    effects: [`${ctx.factionName(target)} opinion -35`],
    tags: ["war", `faction:${aggressor}`, `faction:${target}`],
  });
  return null;
}

export function makeCeasefire(ctx: EngineContext, a: string, b: string): void {
  const rel = ctx.relation(a, b);
  rel.status = "ceasefire";
  rel.sinceTurn = ctx.state.turn;
  rel.ceasefireUntil = ctx.state.turn + 5;
  rel.treaties += 1;
  ctx.history({
    type: "DIPLOMATIC_TREATY_SIGNED", importance: 2, actorId: a, targetId: b,
    summary: `${ctx.factionName(a)} and ${ctx.factionName(b)} agreed to a ceasefire.`, tags: ["diplomacy", "ceasefire"],
  });
}

export function makePeace(ctx: EngineContext, a: string, b: string): void {
  const rel = ctx.relation(a, b);
  rel.status = "peace";
  rel.sinceTurn = ctx.state.turn;
  rel.ceasefireUntil = null;
  rel.treaties += 1;
  ctx.remember(a, b, "helped_in_crisis", 8);
  ctx.remember(b, a, "helped_in_crisis", 8);
  ctx.history({
    type: "DIPLOMATIC_TREATY_SIGNED", importance: 3, actorId: a, targetId: b,
    summary: `${ctx.factionName(a)} and ${ctx.factionName(b)} signed a peace treaty.`, tags: ["diplomacy", "peace"],
  });
}

export function formAlliance(ctx: EngineContext, a: string, b: string): void {
  const rel = ctx.relation(a, b);
  rel.status = "alliance";
  rel.sinceTurn = ctx.state.turn;
  rel.treaties += 1;
  ctx.remember(a, b, "alliance", 15);
  ctx.remember(b, a, "alliance", 15);
  ctx.history({
    type: "DIPLOMATIC_TREATY_SIGNED", importance: 3, actorId: a, targetId: b,
    summary: `${ctx.factionName(a)} and ${ctx.factionName(b)} forged an alliance.`, tags: ["diplomacy", "alliance"],
    effects: ["Shared defence", "Military units may cross each other's land"],
  });
}

export function openTrade(ctx: EngineContext, a: string, b: string): void {
  const rel = ctx.relation(a, b);
  rel.trade = true;
  rel.treaties += 1;
  ctx.remember(a, b, "trade_partner", 8);
  ctx.remember(b, a, "trade_partner", 8);
  ctx.history({
    type: "DIPLOMATIC_TREATY_SIGNED", importance: 2, actorId: a, targetId: b,
    summary: `${ctx.factionName(a)} and ${ctx.factionName(b)} opened a trade route.`, tags: ["diplomacy", "trade"],
    effects: ["Both sides gain trade income each turn", "Tiles along the route grow prosperous"],
  });
}

export function sanction(ctx: EngineContext, by: string, target: string): string | null {
  const rel = ctx.relation(by, target);
  if (rel.status === "war") return "Sanctions are meaningless during war.";
  if (rel.sanctionsBy.includes(by)) return "Sanctions already in place.";
  rel.sanctionsBy = [...rel.sanctionsBy, by].sort();
  rel.trade = false;
  ctx.remember(target, by, "sanctioned_us", -15);
  ctx.history({
    type: "DIPLOMATIC_ACTION", importance: 2, actorId: by, targetId: target,
    summary: `${ctx.factionName(by)} imposed sanctions on ${ctx.factionName(target)}.`,
    effects: [`${ctx.factionName(target)} influence income reduced`, "Trade suspended"], tags: ["diplomacy", "sanctions"],
  });
  return null;
}

export function liftSanction(ctx: EngineContext, by: string, target: string): string | null {
  const rel = ctx.relation(by, target);
  if (!rel.sanctionsBy.includes(by)) return "No sanctions to lift.";
  rel.sanctionsBy = rel.sanctionsBy.filter((x) => x !== by);
  ctx.remember(target, by, "gift", 5);
  return null;
}

export function gift(ctx: EngineContext, from: string, to: string, resource: ResourceType, amount: number): string | null {
  const giver = ctx.faction(from);
  if ((giver.resources[resource] ?? 0) < amount) return `Not enough ${resource}.`;
  ctx.pay(from, { [resource]: amount });
  ctx.grant(to, { [resource]: amount });
  const receiver = ctx.faction(to);
  const valued = resource === "influence" ? 1.5 : resource === "food" && receiver.archetype === "nomadic" ? 1.4 :
    resource === "metal" && receiver.archetype === "aggressive" ? 1.4 : resource === "knowledge" && receiver.archetype === "technocratic" ? 1.4 : 1;
  const delta = clamp(round((amount / 6) * valued, 1), 1, 18);
  ctx.remember(to, from, "gift", delta);
  ctx.history({
    type: "DIPLOMATIC_ACTION", importance: 1, actorId: from, targetId: to,
    summary: `${ctx.factionName(from)} sent a gift of ${amount} ${resource} to ${ctx.factionName(to)}.`, effects: [`Opinion +${delta}`],
    tags: ["diplomacy", "gift"],
  });
  return null;
}

export const ESPIONAGE_COST = 15;

export function espionage(ctx: EngineContext, from: string, target: string): { ok: boolean; lines: string[] } {
  const spy = ctx.faction(from);
  const victim = ctx.faction(target);
  ctx.pay(from, { influence: ESPIONAGE_COST });
  const scienceEdge = techModifiers(spy.research.known).knowledgeMult - techModifiers(victim.research.known).knowledgeMult;
  const p = clamp(0.6 + scienceEdge * 0.3, 0.3, 0.85);
  if (ctx.rng.chance(p)) {
    const stolen = Math.max(5, Math.min(30, Math.round(victim.resources.knowledge * 0.3)));
    ctx.grant(from, { knowledge: stolen });
    // Reveal the victim's territory to the player.
    if (from === PLAYER_ID) {
      for (const t of ctx.state.map.tiles) if (t.ownerId === target) t.explored = true;
    }
    ctx.history({
      type: "DIPLOMATIC_ACTION", importance: 1, actorId: from, targetId: target,
      summary: `Agents of ${ctx.factionName(from)} infiltrated ${victim.name} and stole ${stolen} knowledge.`, tags: ["espionage"],
    });
    return { ok: true, lines: [`Espionage succeeded: +${stolen} knowledge, their lands revealed.`] };
  }
  ctx.remember(target, from, "espionage_caught", -20);
  ctx.history({
    type: "DIPLOMATIC_ACTION", importance: 2, actorId: from, targetId: target,
    summary: `${victim.name} caught spies of ${ctx.factionName(from)}.`, effects: ["Opinion -20"], tags: ["espionage", "scandal"],
  });
  return { ok: false, lines: ["Your agents were caught. Relations suffer."] };
}

/** Deterministic acceptance probability — used when no AI answer is available, and as a sanity check. */
export function deterministicAcceptance(ctx: EngineContext, p: DiplomaticProposal): number {
  const receiver = ctx.faction(p.to);
  const opinion = receiver.opinions[p.from] ?? 0;
  const rel = ctx.relation(p.from, p.to);
  switch (p.type) {
    case "trade":
      if (rel.status === "war" || rel.sanctionsBy.length > 0) return 0;
      return clamp(0.35 + opinion / 100 + receiver.personality.mercantile * 0.4, 0, 1);
    case "alliance":
      return opinion >= 50 ? clamp(0.4 + (opinion - 50) / 60, 0, 1) : 0.05;
    case "ceasefire": {
      const weariness = (ctx.state.turn - rel.sinceTurn) / 10;
      return clamp(0.25 + weariness + opinion / 200 - receiver.personality.aggression * 0.3, 0, 1);
    }
    case "peace": {
      const weariness = (ctx.state.turn - rel.sinceTurn) / 12;
      return clamp(0.15 + weariness + opinion / 150 - receiver.personality.aggression * 0.3, 0, 1);
    }
  }
}

/** Is the proposal still legal right now? Prevents AI from accepting impossible deals. */
export function proposalStillLegal(ctx: EngineContext, p: DiplomaticProposal): boolean {
  const a = ctx.factionOrNull(p.from);
  const b = ctx.factionOrNull(p.to);
  if (!a?.alive || !b?.alive) return false;
  const rel = ctx.relation(p.from, p.to);
  switch (p.type) {
    case "trade":
      return rel.status !== "war" && !rel.trade && rel.sanctionsBy.length === 0;
    case "alliance": {
      const proposerMods = techModifiers(a.research.known);
      return rel.status === "peace" && (a.kind === "ai" || proposerMods.allowAlliance > 0);
    }
    case "ceasefire":
      return rel.status === "war";
    case "peace":
      return rel.status === "war" || rel.status === "ceasefire";
  }
}

export function applyProposal(ctx: EngineContext, p: DiplomaticProposal): void {
  switch (p.type) {
    case "trade":
      openTrade(ctx, p.from, p.to);
      break;
    case "alliance":
      formAlliance(ctx, p.from, p.to);
      break;
    case "ceasefire":
      makeCeasefire(ctx, p.from, p.to);
      break;
    case "peace":
      makePeace(ctx, p.from, p.to);
      break;
  }
}

/** Per-turn diplomacy upkeep: ceasefire expiry, opinion drift toward baseline, trade warmth. */
export function tickDiplomacy(ctx: EngineContext): void {
  const state = ctx.state;
  for (const rel of state.relations) {
    if (rel.status === "ceasefire" && rel.ceasefireUntil !== null && rel.ceasefireUntil <= state.turn) {
      rel.status = "peace";
      rel.ceasefireUntil = null;
      rel.sinceTurn = state.turn;
    }
  }
  // Border friction: neighbours with touching territory grate on each other, scaled by aggression.
  const touching = new Set<string>();
  for (const t of state.map.tiles) {
    if (!t.ownerId) continue;
    for (const n of ctx.grid.neighbors(t.i)) {
      const o = state.map.tiles[n]?.ownerId;
      if (o && o !== t.ownerId) touching.add(`${t.ownerId}|${o}`);
    }
  }
  for (const f of state.factions) {
    if (f.kind !== "ai" || !f.alive) continue;
    for (const other of Object.keys(f.opinions).sort()) {
      if (touching.has(`${f.id}|${other}`)) f.opinions[other] = clamp(round((f.opinions[other] ?? 0) - (0.12 + f.personality.aggression * 0.75), 1), -100, 100);
    }
  }
  for (const f of state.factions) {
    if (f.kind !== "ai" || !f.alive) continue;
    for (const other of Object.keys(f.opinions).sort()) {
      let v = f.opinions[other] ?? 0;
      const rel = ctx.relation(f.id, other);
      // Long-memory factions drift back to neutral more slowly.
      const drift = 0.6 * (1.1 - f.personality.memory);
      if (v > 0) v = Math.max(0, v - drift);
      else if (v < 0) v = Math.min(0, v + drift);
      if (rel.trade) {
        const partner = ctx.factionOrNull(other);
        v += 0.6 + (partner ? techModifiers(partner.research.known).tradeOpinionDrift : 0);
      }
      if (rel.status === "alliance") v += 0.4;
      if (rel.status === "war") v -= 0.8;
      f.opinions[other] = clamp(round(v, 1), -100, 100);
    }
  }
}
