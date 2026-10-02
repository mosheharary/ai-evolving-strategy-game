import type { FastifyReply, FastifyRequest } from "fastify";
import type { PlayerRepository } from "@echoes/database";

/**
 * Authentication abstraction. The default provider issues an anonymous player id
 * in a signed, httpOnly, SameSite=Lax cookie. A real identity provider can be
 * dropped in by implementing AuthProvider without touching game routes.
 */
export interface AuthProvider {
  resolve(req: FastifyRequest, reply: FastifyReply): Promise<string>;
}

export const PLAYER_COOKIE = "echoes_pid";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AnonymousCookieAuth implements AuthProvider {
  constructor(private readonly players: PlayerRepository, private readonly secureCookies: boolean) {}

  async resolve(req: FastifyRequest, reply: FastifyReply): Promise<string> {
    const raw = req.cookies[PLAYER_COOKIE];
    let existing: string | null = null;
    if (raw) {
      const u = req.unsignCookie(raw);
      if (u.valid && u.value && UUID.test(u.value)) existing = u.value;
    }
    const id = await this.players.ensure(existing);
    if (id !== existing) this.issue(reply, id);
    return id;
  }

  issue(reply: FastifyReply, id: string): void {
    reply.setCookie(PLAYER_COOKIE, id, {
      path: "/", httpOnly: true, sameSite: "lax", secure: this.secureCookies, signed: true, maxAge: 60 * 60 * 24 * 365,
    });
  }
}
