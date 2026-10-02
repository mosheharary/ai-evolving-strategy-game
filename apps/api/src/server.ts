import { randomUUID } from "node:crypto";
import compress from "@fastify/compress";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyBaseLogger, type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import { ZodError } from "zod";
import type { Db, SaveRepository } from "@echoes/database";
import type { PlatformAI, PlatformEnv, Logger } from "@echoes/platform";
import type { AuthProvider } from "./auth";
import { HttpError, type GameService } from "./services/gameService";
import type { UpdateHub } from "./services/sse";
import { registerGameRoutes } from "./routes/games";
import { registerHealthRoutes } from "./routes/health";
import { registerInternalRoutes } from "./routes/internal";

declare module "fastify" {
  interface FastifyRequest {
    playerId: string;
  }
}

export interface ServerDeps {
  env: PlatformEnv;
  logger: Logger;
  db: Db;
  redis: Redis;
  auth: AuthProvider;
  saves: SaveRepository;
  games: GameService;
  hub: UpdateHub;
  ai: PlatformAI;
}

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: deps.logger as unknown as FastifyBaseLogger,
    trustProxy: deps.env.TRUST_PROXY,
    bodyLimit: 32 * 1024,
    genReqId: (req) => {
      const h = req.headers["x-request-id"];
      return typeof h === "string" && /^[A-Za-z0-9-]{8,64}$/.test(h) ? h : randomUUID();
    },
  });

  // Accept empty JSON bodies (e.g. POST with no payload) as {}.
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string", bodyLimit: 32 * 1024 }, (_req, body, done) => {
    const text = typeof body === "string" ? body : body.toString("utf8");
    if (text.trim() === "") return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch {
      const err = new Error("Invalid JSON") as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], imgSrc: ["'self'", "data:"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: "same-site" },
  });
  await app.register(cookie, { secret: deps.env.COOKIE_SECRET });
  await app.register(compress, { global: true, threshold: 1024, encodings: ["gzip", "deflate"] });
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: "1 minute",
    redis: deps.redis,
    nameSpace: "echoes-rl:",
    keyGenerator: (req) => req.cookies?.echoes_pid ?? req.ip,
    errorResponseBuilder: (_req, ctx) => ({ statusCode: 429, error: { code: "rate_limited", message: `Too many requests — slow down (retry in ${Math.ceil(ctx.ttl / 1000)}s).` } }),
  });

  app.addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", req.id);
  });

  // CSRF defence for cookie-authenticated, state-changing requests: require our custom
  // header (cannot be sent cross-site without CORS preflight, which we never allow) and a
  // trusted Origin when the browser supplies one.
  const allowed = new Set(deps.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean));
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.url.startsWith("/api/") && !req.url.startsWith("/internal/")) return;
    if (STATE_CHANGING.has(req.method)) {
      if (req.headers["x-echoes-client"] !== "web") {
        return reply.code(403).send({ error: { code: "csrf", message: "Request rejected." } });
      }
      const origin = req.headers.origin;
      if (origin && !allowed.has(origin)) return reply.code(403).send({ error: { code: "csrf", message: "Request rejected." } });
    }
    if (req.url.startsWith("/api/")) req.playerId = await deps.auth.resolve(req, reply);
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
    if (err instanceof ZodError) return reply.code(400).send({ error: { code: "invalid_request", message: "The request was malformed.", issues: err.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message })) } });
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: { code: e.code ?? "bad_request", message: e.statusCode === 413 ? "Request too large." : "Bad request." } });
    req.log.error({ err }, "request.failed");
    // Never expose stack traces or provider internals to players.
    return reply.code(500).send({ error: { code: "internal", message: "Something went wrong on the frontier. Your campaign is safe — please try again.", requestId: req.id } });
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { code: "not_found", message: "Not found." } }));

  await registerHealthRoutes(app, deps);
  await registerGameRoutes(app, deps);
  if (deps.env.DEV_TOOLS_ENABLED) await registerInternalRoutes(app, deps);
  return app;
}
