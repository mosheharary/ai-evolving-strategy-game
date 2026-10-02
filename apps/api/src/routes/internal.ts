import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { telemetrySummary } from "@echoes/database";
import type { ServerDeps } from "../server";

const Faults = z.object({
  disableGemini: z.boolean().optional(),
  disableTypeSafe: z.boolean().optional(),
  forceRateLimit: z.boolean().optional(),
  forceTimeout: z.boolean().optional(),
}).strict();

/**
 * Internal developer endpoints, separate from the public game API. Enabled only when
 * DEV_TOOLS_ENABLED=true; protected by INTERNAL_TOKEN when one is configured.
 * Exposes metrics only — never keys or provider credentials.
 */
export async function registerInternalRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/internal/")) return;
    if (deps.env.INTERNAL_TOKEN && req.headers["x-internal-token"] !== deps.env.INTERNAL_TOKEN) {
      return reply.code(404).send({ error: { code: "not_found", message: "Not found." } });
    }
  });

  app.get("/internal/ai/telemetry", async (req) => {
    const hours = z.coerce.number().min(1).max(24 * 30).default(24).parse((req.query as Record<string, unknown>).hours);
    const [summary, status] = await Promise.all([telemetrySummary(deps.db, hours), deps.ai.orchestrator.status()]);
    return { summary, status, faults: await deps.ai.orchestrator.faults.get() };
  });

  app.get("/internal/ai/faults", async () => deps.ai.orchestrator.faults.get());

  app.post("/internal/ai/faults", async (req) => {
    const flags = Faults.parse(req.body ?? {});
    const next = await deps.ai.orchestrator.faults.set(flags);
    req.log.warn({ faults: next }, "dev.faults_changed");
    return next;
  });

  app.get("/internal/games/:id/decisions", async (req) => {
    const { id } = z.object({ id: z.string().regex(/^g[0-9a-f]{16}$/) }).parse(req.params);
    return { decisions: await deps.ai.recorder.decisions(id) };
  });

  app.get("/internal/games/:id/replay-verify", async (req) => {
    const { id } = z.object({ id: z.string().regex(/^g[0-9a-f]{16}$/) }).parse(req.params);
    return deps.games.verifyReplay(id);
  });
}
