import type { GameState, NarrativeView, Quest, WorldEvent } from "@echoes/game-types";
import { eventKey } from "@echoes/game-types";
import type { AIOrchestrator } from "../orchestrator";
import type { CallContext } from "../providers/types";
import { eventFacts, factionFacts, introFacts, questFacts, summaryFacts } from "./facts";
import { CampaignIntro, CampaignSummary, DiscoveryNarrative, FactionNarrative, QuestNarrative, WorldEventNarrative } from "./schemas";

const asInput = (facts: Record<string, unknown>): string => `FACTS (JSON):\n${JSON.stringify(facts)}`;

export interface NarrativeResult {
  view: NarrativeView;
  visualPrompt: string | null;
}

/**
 * NarrativeService — Gemini tells the story. Converts structured facts into
 * player-facing narrative, validated by schema *and* semantics. It never
 * returns anything that mutates game state.
 */
export class NarrativeService {
  constructor(private readonly ai: AIOrchestrator) {}

  async narrateEvent(state: GameState, e: WorldEvent, summary: string | null, ctx: CallContext, cachedContent: string | null = null): Promise<NarrativeResult> {
    const facts = eventFacts(state, e, summary);
    const allowedFactions = new Set((facts.factions as { factionId: string }[]).map((f) => f.factionId));
    if (e.type === "discovery" || e.type === "ancient_ruin_discovery") {
      const poiTile = state.map.tiles[e.centerTile];
      const dfacts = { ...facts, poi: poiTile?.poi ?? e.cause.poi, discoveredBy: e.cause.discoveredBy };
      const out = await this.ai.generateText({
        prompt: "discovery_narrative", input: asInput(dfacts), facts: dfacts, schema: DiscoveryNarrative, ctx,
        semanticCheck: (d) => (d.eventId !== e.id ? "eventId mismatch" : null),
      });
      return {
        view: { key: eventKey(e), kind: "location", title: out.data.title, body: out.data.description, tone: out.data.tone, reactions: [], source: out.source, turn: e.turn },
        visualPrompt: out.data.visualPrompt,
      };
    }
    const out = await this.ai.generateText({
      prompt: "event_narrative", input: asInput(facts), facts, schema: WorldEventNarrative, ctx, cachedContent,
      semanticCheck: (d) => {
        if (d.eventId !== e.id) return "eventId mismatch";
        const bad = d.factionReactions.find((r) => !allowedFactions.has(r.factionId));
        return bad ? `unknown faction ${bad.factionId}` : null;
      },
    });
    const d = out.data;
    return {
      view: {
        key: eventKey(e), kind: e.type === "era_dawn" ? "era" : "event", title: d.title,
        body: `${d.description}\n\n${d.playerExplanation}\n\n${d.consequencesText}`, tone: d.tone,
        reactions: d.factionReactions.filter((r) => allowedFactions.has(r.factionId)), source: out.source, turn: e.turn,
      },
      visualPrompt: d.visualPrompt,
    };
  }

  async narrateIntro(state: GameState, ctx: CallContext): Promise<NarrativeResult> {
    const facts = introFacts(state);
    const out = await this.ai.generateText({ prompt: "campaign_intro", input: asInput(facts), facts, schema: CampaignIntro, ctx });
    return {
      view: { key: "intro", kind: "intro", title: out.data.title, body: `${out.data.prologue}\n\n${out.data.objective}`, tone: out.data.tone, reactions: [], source: out.source, turn: state.turn },
      visualPrompt: out.data.visualPrompt,
    };
  }

  async summarizeCampaign(state: GameState, previous: string | null, ctx: CallContext): Promise<NarrativeResult> {
    const facts = summaryFacts(state, previous);
    const out = await this.ai.generateText({ prompt: "campaign_summary", input: asInput(facts), facts, schema: CampaignSummary, ctx });
    const body = `${out.data.summary}${out.data.majorThreads.length ? `\n\n${out.data.majorThreads.map((t) => `• ${t}`).join("\n")}` : ""}`;
    return { view: { key: "summary", kind: "summary", title: out.data.title, body, tone: out.data.tone, reactions: [], source: out.source, turn: state.turn }, visualPrompt: null };
  }

  async narrateQuest(state: GameState, q: Quest, ctx: CallContext): Promise<NarrativeResult> {
    const facts = questFacts(state, q);
    const out = await this.ai.generateText({
      prompt: "quest_narrative", input: asInput(facts), facts, schema: QuestNarrative, ctx,
      semanticCheck: (d) => (d.questId !== q.id ? "questId mismatch" : null),
    });
    return { view: { key: `quest:${q.id}`, kind: "quest", title: out.data.title, body: `${out.data.description}\n\n${out.data.flavor}`, tone: "tense", reactions: [], source: out.source, turn: state.turn }, visualPrompt: null };
  }

  async narrateFaction(state: GameState, factionId: string, ctx: CallContext): Promise<NarrativeResult> {
    const facts = factionFacts(state, factionId);
    const out = await this.ai.generateText({
      prompt: "faction_profile", input: asInput(facts), facts, schema: FactionNarrative, ctx,
      semanticCheck: (d) => (d.factionId !== factionId ? "factionId mismatch" : null),
    });
    return { view: { key: `faction:${factionId}:${state.turn}`, kind: "faction", title: out.data.title, body: `${out.data.greeting}\n\n${out.data.attitude}`, tone: out.data.tone, reactions: [], source: out.source, turn: state.turn }, visualPrompt: null };
  }
}
