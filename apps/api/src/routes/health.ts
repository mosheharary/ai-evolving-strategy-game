import type { FastifyInstance } from "fastify";
import { describeAIConfig } from "@echoes/ai";
import type { ServerDeps } from "../server";

export async function registerHealthRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  /** Liveness: the process is up. */
  app.get("/health", { config: { rateLimit: false } }, async () => ({ status: "ok", service: "api", time: new Date().toISOString() }));

  /** Readiness: dependencies reachable. Never reports secrets — only whether keys are configured. */
  app.get("/ready", { config: { rateLimit: false } }, async (_req, reply) => {
    const checks: Record<string, "ok" | "fail"> = {};
    try {
      await deps.db.$queryRaw`SELECT 1`;
      checks.postgres = "ok";
    } catch {
      checks.postgres = "fail";
    }
    try {
      checks.redis = (await deps.redis.ping()) === "PONG" ? "ok" : "fail";
    } catch {
      checks.redis = "fail";
    }
    const ready = Object.values(checks).every((v) => v === "ok");
    return reply.code(ready ? 200 : 503).send({ status: ready ? "ready" : "degraded", checks, ai: describeAIConfig(deps.ai.orchestrator.config), sse: deps.hub.connections });
  });
}
