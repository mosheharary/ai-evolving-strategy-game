import type { FactionDecisionInput, GameCommand, GameState, NarrativeView, SaveSummary } from "@echoes/game-types";
import { PLAYER_ID, SAVE_SCHEMA_VERSION } from "@echoes/game-types";
import { calculateStateHash, militaryStrength, replay, type LoggedCommand } from "@echoes/game-engine";
import type { AIDecisionRecord, AIRecorder, AIRequestRecord, AssetRecord, AssetRepository } from "@echoes/ai";
import type { Db } from "./client";
import { decodeState, encodeState } from "./codec";
import { Prisma } from "./generated/prisma/client";

export const APP_VERSION = "1.0.0";
const KEEP_SNAPSHOTS = 12;

const json = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

// ============================================================ players

export class PlayerRepository {
  constructor(private readonly db: Db) {}

  async ensure(id: string | null): Promise<string> {
    if (id) {
      const p = await this.db.player.findUnique({ where: { id } });
      if (p) {
        await this.db.player.update({ where: { id }, data: { lastSeenAt: new Date() } });
        return p.id;
      }
    }
    const created = await this.db.player.create({ data: {} });
    return created.id;
  }
}

// ============================================================ games, commands, snapshots

export interface LoadedGame {
  state: GameState;
  seq: number;
  name: string;
  playerId: string;
}

export class GameRepository {
  constructor(private readonly db: Db) {}

  async create(playerId: string, state: GameState, name: string): Promise<void> {
    const hash = calculateStateHash(state);
    const data = encodeState(state);
    await this.db.$transaction(async (tx) => {
      await tx.game.create({
        data: {
          id: state.gameId, playerId, name, seed: state.seed, civilizationName: state.civilizationName, difficulty: state.config.difficulty,
          currentTurn: state.turn, era: state.era, stateHash: hash, commandSeq: 0, schemaVersion: state.schemaVersion,
        },
      });
      await tx.gameState.create({ data: { gameId: state.gameId, turn: state.turn, seq: 0, kind: "initial", stateHash: hash, schemaVersion: state.schemaVersion, sizeBytes: data.byteLength, data } });
      await writeProjection(tx, state);
    });
  }

  async meta(gameId: string): Promise<{ playerId: string; name: string; commandSeq: number; stateHash: string } | null> {
    return this.db.game.findUnique({ where: { id: gameId }, select: { playerId: true, name: true, commandSeq: true, stateHash: true } });
  }

  async findDemo(): Promise<string | null> {
    const g = await this.db.game.findFirst({ where: { name: { startsWith: "Demo:" } }, orderBy: { createdAt: "asc" }, select: { id: true } });
    return g?.id ?? null;
  }

  async listForPlayer(playerId: string): Promise<{ id: string; name: string; civilizationName: string; currentTurn: number; era: number; seed: string; status: string; updatedAt: Date }[]> {
    return this.db.game.findMany({
      where: { playerId }, orderBy: { updatedAt: "desc" }, take: 20,
      select: { id: true, name: true, civilizationName: true, currentTurn: true, era: true, seed: true, status: true, updatedAt: true },
    });
  }

  /**
   * Restore the authoritative state: latest snapshot + deterministic replay of the
   * commands logged after it (using stored AI decisions — no AI calls).
   */
  async load(gameId: string): Promise<LoadedGame | null> {
    const game = await this.db.game.findUnique({ where: { id: gameId } });
    if (!game) return null;
    const snap = await this.db.gameState.findFirst({ where: { gameId }, orderBy: [{ seq: "desc" }, { createdAt: "desc" }] });
    if (!snap) throw new Error(`game ${gameId} has no snapshot`);
    let { state } = decodeState(snap.data);
    if (game.commandSeq > snap.seq) {
      const rows = await this.db.gameCommand.findMany({ where: { gameId, seq: { gt: snap.seq } }, orderBy: { seq: "asc" } });
      const log: LoggedCommand[] = rows.map((r) => ({ seq: r.seq, command: { ...(r.payload as object), commandId: r.commandId, gameId, playerId: PLAYER_ID, turn: r.turn, type: r.type } as unknown as GameCommand, aiInputs: (r.aiInputs as FactionDecisionInput[] | null) ?? null }));
      const result = replay(state, log);
      if (result.stateHash !== game.stateHash) {
        throw new Error(`replay hash mismatch for ${gameId}: expected ${game.stateHash.slice(0, 12)} got ${result.stateHash.slice(0, 12)}`);
      }
      state = result.state;
    }
    return { state, seq: game.commandSeq, name: game.name, playerId: game.playerId };
  }

  async findCommand(gameId: string, commandId: string): Promise<{ seq: number; stateHash: string } | null> {
    return this.db.gameCommand.findUnique({ where: { gameId_commandId: { gameId, commandId } }, select: { seq: true, stateHash: true } });
  }

  /**
   * Append a validated command atomically. Optimistic concurrency: fails if another
   * writer advanced the sequence. END_TURN also writes a snapshot + normalized projection.
   */
  async appendCommand(args: { gameId: string; expectedSeq: number; command: GameCommand; aiInputs: FactionDecisionInput[] | null; state: GameState; snapshot: boolean }): Promise<number> {
    const { gameId, command, state } = args;
    const seq = args.expectedSeq + 1;
    const hash = calculateStateHash(state);
    const { commandId, gameId: _g, playerId: _p, turn, type, ...rest } = command;
    await this.db.$transaction(async (tx) => {
      const updated = await tx.game.updateMany({
        where: { id: gameId, commandSeq: args.expectedSeq },
        data: { commandSeq: seq, stateHash: hash, currentTurn: state.turn, era: state.era, status: state.victory.winner ? "ended" : "active" },
      });
      if (updated.count !== 1) throw new ConcurrencyError("game advanced concurrently");
      await tx.gameCommand.create({
        data: { gameId, seq, commandId, turn, type, payload: json(rest), aiInputs: args.aiInputs ? json(args.aiInputs) : Prisma.DbNull, stateHash: hash },
      });
      if (args.snapshot) {
        const data = encodeState(state);
        await tx.gameState.create({ data: { gameId, turn: state.turn, seq, kind: "turn", stateHash: hash, schemaVersion: state.schemaVersion, sizeBytes: data.byteLength, data } });
        await writeProjection(tx, state);
      }
    }, { timeout: 20_000 });
    if (args.snapshot) await this.pruneSnapshots(gameId);
    return seq;
  }

  /** Replace the live state (used by Load Game): new snapshot at the current sequence. */
  async resetTo(gameId: string, state: GameState): Promise<number> {
    const hash = calculateStateHash(state);
    const data = encodeState(state);
    return this.db.$transaction(async (tx) => {
      const game = await tx.game.findUniqueOrThrow({ where: { id: gameId } });
      const seq = game.commandSeq;
      await tx.gameState.create({ data: { gameId, turn: state.turn, seq, kind: "load", stateHash: hash, schemaVersion: state.schemaVersion, sizeBytes: data.byteLength, data } });
      await tx.game.update({ where: { id: gameId }, data: { stateHash: hash, currentTurn: state.turn, era: state.era, status: state.victory.winner ? "ended" : "active" } });
      await writeProjection(tx, state);
      return seq;
    }, { timeout: 20_000 });
  }

  private async pruneSnapshots(gameId: string): Promise<void> {
    // Timeline roots (initial / load) are never pruned: replay verification starts from them.
    const old = await this.db.gameState.findMany({ where: { gameId, kind: "turn" }, orderBy: { seq: "desc" }, skip: KEEP_SNAPSHOTS, select: { id: true } });
    if (old.length > 0) await this.db.gameState.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  }

  async commandLog(gameId: string): Promise<LoggedCommand[]> {
    const rows = await this.db.gameCommand.findMany({ where: { gameId }, orderBy: { seq: "asc" } });
    return rows.map((r) => ({ seq: r.seq, command: { ...(r.payload as object), commandId: r.commandId, gameId, playerId: PLAYER_ID, turn: r.turn, type: r.type } as unknown as GameCommand, aiInputs: (r.aiInputs as FactionDecisionInput[] | null) ?? null }));
  }

  /** The most recent timeline root: the initial snapshot, or the latest Load Game reset. */
  async timelineRoot(gameId: string): Promise<{ state: GameState; seq: number; kind: string } | null> {
    const snap = await this.db.gameState.findFirst({ where: { gameId, kind: { in: ["initial", "load"] } }, orderBy: [{ seq: "desc" }, { createdAt: "desc" }] });
    return snap ? { state: decodeState(snap.data).state, seq: snap.seq, kind: snap.kind } : null;
  }

  async commandsAfter(gameId: string, seq: number): Promise<LoggedCommand[]> {
    return (await this.commandLog(gameId)).filter((c) => c.seq > seq);
  }

  async history(gameId: string, limit = 200): Promise<{ turn: number; type: string; importance: number; summary: string }[]> {
    return this.db.historicalEvent.findMany({ where: { gameId }, orderBy: [{ turn: "desc" }], take: limit, select: { turn: true, type: true, importance: true, summary: true } });
  }
}

export class ConcurrencyError extends Error {}

/** Normalized entity projection of the current state (rewritten in the same transaction as the snapshot). */
async function writeProjection(tx: Prisma.TransactionClient, s: GameState): Promise<void> {
  const gameId = s.gameId;
  await Promise.all([
    tx.faction.deleteMany({ where: { gameId } }), tx.settlement.deleteMany({ where: { gameId } }), tx.unit.deleteMany({ where: { gameId } }),
    tx.tile.deleteMany({ where: { gameId } }), tx.resourceNode.deleteMany({ where: { gameId } }), tx.technology.deleteMany({ where: { gameId } }),
    tx.quest.deleteMany({ where: { gameId } }), tx.diplomacyRelation.deleteMany({ where: { gameId } }),
  ]);
  await tx.faction.createMany({
    data: s.factions.map((f) => ({
      gameId, factionId: f.id, name: f.name, kind: f.kind, archetype: f.archetype, color: f.color, alive: f.alive,
      opinionOfPlayer: f.opinions[PLAYER_ID] ?? 0, militaryStrength: militaryStrength(s, f.id),
      settlementCount: s.settlements.filter((x) => x.ownerId === f.id).length, techCount: f.research.known.length,
      posture: f.posture.action, personality: json(f.personality), memories: json(f.memories.slice(-20)),
    })),
  });
  if (s.settlements.length) {
    await tx.settlement.createMany({ data: s.settlements.map((x) => ({ gameId, settlementId: x.id, ownerId: x.ownerId, founderId: x.founderId, name: x.name, tile: x.tile, population: x.population, stability: x.stability, hp: x.hp, isCapital: x.isCapital, foundedTurn: x.foundedTurn })) });
  }
  if (s.units.length) await tx.unit.createMany({ data: s.units.map((u) => ({ gameId, unitId: u.id, ownerId: u.ownerId, type: u.type, tile: u.tile, hp: u.hp, status: u.status })) });
  const changed = s.map.tiles.filter((t) => t.ownerId || t.buildingId || t.pollution > 0 || t.biome !== t.baseBiome || t.prosperity > 0);
  if (changed.length) {
    await tx.tile.createMany({
      data: changed.map((t) => ({
        gameId, tileIndex: t.i, biome: t.biome, baseBiome: t.baseBiome, ownerId: t.ownerId,
        buildingType: t.buildingId ? s.buildings.find((b) => b.id === t.buildingId)?.type ?? null : null,
        pollution: t.pollution, forest: t.forest, fertility: t.fertility, habitat: t.habitat, prosperity: t.prosperity,
      })),
    });
  }
  const nodes = s.map.tiles.filter((t) => t.resource);
  if (nodes.length) await tx.resourceNode.createMany({ data: nodes.map((t) => ({ gameId, tileIndex: t.i, type: t.resource!.type, amount: t.resource!.amount, initialAmount: t.resource!.initialAmount })) });
  const techs = s.factions.flatMap((f) => f.research.known.map((techId) => ({ gameId, factionId: f.id, techId })));
  if (techs.length) await tx.technology.createMany({ data: techs });
  if (s.quests.length) await tx.quest.createMany({ data: s.quests.map((q) => ({ gameId, questId: q.id, type: q.type, title: q.title, status: q.status, issuedTurn: q.issuedTurn, expiresTurn: q.expiresTurn, data: json(q) })) });
  if (s.relations.length) await tx.diplomacyRelation.createMany({ data: s.relations.map((r) => ({ gameId, pairKey: r.key, a: r.a, b: r.b, status: r.status, trade: r.trade, sinceTurn: r.sinceTurn, data: json(r) })) });
  // Events and history are append-only: upsert by id so long-pruned history stays in the database.
  if (s.events.length) {
    await tx.gameEvent.createMany({ data: s.events.map((e) => ({ gameId, eventId: e.id, turn: e.turn, type: e.type, severity: e.severity, region: e.region, major: e.major, status: e.status, data: json(e) })), skipDuplicates: true });
    for (const e of s.events.filter((x) => x.status === "resolved")) {
      await tx.gameEvent.updateMany({ where: { gameId, eventId: e.id, status: "active" }, data: { status: "resolved" } });
    }
  }
  if (s.history.length) {
    await tx.historicalEvent.createMany({ data: s.history.map((h) => ({ gameId, entryId: h.id, turn: h.turn, type: h.type, importance: h.importance, summary: h.summary, data: json(h) })), skipDuplicates: true });
  }
}

// ============================================================ saves

export class SaveRepository {
  constructor(private readonly db: Db) {}

  async create(args: { playerId: string; gameId: string; name: string; autosave: boolean; state: GameState; commandSeq: number }): Promise<SaveSummary> {
    const data = encodeState(args.state);
    const hash = calculateStateHash(args.state);
    if (args.autosave) {
      // Keep the 3 most recent autosaves per game.
      const old = await this.db.saveGame.findMany({ where: { gameId: args.gameId, autosave: true }, orderBy: { createdAt: "desc" }, skip: 2, select: { id: true } });
      if (old.length) await this.db.saveGame.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
    }
    const row = await this.db.saveGame.create({
      data: {
        playerId: args.playerId, gameId: args.gameId, name: args.name, autosave: args.autosave, seed: args.state.seed, civilizationName: args.state.civilizationName,
        turn: args.state.turn, era: args.state.era, schemaVersion: SAVE_SCHEMA_VERSION, appVersion: APP_VERSION, stateHash: hash, commandSeq: args.commandSeq, sizeBytes: data.byteLength, data,
      },
    });
    return toSummary(row);
  }

  async list(playerId: string): Promise<SaveSummary[]> {
    const rows = await this.db.saveGame.findMany({ where: { playerId }, orderBy: { createdAt: "desc" }, take: 50, omit: { data: true } });
    return rows.map(toSummary);
  }

  async get(id: string, playerId: string): Promise<SaveSummary | null> {
    const row = await this.db.saveGame.findFirst({ where: { id, playerId }, omit: { data: true } });
    return row ? toSummary(row) : null;
  }

  async loadState(id: string, playerId: string): Promise<{ save: SaveSummary; state: GameState; migratedFrom: number | null } | null> {
    const row = await this.db.saveGame.findFirst({ where: { id, playerId } });
    if (!row) return null;
    const { state, migratedFrom } = decodeState(row.data);
    // Save validation: the stored hash must match (only meaningful when no migration happened).
    if (migratedFrom === null && calculateStateHash(state) !== row.stateHash) throw new Error("Save integrity check failed (state hash mismatch).");
    return { save: toSummary(row), state, migratedFrom };
  }

  async delete(id: string, playerId: string): Promise<boolean> {
    const r = await this.db.saveGame.deleteMany({ where: { id, playerId } });
    return r.count > 0;
  }
}

function toSummary(r: { id: string; gameId: string; name: string; civilizationName: string; seed: string; turn: number; era: number; schemaVersion: number; stateHash: string; autosave: boolean; createdAt: Date }): SaveSummary {
  return {
    saveId: r.id, gameId: r.gameId, name: r.name, civilizationName: r.civilizationName, seed: r.seed, turn: r.turn, era: r.era,
    schemaVersion: r.schemaVersion, stateHash: r.stateHash, autosave: r.autosave, createdAt: r.createdAt.toISOString(),
  };
}

// ============================================================ narrative & assets

export class NarrativeRepository {
  constructor(private readonly db: Db) {}

  async upsert(gameId: string, v: NarrativeView): Promise<void> {
    const data = { kind: v.kind, title: v.title, body: v.body, tone: v.tone, reactions: json(v.reactions), source: v.source, turn: v.turn };
    await this.db.narrative.upsert({ where: { gameId_key: { gameId, key: v.key } }, create: { gameId, key: v.key, ...data }, update: data });
  }

  async get(gameId: string, key: string): Promise<NarrativeView | null> {
    const r = await this.db.narrative.findUnique({ where: { gameId_key: { gameId, key } } });
    return r ? toView(r) : null;
  }

  async list(gameId: string, limit = 80): Promise<NarrativeView[]> {
    const rows = await this.db.narrative.findMany({ where: { gameId }, orderBy: { updatedAt: "desc" }, take: limit });
    return rows.map(toView);
  }
}

function toView(r: { key: string; kind: string; title: string; body: string; tone: string; reactions: unknown; source: string; turn: number }): NarrativeView {
  return { key: r.key, kind: r.kind as NarrativeView["kind"], title: r.title, body: r.body, tone: r.tone, reactions: (r.reactions as NarrativeView["reactions"]) ?? [], source: r.source as NarrativeView["source"], turn: r.turn };
}

export class PrismaAssetRepository implements AssetRepository {
  constructor(private readonly db: Db) {}

  async findByPromptHash(promptHash: string): Promise<AssetRecord | null> {
    const r = await this.db.generatedAsset.findUnique({ where: { promptHash } });
    return r ? toAsset(r) : null;
  }

  async create(rec: Omit<AssetRecord, "assetId" | "createdAt">): Promise<AssetRecord> {
    try {
      const r = await this.db.generatedAsset.create({ data: rec });
      return toAsset(r);
    } catch (e) {
      // Another process won the race on the unique promptHash — reuse its asset.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const existing = await this.findByPromptHash(rec.promptHash);
        if (existing) return existing;
      }
      throw e;
    }
  }

  async byId(id: string): Promise<AssetRecord | null> {
    const r = await this.db.generatedAsset.findUnique({ where: { id } });
    return r ? toAsset(r) : null;
  }

  async link(gameId: string, key: string, assetId: string): Promise<void> {
    await this.db.gameAssetLink.upsert({ where: { gameId_key: { gameId, key } }, create: { gameId, key, assetId }, update: { assetId } });
  }

  async linksFor(gameId: string): Promise<{ key: string; assetId: string; kind: string }[]> {
    const rows = await this.db.gameAssetLink.findMany({ where: { gameId }, include: { asset: { select: { kind: true } } } });
    return rows.map((r) => ({ key: r.key, assetId: r.assetId, kind: r.asset.kind }));
  }

  async isLinkedToPlayer(assetId: string, playerId: string): Promise<boolean> {
    const n = await this.db.gameAssetLink.count({ where: { assetId, game: { playerId } } });
    return n > 0;
  }
}

function toAsset(r: { id: string; promptHash: string; kind: string; model: string; source: string; promptId: string; promptVersion: number; width: number; height: number; mimeType: string; storageLocation: string; gameId: string | null; eventId: string | null; createdAt: Date }): AssetRecord {
  return { assetId: r.id, promptHash: r.promptHash, kind: r.kind, model: r.model, source: r.source as "gemini" | "local", promptId: r.promptId, promptVersion: r.promptVersion, width: r.width, height: r.height, mimeType: r.mimeType, storageLocation: r.storageLocation, gameId: r.gameId, eventId: r.eventId, createdAt: r.createdAt };
}

// ============================================================ AI telemetry & decisions

export class PrismaAIRecorder implements AIRecorder {
  constructor(private readonly db: Db) {}

  async recordRequest(r: AIRequestRecord): Promise<void> {
    await this.db.aIRequest.create({ data: r });
  }

  async recordDecision(r: AIDecisionRecord): Promise<void> {
    const exists = await this.db.game.count({ where: { id: r.gameId } });
    if (!exists) return;
    await this.db.aIDecision.create({ data: { ...r, answer: r.answer === null ? Prisma.DbNull : json(r.answer) } });
  }

  /** Attach the engine's execution outcome to each decision of a turn. */
  async recordExecution(gameId: string, turn: number, results: Record<string, unknown>): Promise<void> {
    for (const [factionId, result] of Object.entries(results)) {
      await this.db.aIDecision.updateMany({ where: { gameId, turn, factionId }, data: { executionResult: json(result) } });
    }
  }

  async decisions(gameId: string, limit = 60): Promise<unknown[]> {
    return this.db.aIDecision.findMany({ where: { gameId }, orderBy: { createdAt: "desc" }, take: limit, omit: { correlationId: true } });
  }
}

export interface TelemetrySummary {
  windowHours: number;
  byProvider: { provider: string; status: string; count: number; avgLatencyMs: number; inputTokens: number; outputTokens: number }[];
  decisions: { total: number; fallback: number; avgLatencyMs: number };
  images: { generated: number; byModel: { model: string; count: number }[] };
  recentErrors: { createdAt: Date; provider: string; operation: string; errorKind: string | null }[];
}

export async function telemetrySummary(db: Db, windowHours = 24): Promise<TelemetrySummary> {
  const since = new Date(Date.now() - windowHours * 3600_000);
  const groups = await db.aIRequest.groupBy({
    by: ["provider", "status"], where: { createdAt: { gte: since } },
    _count: { _all: true }, _avg: { latencyMs: true }, _sum: { inputTokens: true, outputTokens: true },
  });
  const dec = await db.aIDecision.aggregate({ where: { createdAt: { gte: since } }, _count: { _all: true }, _avg: { latencyMs: true } });
  const decFallback = await db.aIDecision.count({ where: { createdAt: { gte: since }, fallbackUsed: true } });
  const imgs = await db.generatedAsset.groupBy({ by: ["model"], where: { createdAt: { gte: since } }, _count: { _all: true } });
  const recentErrors = await db.aIRequest.findMany({ where: { status: "error", createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 15, select: { createdAt: true, provider: true, operation: true, errorKind: true } });
  return {
    windowHours,
    byProvider: groups.map((g) => ({
      provider: g.provider, status: g.status, count: g._count._all, avgLatencyMs: Math.round(g._avg.latencyMs ?? 0),
      inputTokens: g._sum.inputTokens ?? 0, outputTokens: g._sum.outputTokens ?? 0,
    })),
    decisions: { total: dec._count._all, fallback: decFallback, avgLatencyMs: Math.round(dec._avg.latencyMs ?? 0) },
    images: { generated: imgs.reduce((a, g) => a + g._count._all, 0), byModel: imgs.map((g) => ({ model: g.model, count: g._count._all })) },
    recentErrors,
  };
}
