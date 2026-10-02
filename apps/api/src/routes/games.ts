import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CommandRequest, NewGameRequest } from "@echoes/game-types";
import { getLegalActions } from "@echoes/game-engine";
import type { ServerDeps } from "../server";
import { HttpError } from "../services/gameService";

const GameIdParams = z.object({ id: z.string().regex(/^g[0-9a-f]{16}$/) });
const SaveIdParams = z.object({ id: z.string().uuid() });
const AssetIdParams = z.object({ assetId: z.string().uuid() });
const SaveBody = z.object({ name: z.string().trim().min(1).max(80).optional() }).strict();
const AssetRequestBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("faction"), factionId: z.string().min(1).max(40).regex(/^[a-z0-9_]+$/) }),
  z.object({ kind: z.literal("technology"), techId: z.string().min(1).max(40).regex(/^[a-z0-9_]+$/) }),
]);
const FactionBody = z.object({ factionId: z.string().min(1).max(40).regex(/^[a-z0-9_]+$/) }).strict();
const EndTurnBody = z.object({ commandId: z.string().uuid() }).strict();
const EventsQuery = z.object({ since: z.coerce.number().int().min(0).default(0) });

export async function registerGameRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  const { games } = deps;

  app.post("/api/session", async (req) => ({ playerId: req.playerId }));

  app.get("/api/games", async (req) => ({ games: await games.listGames(req.playerId) }));

  app.post("/api/games", { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = NewGameRequest.parse(req.body ?? {});
    const r = await games.create(req.playerId, body);
    return reply.code(201).send(r);
  });

  app.get("/api/games/:id", async (req) => {
    const { id } = GameIdParams.parse(req.params);
    return games.view(id, req.playerId);
  });

  app.post("/api/games/:id/commands", { config: { rateLimit: { max: 240, timeWindow: "1 minute" } } }, async (req) => {
    const { id } = GameIdParams.parse(req.params);
    const body = CommandRequest.parse(req.body);
    return games.command(id, req.playerId, body);
  });

  app.post("/api/games/:id/end-turn", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { id } = GameIdParams.parse(req.params);
    const { commandId } = EndTurnBody.parse(req.body);
    const r = await games.endTurn(id, req.playerId, commandId);
    return { ok: true, duplicate: r.duplicate, report: r.report, view: r.view };
  });

  app.get("/api/games/:id/legal-actions", async (req) => {
    const { id } = GameIdParams.parse(req.params);
    const view = await games.view(id, req.playerId);
    return getLegalActions(view.state);
  });

  /** Polling fallback: recent events with their narrative. */
  app.get("/api/games/:id/events", async (req) => {
    const { id } = GameIdParams.parse(req.params);
    const { since } = EventsQuery.parse(req.query);
    const view = await games.view(id, req.playerId);
    return {
      turn: view.state.turn,
      stateHash: view.stateHash,
      events: view.state.events.filter((e) => e.turn >= since),
      narratives: view.narratives,
      assets: view.assets,
      ai: view.ai,
    };
  });

  app.get("/api/games/:id/history", async (req) => {
    const { id } = GameIdParams.parse(req.params);
    return games.history(id, req.playerId);
  });

  app.post("/api/games/:id/summary", { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { id } = GameIdParams.parse(req.params);
    await games.requestSummary(id, req.playerId);
    return reply.code(202).send({ status: "queued" });
  });

  app.post("/api/games/:id/assets/request", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { id } = GameIdParams.parse(req.params);
    return games.requestAsset(id, req.playerId, AssetRequestBody.parse(req.body));
  });

  app.post("/api/games/:id/narratives/faction", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const { id } = GameIdParams.parse(req.params);
    const { factionId } = FactionBody.parse(req.body);
    return games.requestFactionNarrative(id, req.playerId, factionId);
  });

  /** Server-Sent Events: AI decisions, events, narrative/image readiness, turn completion. */
  app.get("/api/games/:id/stream", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { id } = GameIdParams.parse(req.params);
    await games.view(id, req.playerId); // authorisation
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-request-id": req.id,
    });
    res.write(`retry: 3000\n\n`);
    res.write(`event: hello\ndata: ${JSON.stringify({ gameId: id })}\n\n`);
    const unsubscribe = await deps.hub.subscribe(id, (data) => res.write(`data: ${data}\n\n`));
    const heartbeat = setInterval(() => res.write(`: ping\n\n`), 20_000);
    req.raw.on("close", () => {
      clearInterval(heartbeat);
      void unsubscribe();
    });
  });

  app.post("/api/games/:id/save", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { id } = GameIdParams.parse(req.params);
    const { name } = SaveBody.parse(req.body ?? {});
    return reply.code(201).send(await games.save(id, req.playerId, name));
  });

  // ---------------------------------------------------------------- saves

  app.get("/api/saves", async (req) => ({ saves: await deps.saves.list(req.playerId) }));

  app.get("/api/saves/:id", async (req) => {
    const { id } = SaveIdParams.parse(req.params);
    const s = await deps.saves.get(id, req.playerId);
    if (!s) throw new HttpError(404, "not_found", "Save not found.");
    return s;
  });

  app.post("/api/saves/:id/load", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const { id } = SaveIdParams.parse(req.params);
    return games.loadSave(id, req.playerId);
  });

  app.delete("/api/saves/:id", async (req, reply) => {
    const { id } = SaveIdParams.parse(req.params);
    const ok = await deps.saves.delete(id, req.playerId);
    if (!ok) throw new HttpError(404, "not_found", "Save not found.");
    return reply.code(204).send();
  });

  // ---------------------------------------------------------------- assets

  app.get("/api/assets/:assetId", { config: { rateLimit: { max: 300, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { assetId } = AssetIdParams.parse(req.params);
    if (!(await deps.ai.assets.isLinkedToPlayer(assetId, req.playerId))) throw new HttpError(404, "not_found", "Not found.");
    const asset = await deps.ai.assets.byId(assetId);
    if (!asset) throw new HttpError(404, "not_found", "Not found.");
    const bytes = await deps.ai.storage.get(asset.storageLocation);
    if (!bytes) throw new HttpError(404, "not_found", "Not found.");
    return reply
      .header("content-type", asset.mimeType)
      .header("cache-control", "private, max-age=31536000, immutable")
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
      .send(Buffer.from(bytes));
  });

  // ---------------------------------------------------------------- demo

  app.get("/api/demo", async () => {
    if (!deps.env.DEMO_MODE) return { available: false };
    const demo = await deps.db.game.findFirst({ where: { name: { startsWith: "Demo:" } }, select: { id: true, playerId: true } });
    return { available: !!demo };
  });

  /** Local demo: copy the seeded demo campaign (with its history) into this player's session. */
  app.post("/api/demo/claim", { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!deps.env.DEMO_MODE) throw new HttpError(404, "not_found", "Not found.");
    return reply.code(201).send(await games.cloneDemo(req.playerId));
  });
}
