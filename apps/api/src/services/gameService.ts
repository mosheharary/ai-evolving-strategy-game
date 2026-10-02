import { randomBytes, randomUUID } from "node:crypto";
import type { AIOrchestrator } from "@echoes/ai";
import {
  calculateStateHash,
  completeTurn,
  createGame,
  executeCommand,
  prepareTurn,
  projectForPlayer,
  replay,
} from "@echoes/game-engine";
import type { GameRepository, NarrativeRepository, PrismaAIRecorder, PrismaAssetRepository, SaveRepository } from "@echoes/database";
import { ConcurrencyError } from "@echoes/database";
import type { AssetView, CommandRequest, GameCommand, GameState, GameView, NewGameRequest, SaveSummary, ServerPush, TurnReport } from "@echoes/game-types";
import { PLAYER_ID, eventKey, factionAssetKey, heroAssetKey, techAssetKey } from "@echoes/game-types";
import type { Logger, Queues, RedisLock } from "@echoes/platform";
import { imageJobId, narrativeJobId, type ImageJob, type NarrativeJob } from "@echoes/platform";

export class HttpError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
  }
}

interface Live {
  state: GameState;
  seq: number;
  name: string;
  playerId: string;
}

export interface GameServiceDeps {
  games: GameRepository;
  saves: SaveRepository;
  narratives: NarrativeRepository;
  assets: PrismaAssetRepository;
  recorder: PrismaAIRecorder;
  ai: AIOrchestrator;
  queues: Queues;
  lock: RedisLock;
  publish: (p: ServerPush) => Promise<void>;
  logger: Logger;
  config: { executeThreshold: number; conservativeThreshold: number };
}

const CACHE_LIMIT = 64;

/**
 * GameService — the application layer between HTTP and the pure GameEngine.
 * It authorises, loads authoritative state, executes validated commands, runs the
 * turn pipeline (with AI decisions obtained *between* the two pure turn halves),
 * persists command log + snapshots, and schedules asynchronous narrative/art work.
 */
export class GameService {
  private readonly cache = new Map<string, Live>();

  constructor(private readonly d: GameServiceDeps) {}

  // ------------------------------------------------------------------ loading

  private remember(gameId: string, live: Live): void {
    this.cache.delete(gameId);
    this.cache.set(gameId, live);
    while (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
  }

  private async live(gameId: string, playerId: string): Promise<Live> {
    const meta = await this.d.games.meta(gameId);
    if (!meta) throw new HttpError(404, "not_found", "That campaign does not exist.");
    if (meta.playerId !== playerId) throw new HttpError(404, "not_found", "That campaign does not exist.");
    const cached = this.cache.get(gameId);
    if (cached && cached.seq === meta.commandSeq && calculateStateHashCached(cached) === meta.stateHash) return cached;
    const loaded = await this.d.games.load(gameId);
    if (!loaded) throw new HttpError(404, "not_found", "That campaign does not exist.");
    const live: Live = { state: loaded.state, seq: loaded.seq, name: loaded.name, playerId: loaded.playerId };
    hashMemo.set(live, meta.stateHash);
    this.remember(gameId, live);
    return live;
  }

  // ------------------------------------------------------------------ create

  async create(playerId: string, req: NewGameRequest): Promise<{ gameId: string }> {
    const gameId = `g${randomBytes(8).toString("hex")}`;
    const seed = req.seed && req.seed.length > 0 ? req.seed : `${randomBytes(4).toString("hex")}-${randomBytes(2).toString("hex")}`;
    const state = createGame({
      gameId, seed, civilizationName: req.civilizationName, difficulty: req.difficulty, startPreference: req.startPreference,
      aiPolicy: this.d.config,
    });
    const name = req.gameName ?? `${req.civilizationName} — ${seed}`;
    await this.d.games.create(playerId, state, name);
    const live: Live = { state, seq: 0, name, playerId };
    hashMemo.set(live, calculateStateHash(state));
    this.remember(gameId, live);
    const correlationId = randomUUID();
    // The introduction is generated once and persisted; the client shows a local version until it arrives.
    await this.enqueueNarrative({ kind: "intro", gameId, playerId, correlationId });
    await this.enqueueImage({ kind: "hero", gameId, playerId, heroKind: "intro", era: 1, sceneDetail: null, correlationId });
    this.d.logger.info({ gameId, seed, difficulty: req.difficulty }, "game.created");
    return { gameId };
  }

  // ------------------------------------------------------------------ views

  async view(gameId: string, playerId: string): Promise<GameView> {
    const live = await this.live(gameId, playerId);
    return this.buildView(gameId, live);
  }

  private async buildView(gameId: string, live: Live): Promise<GameView> {
    const [narratives, links, ai] = await Promise.all([this.d.narratives.list(gameId, 120), this.d.assets.linksFor(gameId), this.d.ai.status()]);
    const assets: Record<string, AssetView> = {};
    for (const l of links) assets[l.key] = { key: l.key, assetId: l.assetId, url: `/api/assets/${l.assetId}`, status: "ready", kind: l.kind };
    return {
      gameId,
      name: live.name,
      stateHash: calculateStateHashCached(live),
      state: projectForPlayer(live.state),
      narratives: Object.fromEntries(narratives.map((n) => [n.key, n])),
      assets,
      ai,
    };
  }

  /** Copy the seeded "Demo:" campaign into the caller's account (new game id, same world and history). */
  async cloneDemo(playerId: string): Promise<{ gameId: string }> {
    const demo = await this.d.games.findDemo();
    if (!demo) throw new HttpError(404, "not_found", "No demo campaign found — run the seed script.");
    const loaded = await this.d.games.load(demo);
    if (!loaded) throw new HttpError(404, "not_found", "Demo campaign is unavailable.");
    const gameId = `g${randomBytes(8).toString("hex")}`;
    const state = structuredClone(loaded.state);
    state.gameId = gameId;
    await this.d.games.create(playerId, state, loaded.name.replace(/^Demo:/, "Demo copy:"));
    const live: Live = { state, seq: 0, name: loaded.name, playerId };
    this.remember(gameId, live);
    await this.enqueueNarrative({ kind: "intro", gameId, playerId, correlationId: randomUUID() });
    await this.enqueueNarrative({ kind: "summary", gameId, playerId, correlationId: randomUUID() });
    return { gameId };
  }

  async listGames(playerId: string) {
    return this.d.games.listForPlayer(playerId);
  }

  // ------------------------------------------------------------------ commands

  async command(gameId: string, playerId: string, req: CommandRequest): Promise<{ ok: boolean; error: string | null; lines: string[]; focusTiles: number[]; duplicate: boolean; view: GameView }> {
    if (req.type === "END_TURN") {
      const r = await this.endTurn(gameId, playerId, req.commandId);
      return { ok: true, error: null, lines: r.report.lines, focusTiles: r.report.focusTiles, duplicate: r.duplicate, view: r.view };
    }
    const result = await this.d.lock.withLock(`game:${gameId}`, 15_000, async () => {
      const live = await this.live(gameId, playerId);
      // Idempotency: a retried command (same commandId) is acknowledged, not re-applied.
      const prior = await this.d.games.findCommand(gameId, req.commandId);
      if (prior) return { ok: true, error: null, lines: [], focusTiles: [], duplicate: true, view: await this.buildView(gameId, live) };
      const command = { ...req, gameId, playerId: PLAYER_ID } as GameCommand;
      const r = executeCommand(live.state, command);
      if (!r.ok) return { ok: false, error: r.error, lines: [], focusTiles: [], duplicate: false, view: await this.buildView(gameId, live) };
      const seq = await this.persist(gameId, live, command, null, r.state, false);
      const next: Live = { ...live, state: r.state, seq };
      this.remember(gameId, next);
      await this.afterCommand(gameId, playerId, live.state, r.state, r.triggers);
      return { ok: true, error: null, lines: r.lines, focusTiles: r.focusTiles, duplicate: false, view: await this.buildView(gameId, next) };
    });
    if (!result) throw new HttpError(409, "busy", "The world is still processing your previous order. Try again in a moment.");
    if (!result.ok) throw new HttpError(422, "illegal_command", result.error ?? "That order is not possible.");
    return result;
  }

  private async persist(gameId: string, live: Live, command: GameCommand, aiInputs: Parameters<GameRepository["appendCommand"]>[0]["aiInputs"], state: GameState, snapshot: boolean): Promise<number> {
    try {
      return await this.d.games.appendCommand({ gameId, expectedSeq: live.seq, command, aiInputs, state, snapshot });
    } catch (e) {
      if (e instanceof ConcurrencyError) {
        this.cache.delete(gameId);
        throw new HttpError(409, "conflict", "The campaign changed elsewhere. Reloading the latest state.");
      }
      throw e;
    }
  }

  private async afterCommand(gameId: string, playerId: string, before: GameState, after: GameState, triggers: string[]): Promise<void> {
    const correlationId = randomUUID();
    const newEvents = after.events.filter((e) => !before.events.some((b) => b.id === e.id));
    if (newEvents.length > 0) {
      await this.enqueueNarrative({ kind: "turn", gameId, playerId, turn: after.turn, eventIds: newEvents.map((e) => e.id), correlationId });
      for (const e of newEvents) await this.d.publish({ type: "event_generated", gameId, eventId: e.id });
    }
    if (triggers.includes("major_diplomacy") || triggers.includes("discovery")) {
      await this.autosave(gameId, playerId, triggers.includes("discovery") ? "discovery" : "diplomacy");
    }
  }

  // ------------------------------------------------------------------ end turn

  async endTurn(gameId: string, playerId: string, commandId: string): Promise<{ view: GameView; report: TurnReport; duplicate: boolean }> {
    const result = await this.d.lock.withLock(`game:${gameId}`, 90_000, async () => {
      const live = await this.live(gameId, playerId);
      const prior = await this.d.games.findCommand(gameId, commandId);
      if (prior) return { view: await this.buildView(gameId, live), report: live.state.lastReport!, duplicate: true };
      if (live.state.victory.winner) throw new HttpError(409, "game_over", "This campaign has ended.");
      const correlationId = randomUUID();
      const startedTurn = live.state.turn;
      const started = Date.now();

      // RESOLUTION (pure) → FACTION_AI requests
      const prepared = prepareTurn(live.state);
      // FACTION_AI: TypeSafe (or mock / deterministic) decisions, never blocking beyond the turn deadline.
      const inputs = await this.d.ai.decideFactions(prepared.requests, { correlationId, gameId, turn: startedTurn, playerId });
      for (const i of inputs) await this.d.publish({ type: "ai_decision", gameId, turn: startedTurn, factionId: i.factionId, source: i.answer ? "ai" : "fallback" });
      // WORLD_EVOLUTION → EVENTS → TURN_COMPLETE (pure)
      const completed = completeTurn(prepared.state, inputs);
      const command: GameCommand = { commandId, gameId, playerId: PLAYER_ID, turn: startedTurn, type: "END_TURN", payload: {} };
      const seq = await this.persist(gameId, live, command, inputs, completed.state, true);
      const next: Live = { ...live, state: completed.state, seq };
      hashMemo.set(next, calculateStateHash(completed.state));
      this.remember(gameId, next);
      await this.d.recorder.recordExecution(gameId, startedTurn, completed.state.lastDecisions).catch(() => {});
      this.d.logger.info({ gameId, turn: startedTurn, latencyMs: Date.now() - started, fallbacks: inputs.filter((i) => !i.answer).length, correlationId }, "turn.completed");
      await this.afterTurn(gameId, playerId, live.state, completed.state, completed.report, correlationId);
      return { view: await this.buildView(gameId, next), report: completed.report, duplicate: false };
    });
    if (!result) throw new HttpError(409, "busy", "The world is still turning. One moment.");
    return result;
  }

  private async afterTurn(gameId: string, playerId: string, before: GameState, after: GameState, report: TurnReport, correlationId: string): Promise<void> {
    const newEvents = after.events.filter((e) => e.turn === before.turn);
    await this.enqueueNarrative({ kind: "turn", gameId, playerId, turn: before.turn, eventIds: newEvents.map((e) => e.id), correlationId });
    for (const e of newEvents) await this.d.publish({ type: "event_generated", gameId, eventId: e.id });
    for (const a of report.factionActions) await this.d.publish({ type: "faction_action", gameId, turn: before.turn, factionId: a.factionId, summary: a.summary });
    // Technology illustrations for newly researched player techs.
    const beforeTech = new Set(before.factions.find((f) => f.id === PLAYER_ID)?.research.known ?? []);
    const newTechs = (after.factions.find((f) => f.id === PLAYER_ID)?.research.known ?? []).filter((t) => !beforeTech.has(t));
    for (const techId of newTechs) await this.enqueueImage({ kind: "technology", gameId, playerId, techId, correlationId });
    if (after.era > before.era) await this.enqueueImage({ kind: "hero", gameId, playerId, heroKind: "era", era: after.era, sceneDetail: null, correlationId });
    if (after.era > before.era || after.turn % 10 === 1) await this.enqueueNarrative({ kind: "summary", gameId, playerId, correlationId });
    for (const q of after.quests.filter((q) => q.status === "active" && !before.quests.some((b) => b.id === q.id))) {
      await this.enqueueNarrative({ kind: "quest", gameId, playerId, questId: q.id, correlationId });
    }
    // Autosave after end turn (also covers major events / research / diplomacy that happened during resolution).
    const major = newEvents.some((e) => e.major) ? "major-event" : newTechs.length ? "research" : "end-turn";
    await this.autosave(gameId, playerId, major);
    await this.d.publish({ type: "turn_completed", gameId, turn: before.turn });
  }

  // ------------------------------------------------------------------ saves

  async autosave(gameId: string, playerId: string, reason: string): Promise<void> {
    const live = this.cache.get(gameId);
    if (!live) return;
    await this.d.saves.create({ playerId, gameId, name: `Autosave (${reason}) — Year ${live.state.turn}`, autosave: true, state: live.state, commandSeq: live.seq }).catch((e: unknown) => this.d.logger.error({ err: String(e), gameId }, "autosave.failed"));
  }

  async save(gameId: string, playerId: string, name: string | undefined): Promise<SaveSummary> {
    const live = await this.live(gameId, playerId);
    return this.d.saves.create({ playerId, gameId, name: name ?? `${live.name} — Year ${live.state.turn}`, autosave: false, state: live.state, commandSeq: live.seq });
  }

  async loadSave(saveId: string, playerId: string): Promise<{ gameId: string; migratedFrom: number | null }> {
    const loaded = await this.d.saves.loadState(saveId, playerId).catch((e: unknown) => {
      throw new HttpError(422, "corrupt_save", e instanceof Error ? e.message : "This save could not be read.");
    });
    if (!loaded) throw new HttpError(404, "not_found", "Save not found.");
    const gameId = loaded.save.gameId;
    await this.d.lock.withLock(`game:${gameId}`, 30_000, async () => {
      const seq = await this.d.games.resetTo(gameId, loaded.state);
      const meta = await this.d.games.meta(gameId);
      const live: Live = { state: loaded.state, seq, name: meta?.name ?? loaded.save.name, playerId };
      hashMemo.set(live, calculateStateHash(loaded.state));
      this.remember(gameId, live);
    });
    return { gameId, migratedFrom: loaded.migratedFrom };
  }

  // ------------------------------------------------------------------ presentation requests

  async requestAsset(gameId: string, playerId: string, req: { kind: "faction"; factionId: string } | { kind: "technology"; techId: string }): Promise<{ key: string; status: "ready" | "pending" }> {
    const live = await this.live(gameId, playerId);
    const key = req.kind === "faction" ? factionAssetKey(req.factionId, live.state.era) : techAssetKey(req.techId);
    const links = await this.d.assets.linksFor(gameId);
    if (links.some((l) => l.key === key)) return { key, status: "ready" };
    if (req.kind === "faction") {
      if (!live.state.factions.some((f) => f.id === req.factionId && f.kind === "ai")) throw new HttpError(404, "not_found", "Unknown faction.");
      await this.enqueueImage({ kind: "faction", gameId, playerId, factionId: req.factionId, correlationId: randomUUID() });
    } else {
      if (!live.state.factions.find((f) => f.id === PLAYER_ID)?.research.known.includes(req.techId)) throw new HttpError(422, "illegal", "You have not researched that.");
      await this.enqueueImage({ kind: "technology", gameId, playerId, techId: req.techId, correlationId: randomUUID() });
    }
    return { key, status: "pending" };
  }

  async requestFactionNarrative(gameId: string, playerId: string, factionId: string): Promise<{ key: string }> {
    const live = await this.live(gameId, playerId);
    if (!live.state.factions.some((f) => f.id === factionId && f.kind === "ai")) throw new HttpError(404, "not_found", "Unknown faction.");
    await this.enqueueNarrative({ kind: "faction", gameId, playerId, factionId, turn: live.state.turn, correlationId: randomUUID() });
    return { key: `faction:${factionId}:${live.state.turn}` };
  }

  async requestSummary(gameId: string, playerId: string): Promise<void> {
    await this.live(gameId, playerId);
    await this.enqueueNarrative({ kind: "summary", gameId, playerId, correlationId: randomUUID() });
  }

  async history(gameId: string, playerId: string) {
    const live = await this.live(gameId, playerId);
    const persisted = await this.d.games.history(gameId, 300);
    const summary = await this.d.narratives.get(gameId, "summary");
    return { inState: live.state.history.slice(-120), persisted, summary };
  }

  /**
   * Replay verification: from the timeline root (initial snapshot or last Load Game),
   * replaying the logged commands with their *stored* AI decisions must reproduce the
   * live state hash exactly. No AI provider is called.
   */
  async verifyReplay(gameId: string): Promise<{ ok: boolean; expected: string; actual: string; commands: number; root: string; rejected: number }> {
    const meta = await this.d.games.meta(gameId);
    if (!meta) throw new HttpError(404, "not_found", "Unknown game.");
    const root = await this.d.games.timelineRoot(gameId);
    if (!root) throw new HttpError(404, "not_found", "No snapshot to replay from.");
    const log = await this.d.games.commandsAfter(gameId, root.seq);
    const r = replay(root.state, log);
    return { ok: r.stateHash === meta.stateHash, expected: meta.stateHash, actual: r.stateHash, commands: log.length, root: root.kind, rejected: r.rejected.length };
  }

  // ------------------------------------------------------------------ queues

  private async enqueueNarrative(job: NarrativeJob): Promise<void> {
    await this.d.queues.narrative.add(job.kind, job, { jobId: narrativeJobId(job) }).catch((e: unknown) => this.d.logger.warn({ err: String(e), job: job.kind }, "queue.narrative_failed"));
  }

  private async enqueueImage(job: ImageJob): Promise<void> {
    await this.d.queues.images.add(job.kind, job, { jobId: imageJobId(job) }).catch((e: unknown) => this.d.logger.warn({ err: String(e), job: job.kind }, "queue.image_failed"));
  }
}

// Hash memo so views don't re-hash the full state on every request.
const hashMemo = new WeakMap<Live, string>();
function calculateStateHashCached(live: Live): string {
  let h = hashMemo.get(live);
  if (!h) {
    h = calculateStateHash(live.state);
    hashMemo.set(live, h);
  }
  return h;
}

export { eventKey, heroAssetKey };
