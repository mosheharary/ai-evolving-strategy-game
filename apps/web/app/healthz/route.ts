export const dynamic = "force-dynamic";

/** Web container liveness probe (the API has its own /health and /ready). */
export function GET(): Response {
  return Response.json({ status: "ok", service: "web" });
}
