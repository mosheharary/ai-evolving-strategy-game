import { resourceLabel } from "./content/labels";
import type { GameCommand, GameState, PoiType, Resources } from "@echoes/game-types";
import { PLAYER_ID } from "@echoes/game-types";
import { BUILDINGS } from "./content/buildings";
import { techModifiers } from "./content/techs";
import { UNITS } from "./content/units";
import { EngineContext } from "./context";
import { canAttack, resolveAttack } from "./systems/combat";
import { canBuild, canTrain, foundSettlement, placeBuilding, startTraining } from "./systems/construction";
import { declareWar, espionage, ESPIONAGE_COST, gift, liftSanction, applyProposal, proposalStillLegal, sanction } from "./systems/diplomacy";
import { createEvent } from "./systems/events";
import { reachableTiles } from "./systems/movement";
import { canResearch, startResearch } from "./systems/research";
import { updatePlayerVision } from "./systems/territory";

export interface CommandResult {
  ok: boolean;
  state: GameState;
  error: string | null;
  lines: string[];
  /** Tiles the client should highlight/focus after the command. */
  focusTiles: number[];
  /** Hints for the server: autosave / presentation triggers. */
  triggers: ("major_diplomacy" | "discovery" | "combat" | "research_started")[];
}

export class CommandRejected extends Error {}

const reject = (msg: string): never => {
  throw new CommandRejected(msg);
};

/**
 * Validate and execute one player command against a *copy* of the state.
 * Pure: returns the new state; the input state is never mutated. END_TURN is
 * handled by the turn pipeline, not here.
 */
export function executeCommand(state: GameState, command: GameCommand): CommandResult {
  if (state.victory.winner) return { ok: false, state, error: "The campaign has ended.", lines: [], focusTiles: [], triggers: [] };
  if (state.phase !== "PLANNING" && state.phase !== "PLAYER_ACTIONS") {
    return { ok: false, state, error: "Commands are only accepted during your turn.", lines: [], focusTiles: [], triggers: [] };
  }
  if (command.turn !== state.turn) return { ok: false, state, error: `Stale command for turn ${command.turn}; current turn is ${state.turn}.`, lines: [], focusTiles: [], triggers: [] };
  if (command.playerId !== PLAYER_ID) return { ok: false, state, error: "Unknown player.", lines: [], focusTiles: [], triggers: [] };
  if (command.type === "END_TURN") return { ok: false, state, error: "END_TURN is processed by the turn pipeline.", lines: [], focusTiles: [], triggers: [] };

  const draft = structuredClone(state);
  const ctx = new EngineContext(draft);
  draft.phase = "PLAYER_ACTIONS";
  const lines: string[] = [];
  const focusTiles: number[] = [];
  const triggers: CommandResult["triggers"] = [];
  try {
    switch (command.type) {
      case "MOVE_UNIT": {
        const u = ctx.unit(command.payload.unitId) ?? reject("Unknown unit.");
        if (u.ownerId !== PLAYER_ID) reject("Not your unit.");
        const reach = reachableTiles(draft, u);
        const cost = reach.get(command.payload.to);
        if (cost === undefined) reject("That tile is out of reach.");
        u.prevTile = u.tile;
        u.tile = command.payload.to;
        u.movesLeft = Math.max(0, u.movesLeft - cost!);
        u.status = u.movesLeft > 0 ? "idle" : "moved";
        ctx.invalidateUnits();
        updatePlayerVision(ctx);
        const found = checkDiscovery(ctx, u.id);
        if (found.length > 0) {
          lines.push(...found);
          triggers.push("discovery");
        }
        focusTiles.push(u.tile);
        break;
      }
      case "ATTACK": {
        const u = ctx.unit(command.payload.unitId) ?? reject("Unknown unit.");
        if (u.ownerId !== PLAYER_ID) reject("Not your unit.");
        const why = canAttack(draft, u, command.payload.target);
        if (why) reject(why);
        const r = resolveAttack(ctx, u, command.payload.target, command.payload.raze ?? false);
        lines.push(...r.lines);
        focusTiles.push(command.payload.target);
        triggers.push("combat");
        if (r.settlementOutcome === "captured" || r.settlementOutcome === "razed") triggers.push("major_diplomacy");
        updatePlayerVision(ctx);
        break;
      }
      case "BUILD_STRUCTURE": {
        const { buildingType, tile, workerId } = command.payload;
        const why = canBuild(draft, PLAYER_ID, buildingType, tile, workerId);
        if (why) reject(why);
        if (buildingType === "settlement_center") {
          ctx.pay(PLAYER_ID, BUILDINGS.settlement_center.cost);
          draft.units = draft.units.filter((x) => x.id !== workerId);
          ctx.invalidateUnits();
          const s = foundSettlement(ctx, PLAYER_ID, tile);
          lines.push(`${s.name} is founded.`);
          updatePlayerVision(ctx);
        } else {
          placeBuilding(ctx, PLAYER_ID, buildingType, tile);
          const def = BUILDINGS[buildingType];
          lines.push(def.buildTurns > 0 ? `Construction of a ${def.name} begins (${def.buildTurns} turn${def.buildTurns > 1 ? "s" : ""}).` : `${def.name} built.`);
        }
        focusTiles.push(tile);
        break;
      }
      case "GATHER_RESOURCE": {
        const u = ctx.unit(command.payload.unitId) ?? reject("Unknown unit.");
        if (u.ownerId !== PLAYER_ID || u.type !== "worker") reject("Only your Workers can gather.");
        if (u.movesLeft <= 0) reject("This Worker has no actions left this turn.");
        const t = ctx.tile(u.tile);
        const gained: Partial<Resources> = {};
        if (t.resource && t.resource.amount > 0) {
          const map: Record<string, keyof Resources> = { iron: "metal", stone_deposit: "stone", game_herd: "food", fish: "food", sunstone: "energy", relic: "knowledge", salt: "influence" };
          const res = map[t.resource.type] ?? "stone";
          const amt = Math.min(12, t.resource.amount);
          t.resource.amount -= amt;
          gained[res] = amt;
          if (t.resource.amount <= 0) {
            ctx.history({ type: "RESOURCE_DEPLETED", importance: 1, actorId: PLAYER_ID, targetId: null, tile: t.i, summary: `Workers stripped the last ${resourceLabel(t.resource.type)} from ${t.region}.`, tags: ["depletion"] });
            t.resource = null;
          }
        } else if (t.forest >= 10) {
          const amt = Math.round(Math.min(10, t.forest / 6));
          t.forest = Math.max(0, t.forest - 6);
          gained.wood = amt;
          if (t.forest < 8 && (t.biome === "forest" || t.biome === "taiga")) {
            t.biome = "scrubland";
            ctx.remember("verdant", PLAYER_ID, "deforested", -4);
            ctx.history({ type: "TERRAIN_CHANGED", importance: 2, actorId: PLAYER_ID, targetId: null, tile: t.i, summary: `${draft.civilizationName} felled the last trees in ${t.region}.`, effects: ["Forest becomes scrubland"], tags: ["ecology", "deforestation"] });
          }
        } else if (t.biome === "hills" || t.biome === "mountain" || t.biome === "desert") {
          gained.stone = 5;
        } else if (t.fertility > 30) {
          gained.food = 6;
          t.fertility = Math.max(5, t.fertility - 2);
        } else reject("Nothing worth gathering here.");
        ctx.grant(PLAYER_ID, gained);
        u.movesLeft = 0;
        u.status = "moved";
        lines.push(`Gathered ${Object.entries(gained).map(([k, v]) => `+${v} ${k}`).join(", ")}.`);
        focusTiles.push(u.tile);
        break;
      }
      case "TRAIN_UNIT": {
        const why = canTrain(draft, PLAYER_ID, command.payload.settlementId, command.payload.unitType);
        if (why) reject(why);
        startTraining(ctx, PLAYER_ID, command.payload.settlementId, command.payload.unitType);
        lines.push(`Training ${UNITS[command.payload.unitType].name}.`);
        break;
      }
      case "RESEARCH_TECH": {
        const why = canResearch(draft, PLAYER_ID, command.payload.techId);
        if (why) reject(why);
        startResearch(ctx, PLAYER_ID, command.payload.techId);
        triggers.push("research_started");
        lines.push("Research begins.");
        break;
      }
      case "DECLARE_TRADE":
        lines.push(propose(ctx, command.payload.factionId, "trade"));
        break;
      case "DIPLOMACY_ACTION": {
        const { factionId, action, resource, amount } = command.payload;
        const target = ctx.factionOrNull(factionId);
        if (!target || !target.alive || target.kind !== "ai") reject("Unknown faction.");
        switch (action) {
          case "gift": {
            if (!resource || !amount) reject("Choose a resource and amount to gift.");
            const err = gift(ctx, PLAYER_ID, factionId, resource!, amount!);
            if (err) reject(err);
            lines.push(`Gift delivered to ${target!.name}.`);
            break;
          }
          case "propose_alliance":
            if (techModifiers(ctx.faction(PLAYER_ID).research.known).allowAlliance <= 0) reject("Requires the Diplomacy technology.");
            lines.push(propose(ctx, factionId, "alliance"));
            break;
          case "propose_peace":
            lines.push(propose(ctx, factionId, "peace"));
            break;
          case "propose_ceasefire":
            lines.push(propose(ctx, factionId, "ceasefire"));
            break;
          case "declare_war": {
            const err = declareWar(ctx, PLAYER_ID, factionId);
            if (err) reject(err);
            draft.proposals = draft.proposals.filter((p) => !(p.from === factionId && p.to === PLAYER_ID) && !(p.from === PLAYER_ID && p.to === factionId));
            lines.push(`You are now at war with ${target!.name}.`);
            triggers.push("major_diplomacy");
            break;
          }
          case "sanction": {
            const err = sanction(ctx, PLAYER_ID, factionId);
            if (err) reject(err);
            lines.push(`Sanctions imposed on ${target!.name}.`);
            break;
          }
          case "lift_sanction": {
            const err = liftSanction(ctx, PLAYER_ID, factionId);
            if (err) reject(err);
            lines.push(`Sanctions on ${target!.name} lifted.`);
            break;
          }
          case "espionage": {
            if (ctx.faction(PLAYER_ID).resources.influence < ESPIONAGE_COST) reject(`Espionage costs ${ESPIONAGE_COST} influence.`);
            if (draft.history.some((h) => h.turn === draft.turn && h.tags.includes("espionage") && h.actorId === PLAYER_ID)) reject("Your agents are already deployed this turn.");
            const r = espionage(ctx, PLAYER_ID, factionId);
            lines.push(...r.lines);
            break;
          }
        }
        break;
      }
      case "RESPOND_PROPOSAL": {
        const p = draft.proposals.find((x) => x.id === command.payload.proposalId && x.to === PLAYER_ID) ?? reject("No such proposal.");
        draft.proposals = draft.proposals.filter((x) => x.id !== p.id);
        if (command.payload.accept) {
          if (!proposalStillLegal(ctx, p)) reject("That proposal is no longer possible.");
          applyProposal(ctx, p);
          lines.push(`Accepted the ${p.type} proposal from ${ctx.factionName(p.from)}.`);
          triggers.push("major_diplomacy");
        } else {
          ctx.remember(p.from, PLAYER_ID, "sanctioned_us", -3);
          lines.push(`Declined the ${p.type} proposal from ${ctx.factionName(p.from)}.`);
        }
        break;
      }
      case "CLAIM_TERRITORY": {
        const t = ctx.tileOrNull(command.payload.tile) ?? reject("Invalid tile.");
        if (t.ownerId === PLAYER_ID) reject("You already own this land.");
        if (ctx.settlementAt(t.i) || t.buildingId) reject("You cannot claim developed land.");
        const adjacent = ctx.grid.neighbors(t.i).some((n) => ctx.tile(n).ownerId === PLAYER_ID);
        if (!adjacent) reject("Claims must border your territory.");
        const home = ctx.settlementsOf(PLAYER_ID).filter((s) => ctx.grid.distance(s.tile, t.i) <= 3).sort((a, b) => ctx.grid.distance(a.tile, t.i) - ctx.grid.distance(b.tile, t.i))[0];
        if (!home) reject("Claims must be within 3 tiles of one of your settlements.");
        const foreign = t.ownerId;
        const cost = foreign ? 25 : 10;
        if (ctx.faction(PLAYER_ID).resources.influence < cost) reject(`Claiming this land costs ${cost} influence.`);
        ctx.pay(PLAYER_ID, { influence: cost });
        if (foreign) {
          ctx.remember(foreign, PLAYER_ID, "border_claim", -15);
          ctx.history({ type: "DIPLOMATIC_ACTION", importance: 2, actorId: PLAYER_ID, targetId: foreign, tile: t.i, summary: `${draft.civilizationName} claimed land in ${t.region} from ${ctx.factionName(foreign)}.`, effects: ["Opinion -15"], tags: ["territory", "border"] });
          triggers.push("major_diplomacy");
        }
        t.ownerId = PLAYER_ID;
        t.settlementId = home!.id;
        t.explored = true;
        lines.push(`Claimed land in ${t.region}.`);
        focusTiles.push(t.i);
        break;
      }
      case "FORTIFY_UNIT": {
        const u = ctx.unit(command.payload.unitId) ?? reject("Unknown unit.");
        if (u.ownerId !== PLAYER_ID) reject("Not your unit.");
        u.status = "fortified";
        u.movesLeft = 0;
        lines.push(`${UNITS[u.type].name} fortifies.`);
        break;
      }
    }
  } catch (e) {
    if (e instanceof CommandRejected) return { ok: false, state, error: e.message, lines: [], focusTiles: [], triggers: [] };
    throw e;
  }
  return { ok: true, state: ctx.commit(), error: null, lines, focusTiles, triggers };
}

function propose(ctx: EngineContext, factionId: string, type: "trade" | "alliance" | "ceasefire" | "peace"): string {
  const target = ctx.factionOrNull(factionId);
  if (!target?.alive || target.kind !== "ai") reject("Unknown faction.");
  const p = { id: ctx.id("p"), from: PLAYER_ID, to: factionId, type, turn: ctx.state.turn };
  if (!proposalStillLegal(ctx, p)) reject(`A ${type} proposal is not possible right now.`);
  if (ctx.state.proposals.some((x) => x.from === PLAYER_ID && x.to === factionId)) reject("You already have a proposal pending with them.");
  ctx.state.proposals.push(p);
  return `Your ${type} proposal has been sent to ${target!.name}. They will answer at the end of the turn.`;
}

const DISCOVERY_REWARDS: Record<PoiType, Partial<Resources>> = {
  ancient_ruin: { knowledge: 30, influence: 10 },
  monolith: { influence: 25, knowledge: 10 },
  hot_springs: { food: 30 },
  crater: { metal: 25, knowledge: 15 },
  ruins: { stone: 20, knowledge: 10 },
  shipwreck: { wood: 30, metal: 10 },
};

const POI_NAME: Record<PoiType, string> = {
  ancient_ruin: "ancient ruins", monolith: "a black monolith", hot_springs: "steaming hot springs", crater: "a star-fallen crater", ruins: "the ruins of a fallen town", shipwreck: "a beached shipwreck",
};

/** Player unit discovers points of interest on its tile (explorers: within 1). */
export function checkDiscovery(ctx: EngineContext, unitId: string): string[] {
  const u = ctx.unit(unitId);
  if (!u) return [];
  const radius = u.type === "explorer" ? 1 : 0;
  const lines: string[] = [];
  for (const i of ctx.grid.within(u.tile, radius)) {
    const t = ctx.tile(i);
    if (!t.poi || t.poiDiscovered) continue;
    t.poiDiscovered = true;
    const mult = u.type === "explorer" ? 2 : 1;
    const reward: Partial<Resources> = {};
    for (const [k, v] of Object.entries(DISCOVERY_REWARDS[t.poi])) reward[k as keyof Resources] = (v ?? 0) * mult;
    ctx.grant(PLAYER_ID, reward);
    if (t.poi === "crater" && !t.resource) t.resource = { type: "relic", amount: 200, initialAmount: 200 };
    const rewardText = Object.entries(reward).map(([k, v]) => `+${v} ${k}`).join(", ");
    ctx.history({
      type: "LOCATION_DISCOVERED", importance: 2, actorId: PLAYER_ID, targetId: null, tile: i,
      summary: `${ctx.state.civilizationName} discovered ${POI_NAME[t.poi]} in ${t.region}.`, effects: [rewardText], tags: ["discovery", `poi:${t.poi}`, `region:${t.region}`],
    });
    createEvent(ctx, {
      type: t.poi === "ancient_ruin" ? "ancient_ruin_discovery" : "discovery", severity: 0.4, duration: 0, centerTile: i, tiles: [i], factionIds: [PLAYER_ID],
      cause: { poi: t.poi, region: t.region, discoveredBy: u.type, turn: ctx.state.turn },
      consequences: [`Rewards: ${rewardText}`, ...(t.poi === "crater" ? ["A relic deposit is revealed"] : [])],
      effects: [], immediate: [rewardText], major: t.poi === "ancient_ruin" || t.poi === "monolith", palette: t.poi === "monolith" ? "arcane" : "gold",
      summary: `Discovery: ${POI_NAME[t.poi]} in ${t.region}.`,
    });
    lines.push(`Discovered ${POI_NAME[t.poi]} (${rewardText}).`);
  }
  return lines;
}
