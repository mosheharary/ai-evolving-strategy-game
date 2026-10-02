import { SeededRandom } from "@echoes/shared";
import type { CallContext, StructuredTextRequest, StructuredTextResult, TextGenerationProvider } from "../providers/types";
import { ProviderError } from "../providers/types";

/**
 * LocalTextProvider — deterministic fallback narratives built only from the
 * structured facts. Used in mock/deterministic mode and whenever Gemini fails.
 * Output is validated against the same schema as Gemini output.
 */

type Facts = Record<string, unknown>;
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : d);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

const EVENT_TITLES: Record<string, string[]> = {
  drought: ["The Thirsting Season", "When the Rains Forgot", "The Dry Reckoning"],
  river_crisis: ["The River Crisis", "Poison in the Waters", "The Fouled Current"],
  wildfire: ["The Burning of the Wood", "Ash on the Wind", "The Red Summer"],
  volcanic_eruption: ["The Ashfall", "The Mountain Wakes", "Fire from Below"],
  flood: ["The Drowning Valley", "The Swollen River", "Waters Unbound"],
  plague: ["The Grey Fever", "The Sickening", "The Coughing Months"],
  trade_boom: ["The Golden Caravans", "A Season of Coin", "Markets Overflowing"],
  resource_collapse: ["The Empty Vein", "The Last Seam", "Exhaustion"],
  rebellion: ["The Breaking", "Banners of Defiance", "The Free Town"],
  faction_split: ["The Sundering", "A House Divided", "The Free Town"],
  migration: ["The Long Walk", "Wagons on the Horizon", "The Exodus"],
  descendants_return: ["The Return", "Echoes Rebuilt", "Children of the Ruins"],
  border_conflict: ["Blood on the Border", "The Contested Line", "Skirmish Season"],
  ecological_recovery: ["The Greening", "Life Returns", "The Healing Land"],
  religious_movement: ["The Echoing Way", "Pilgrims of the Monolith", "A New Faith"],
  tech_breakthrough: ["A Spark of Genius", "The Breakthrough", "New Knowledge"],
  discovery: ["A Strange Find", "Beyond the Ridge", "The Uncharted"],
  ancient_ruin_discovery: ["Stones That Remember", "The Buried City", "Before Us, Others"],
  era_dawn: ["A New Age", "The Turning of the Era", "Dawn of an Age"],
};

const TONE_BY_TYPE: Record<string, string> = {
  drought: "somber", river_crisis: "ominous", wildfire: "tragic", volcanic_eruption: "ominous", flood: "tense", plague: "tragic",
  trade_boom: "triumphant", resource_collapse: "somber", rebellion: "tense", faction_split: "tense", migration: "somber",
  descendants_return: "hopeful", border_conflict: "tense", ecological_recovery: "hopeful", religious_movement: "mysterious",
  tech_breakthrough: "wondrous", discovery: "mysterious", ancient_ruin_discovery: "mysterious", era_dawn: "hopeful",
};

function reactionLine(f: { factionId: string; name: string; archetype: string; opinionOfPlayer: number }, type: string, rng: SeededRandom): string {
  const warm = f.opinionOfPlayer > 20;
  const cold = f.opinionOfPlayer < -20;
  const byArchetype: Record<string, string[]> = {
    aggressive: ["The hill-clans see weakness to exploit.", "Iron answers every crisis — so say the forgemasters.", "They sharpen their blades and watch."],
    merchant: ["The guildmasters reprice everything overnight.", "Ledgers are opened; every crisis has a price.", "Their caravans reroute, quick as gulls."],
    ecological: ["The grove-wardens hold vigil and remember who wounded the land.", "They speak of balance, and of debts owed to the soil.", "The wardens mourn, and take note."],
    technocratic: ["Their astronomers record every detail for study.", "They publish a treatise on causes and remedies.", "Measurements are taken; conclusions will follow."],
    nomadic: ["The caravans fold their tents and consider the horizon.", "The clans talk of moving on.", "They read the wind and decide nothing yet."],
    rebel: ["The free folk trust no one but themselves.", "They see their independence vindicated."],
  };
  const pool = byArchetype[f.archetype] ?? ["They watch closely."];
  const stance = warm ? " Toward your people, they offer sympathy." : cold ? " Toward your people, their words are cold." : "";
  return `${rng.pick(pool)}${type === "trade_boom" && warm ? " They hope to share in your fortune." : stance}`;
}

export class LocalTextProvider implements TextGenerationProvider {
  readonly name = "local" as const;

  async generateStructured<T>(req: StructuredTextRequest<T>, _ctx: CallContext): Promise<StructuredTextResult<T>> {
    const f = req.facts;
    const rng = new SeededRandom(`${req.promptId}:${str(f.eventId) || str(f.questId) || str(f.factionId) || str(f.seed)}:${str(f.turn)}`);
    let out: unknown;
    switch (req.promptId) {
      case "event_narrative":
        out = this.event(f, rng);
        break;
      case "discovery_narrative":
        out = this.discovery(f, rng);
        break;
      case "campaign_intro":
        out = this.intro(f);
        break;
      case "campaign_summary":
        out = this.summary(f);
        break;
      case "quest_narrative":
        out = { questId: str(f.questId), title: str(f.title, "A Task"), description: str(f.description, "The frontier asks something of you."), flavor: "Word spreads among the settlers; the task will not wait forever." };
        break;
      case "faction_profile":
        out = this.faction(f);
        break;
      default:
        throw new ProviderError("bad_request", `LocalTextProvider has no template for ${req.promptId}`);
    }
    const parsed = req.schema.safeParse(out);
    if (!parsed.success) throw new ProviderError("malformed", `Local template invalid for ${req.promptId}`);
    return { data: parsed.data, model: "local-templates-v1", usage: { inputTokens: 0, outputTokens: 0 } };
  }

  private event(f: Facts, rng: SeededRandom): unknown {
    const type = str(f.type);
    const region = str(f.region, "the frontier");
    const consequences = arr<string>(f.consequences);
    const immediate = arr<string>(f.immediate);
    const history = arr<string>(f.relatedHistory);
    const factions = arr<{ factionId: string; name: string; archetype: string; opinionOfPlayer: number }>(f.factions);
    const title = rng.pick(EVENT_TITLES[type] ?? ["An Echo on the Frontier"]);
    const summary = str(f.summary, `Something stirs in ${region}.`);
    const memory = history.length > 0 ? ` The chroniclers recall earlier days: ${history[history.length - 1]}` : "";
    const description = `${summary}${memory} ${immediate.length ? `Already, ${immediate.join("; ").toLowerCase()}.` : ""}`.trim();
    return {
      eventId: str(f.eventId),
      title,
      description: description.slice(0, 1100).padEnd(20, "."),
      tone: TONE_BY_TYPE[type] ?? "tense",
      factionReactions: factions.slice(0, 4).map((x) => ({ factionId: x.factionId, text: reactionLine(x, type, rng) })),
      playerExplanation: `Cause: ${Object.entries((f.cause as Record<string, unknown>) ?? {}).map(([k, v]) => `${k.replace(/([A-Z])/g, " $1").toLowerCase()} ${String(v)}`).join(", ") || "the state of the world"}.`.slice(0, 400),
      consequencesText: (consequences.join(". ") || "The consequences will unfold over the coming turns.").slice(0, 400),
      visualPrompt: `${type.replace(/_/g, " ")} in ${region}, ${str(f.biome, "frontier landscape")}`,
    };
  }

  private discovery(f: Facts, rng: SeededRandom): unknown {
    const region = str(f.region, "the frontier");
    const poi = str(f.poi, "site");
    const names: Record<string, string[]> = {
      ancient_ruin: ["the Sunken Colonnade", "the Hall of Quiet Kings", "the Broken Aqueduct"],
      monolith: ["the Singing Stone", "the Black Needle", "the Listening Monolith"],
      hot_springs: ["the Steamwell", "the Warm Mirrors", "the Breathing Pools"],
      crater: ["the Starfall Hollow", "the Glass Crater", "the Sky's Wound"],
      ruins: ["the Ashen Foundations", "the Fallen Town", "the Weeping Walls"],
      shipwreck: ["the Wreck of the Long Patience", "the Bone Keel", "the Salt Coffin"],
    };
    const locationName = rng.pick(names[poi] ?? ["the Strange Place"]);
    return {
      eventId: str(f.eventId),
      locationName,
      title: `Discovery: ${locationName.replace(/^the /, "The ")}`,
      description: `In ${region}, your ${str(f.discoveredBy, "scouts")} came upon ${locationName}. ${str(f.summary)} ${arr<string>(f.consequences).join(". ")}`.slice(0, 900),
      tone: "mysterious",
      visualPrompt: `${poi.replace(/_/g, " ")} in ${region}`,
    };
  }

  private intro(f: Facts): unknown {
    const civ = str(f.civilizationName, "Your people");
    const region = str(f.startRegion, "the frontier");
    const neighbours = arr<{ name: string; archetype: string }>(f.factions).map((x) => x.name);
    return {
      title: `The Last Embers of ${civ}`,
      prologue: `When the old world went quiet, only ${civ} remained — a few hundred souls with wagons, seed-grain and stubborn hope. They raised their first hearth in ${region}, where the land is wide and does not yet know their name. They are not alone: ${neighbours.slice(0, 4).join(", ")}${neighbours.length > 4 ? " and others" : ""} have claimed the frontier before them. Every forest felled, every treaty sworn and every war fought will be remembered by this land.`,
      objective: "Grow your settlement, chart the frontier, and choose the legacy your people will leave behind.",
      tone: "hopeful",
      visualPrompt: `a lone frontier settlement at dawn in ${region}`,
    };
  }

  private summary(f: Facts): unknown {
    const entries = arr<string>(f.majorHistory);
    const civ = str(f.civilizationName, "Your people");
    return {
      title: `The Chronicle of ${civ}, Year ${str(f.turn)}`,
      summary: entries.length
        ? `${civ} have endured ${str(f.turn)} years on the frontier. ${entries.slice(-8).join(" ")}`.slice(0, 1600)
        : `${civ} have only begun their story on the frontier. The land waits to see what they will become.`,
      majorThreads: entries.slice(-4).map((e) => e.slice(0, 200)),
      tone: "somber",
    };
  }

  private faction(f: Facts): unknown {
    const op = Number(f.opinionOfPlayer ?? 0);
    const name = str(f.name, "The envoy");
    return {
      factionId: str(f.factionId),
      title: `${name} sends word`,
      greeting: op > 30 ? `"Friend of the frontier," the envoy begins warmly, "${name} remembers your kindness."`
        : op < -30 ? `The envoy does not bow. "${name} remembers what you have done."`
          : `The envoy of ${name} offers a measured greeting and waits to see what kind of neighbour you will be.`,
      attitude: op > 30 ? "Warm and trusting." : op < -30 ? "Hostile and wary." : "Cautious and curious.",
      tone: op > 30 ? "hopeful" : op < -30 ? "ominous" : "tense",
    };
  }
}
