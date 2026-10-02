import type { Quest, QuestRequirement, QuestType, Resources } from "@echoes/game-types";
import { PLAYER_ID, RESOURCE_TYPES } from "@echoes/game-types";
import { isWater } from "@echoes/procedural-world";
import { UNITS } from "../content/units";
import type { EngineContext } from "../context";

/**
 * Procedural quests. The engine owns requirements, rewards and state transitions;
 * narrative AI may later rewrite only the title/description for presentation.
 */

const MAX_ACTIVE = 3;

function hasQuest(ctx: EngineContext, type: QuestType, tile: number | null): boolean {
  return ctx.state.quests.some((q) => q.type === type && q.status === "active" && (tile === null || q.tile === tile));
}

function issue(ctx: EngineContext, q: Omit<Quest, "id" | "status" | "issuedTurn" | "progress">): Quest {
  const quest: Quest = { ...q, id: ctx.id("q"), status: "active", issuedTurn: ctx.state.turn, progress: 0 };
  ctx.state.quests.push(quest);
  return quest;
}

export function generateQuests(ctx: EngineContext): Quest[] {
  const state = ctx.state;
  const created: Quest[] = [];
  const activeCount = (): number => state.quests.filter((q) => q.status === "active").length;
  const player = ctx.factionOrNull(PLAYER_ID);
  if (!player?.alive) return created;
  const own = ctx.settlementsOf(PLAYER_ID);
  const capital = own.find((s) => s.isCapital) ?? own[0];
  if (!capital) return created;
  const T = state.turn;

  // Rebellion warnings first: they are urgent.
  for (const s of own) {
    if (s.stability < 30 && !s.isCapital && !state.quests.some((q) => q.type === "investigate_rebellion" && q.status === "active" && q.requirement.kind === "settlement_stability" && q.requirement.settlementId === s.id)) {
      created.push(issue(ctx, {
        type: "investigate_rebellion", title: `Unrest in ${s.name}`,
        description: `${s.name} is close to open revolt. Raise its stability to 40 within 5 turns — station troops, reduce pollution, or improve food.`,
        expiresTurn: T + 5, requirement: { kind: "settlement_stability", settlementId: s.id, min: 40 },
        rewards: { influence: 15 }, rewardOpinion: null, sourceEventId: null, tile: s.tile,
      }));
    }
  }
  if (activeCount() >= MAX_ACTIVE) return created;

  // Restore a ruin within reach.
  const ruin = state.map.tiles.find((t) => (t.poi === "ancient_ruin" || t.poi === "ruins") && t.poiDiscovered && !t.ownerId && ctx.grid.distance(capital.tile, t.i) <= 9 && !hasQuest(ctx, "restore_ruin", t.i));
  if (ruin && activeCount() < MAX_ACTIVE) {
    created.push(issue(ctx, {
      type: "restore_ruin", title: `Restore the ruins of ${ruin.region}`,
      description: "Found a settlement on the ruined site to reclaim what was lost.",
      expiresTurn: T + 18, requirement: { kind: "building_on_tile", tile: ruin.i, buildingType: "settlement_center" },
      rewards: { knowledge: 40, influence: 25, stone: 30 }, rewardOpinion: null, sourceEventId: null, tile: ruin.i,
    }));
  }

  // Discover an uncharted site.
  if (activeCount() < MAX_ACTIVE) {
    const site = state.map.tiles
      .filter((t) => t.poi && !t.poiDiscovered && t.poi !== "ruins" && t.explored && ctx.grid.distance(capital.tile, t.i) <= 14)
      .sort((a, b) => ctx.grid.distance(capital.tile, a.i) - ctx.grid.distance(capital.tile, b.i) || a.i - b.i)[0]
      ?? state.map.tiles.filter((t) => t.poi && !t.poiDiscovered && ctx.grid.distance(capital.tile, t.i) <= 10).sort((a, b) => a.i - b.i)[0];
    if (site && !hasQuest(ctx, "discover_site", site.i)) {
      created.push(issue(ctx, {
        type: "discover_site", title: `Chart the unknown in ${site.region}`,
        description: "Scouts report something strange on the horizon. Send a unit to investigate the marked site.",
        expiresTurn: T + 15, requirement: { kind: "unit_on_tile", tile: site.i },
        rewards: { knowledge: 25, food: 20 }, rewardOpinion: null, sourceEventId: null, tile: site.i,
      }));
    }
  }

  // Negotiate peace in a long war.
  if (activeCount() < MAX_ACTIVE) {
    const war = state.relations.find((r) => r.status === "war" && (r.a === PLAYER_ID || r.b === PLAYER_ID) && T - r.sinceTurn >= 4);
    if (war) {
      const enemy = war.a === PLAYER_ID ? war.b : war.a;
      if (!state.quests.some((q) => q.type === "negotiate_peace" && q.status === "active")) {
        created.push(issue(ctx, {
          type: "negotiate_peace", title: `End the war with ${ctx.factionName(enemy)}`,
          description: "The war drains your people. Secure a ceasefire or peace.",
          expiresTurn: T + 10, requirement: { kind: "status_with", factionId: enemy, status: ["ceasefire", "peace", "alliance"] },
          rewards: { influence: 30, food: 20 }, rewardOpinion: { factionId: enemy, delta: 10 }, sourceEventId: null, tile: null,
        }));
      }
    }
  }

  // Defend a trade route from hostile units.
  if (activeCount() < MAX_ACTIVE && state.relations.some((r) => r.trade && (r.a === PLAYER_ID || r.b === PLAYER_ID))) {
    const threat = state.units.find((u) => u.ownerId !== PLAYER_ID && UNITS[u.type].military && own.some((s) => ctx.grid.distance(s.tile, u.tile) <= 4) && ctx.atWar(PLAYER_ID, u.ownerId));
    if (threat && !hasQuest(ctx, "defend_trade_route", null)) {
      const near = own.slice().sort((a, b) => ctx.grid.distance(a.tile, threat.tile) - ctx.grid.distance(b.tile, threat.tile))[0]!;
      created.push(issue(ctx, {
        type: "defend_trade_route", title: `Secure the roads of ${near.name}`,
        description: "Hostile forces threaten your caravans. Keep enemies away from the settlement for 3 consecutive turns.",
        expiresTurn: T + 10, requirement: { kind: "no_enemy_near", tile: near.tile, radius: 4, turns: 3 },
        rewards: { food: 30, influence: 15 }, rewardOpinion: null, sourceEventId: null, tile: near.tile,
      }));
    }
  }

  // Investigate unexplained weather.
  if (activeCount() < MAX_ACTIVE) {
    const ev = state.events.find((e) => e.status === "active" && (e.type === "drought" || e.type === "flood") && e.factionIds.includes(PLAYER_ID));
    if (ev && !state.quests.some((q) => q.type === "investigate_weather" && q.sourceEventId === ev.id)) {
      created.push(issue(ctx, {
        type: "investigate_weather", title: `Investigate the ${ev.type} in ${ev.region}`,
        description: "Send a unit to the heart of the affected region to study the strange weather.",
        expiresTurn: Math.min(ev.endsTurn + 2, T + 8), requirement: { kind: "unit_on_tile", tile: ev.centerTile },
        rewards: { knowledge: 30 }, rewardOpinion: null, sourceEventId: ev.id, tile: ev.centerTile,
      }));
    }
  }

  // Exploit a rare resource.
  if (activeCount() < MAX_ACTIVE) {
    const rare = state.map.tiles.find((t) => t.ownerId === PLAYER_ID && (t.resource?.type === "sunstone" || t.resource?.type === "relic" || t.resource?.type === "iron") && !t.buildingId);
    if (rare && !hasQuest(ctx, "exploit_rare_resource", rare.i)) {
      created.push(issue(ctx, {
        type: "exploit_rare_resource", title: `Tap the ${rare.resource!.type} of ${rare.region}`,
        description: `Build a Mine on the ${rare.resource!.type} deposit inside your territory.`,
        expiresTurn: T + 14, requirement: { kind: "building_on_tile", tile: rare.i, buildingType: "mine" },
        rewards: { metal: 25, knowledge: 20 }, rewardOpinion: null, sourceEventId: null, tile: rare.i,
      }));
    }
  }

  // Rescue a struggling settlement.
  if (activeCount() < MAX_ACTIVE) {
    const weak = own.find((s) => (s.hp < s.maxHp * 0.5 || s.stability < 40) && s.stability >= 30);
    if (weak && !state.quests.some((q) => q.type === "rescue_settlement" && q.status === "active")) {
      created.push(issue(ctx, {
        type: "rescue_settlement", title: `Rescue ${weak.name}`,
        description: `${weak.name} is struggling. Bring its stability to 55.`,
        expiresTurn: T + 8, requirement: { kind: "settlement_stability", settlementId: weak.id, min: 55 },
        rewards: { influence: 20, food: 15 }, rewardOpinion: null, sourceEventId: null, tile: weak.tile,
      }));
    }
  }
  return created;
}

function requirementMet(ctx: EngineContext, q: Quest): boolean {
  const r: QuestRequirement = q.requirement;
  switch (r.kind) {
    case "building_on_tile": {
      if (r.buildingType === "settlement_center") return ctx.settlementAt(r.tile)?.ownerId === PLAYER_ID;
      const b = ctx.buildingAt(r.tile);
      return !!b && b.ownerId === PLAYER_ID && b.turnsRemaining === 0 && (r.buildingType === null || b.type === r.buildingType);
    }
    case "unit_on_tile":
      return ctx.unitAt(r.tile)?.ownerId === PLAYER_ID;
    case "status_with":
      return r.status.includes(ctx.relation(PLAYER_ID, r.factionId).status);
    case "no_enemy_near": {
      const clear = !ctx.state.units.some((u) => u.ownerId !== PLAYER_ID && ctx.atWar(PLAYER_ID, u.ownerId) && ctx.grid.distance(u.tile, r.tile) <= r.radius);
      q.progress = clear ? q.progress + 1 : 0;
      return q.progress >= r.turns;
    }
    case "settlement_stability": {
      const s = ctx.settlement(r.settlementId);
      return !!s && s.ownerId === PLAYER_ID && s.stability >= r.min;
    }
    case "stockpile":
      return (ctx.faction(PLAYER_ID).resources[r.resource] ?? 0) >= r.amount;
  }
}

/** Evaluate active quests; returns report lines. */
export function evaluateQuests(ctx: EngineContext): string[] {
  const lines: string[] = [];
  for (const q of ctx.state.quests) {
    if (q.status !== "active") continue;
    if (requirementMet(ctx, q)) {
      q.status = "completed";
      ctx.grant(PLAYER_ID, q.rewards);
      if (q.rewardOpinion) ctx.remember(q.rewardOpinion.factionId, PLAYER_ID, "helped_in_crisis", q.rewardOpinion.delta);
      const reward = RESOURCE_TYPES.filter((r) => (q.rewards[r] ?? 0) > 0).map((r) => `+${q.rewards[r]} ${r}`).join(", ");
      lines.push(`Quest complete: ${q.title} (${reward})`);
      ctx.history({ type: "QUEST_COMPLETED", importance: 2, actorId: PLAYER_ID, targetId: null, tile: q.tile, summary: `${ctx.state.civilizationName} completed "${q.title}".`, effects: [reward], tags: ["quest", `quest:${q.type}`] });
    } else if (ctx.state.turn >= q.expiresTurn) {
      q.status = q.type === "investigate_rebellion" ? "failed" : "expired";
      lines.push(`Quest ${q.status}: ${q.title}`);
      if (q.type === "investigate_rebellion") {
        ctx.history({ type: "QUEST_FAILED", importance: 2, actorId: PLAYER_ID, targetId: null, tile: q.tile, summary: `${ctx.state.civilizationName} failed to calm the unrest: "${q.title}".`, tags: ["quest"] });
        // Failure consequence: the settlement's stability collapses, setting up rebellion.
        if (q.requirement.kind === "settlement_stability") {
          const s = ctx.settlement(q.requirement.settlementId);
          if (s) s.stability = Math.min(s.stability, 10);
        }
      }
    }
  }
  // Drop old finished quests from state (history keeps the record).
  ctx.state.quests = ctx.state.quests.filter((q) => q.status === "active" || ctx.state.turn - q.issuedTurn < 20);
  return lines;
}

export function questRewardsTotal(rewards: Partial<Resources>): number {
  return RESOURCE_TYPES.reduce((a, r) => a + (rewards[r] ?? 0), 0);
}

export function isQuestTileValid(ctx: EngineContext, tile: number): boolean {
  return !isWater(ctx.tile(tile).biome);
}
