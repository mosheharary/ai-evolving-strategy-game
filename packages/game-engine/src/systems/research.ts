import type { GameState } from "@echoes/game-types";
import { TECH_BY_ID, TECHS, type TechDef } from "../content/techs";
import type { EngineContext } from "../context";

export function availableTechs(state: GameState, factionId: string): TechDef[] {
  const f = state.factions.find((x) => x.id === factionId);
  if (!f) return [];
  const known = new Set(f.research.known);
  return TECHS.filter((t) => !known.has(t.id) && t.era <= state.era && t.requires.every((r) => known.has(r)));
}

export function canResearch(state: GameState, factionId: string, techId: string): string | null {
  const def = TECH_BY_ID.get(techId);
  if (!def) return "Unknown technology.";
  const f = state.factions.find((x) => x.id === factionId);
  if (!f) return "Unknown faction.";
  if (f.research.known.includes(techId)) return "Already researched.";
  if (def.era > state.era) return `Requires Era ${def.era}.`;
  const missing = def.requires.filter((r) => !f.research.known.includes(r));
  if (missing.length > 0) return `Requires ${missing.map((m) => TECH_BY_ID.get(m)?.name ?? m).join(", ")}.`;
  return null;
}

export function startResearch(ctx: EngineContext, factionId: string, techId: string): void {
  const f = ctx.faction(factionId);
  if (f.research.current && f.research.current !== techId && f.research.progress > 0) {
    // Switching refunds progress into the knowledge bank (no exploit: bank is capped).
    f.resources.knowledge += f.research.progress;
  }
  if (f.research.current !== techId) f.research.progress = 0;
  f.research.current = techId;
}

/** Feed banked knowledge into the current research; returns completed tech ids. */
export function progressResearch(ctx: EngineContext, factionId: string): string[] {
  const f = ctx.faction(factionId);
  const done: string[] = [];
  const cur = f.research.current;
  if (!cur) return done;
  const def = TECH_BY_ID.get(cur);
  if (!def) {
    f.research.current = null;
    return done;
  }
  const need = def.cost - f.research.progress;
  const spend = Math.min(need, Math.floor(f.resources.knowledge));
  f.research.progress += spend;
  f.resources.knowledge -= spend;
  if (f.research.progress >= def.cost) {
    f.research.known.push(cur);
    f.research.current = null;
    f.research.progress = 0;
    done.push(cur);
    ctx.history({
      type: "TECHNOLOGY_RESEARCHED", importance: factionId === "player" ? 2 : 1, actorId: factionId, targetId: null,
      summary: `${ctx.factionName(factionId)} mastered ${def.name}.`, effects: [def.description],
      tags: ["technology", `tech:${def.id}`, `branch:${def.branch}`],
    });
  }
  return done;
}
