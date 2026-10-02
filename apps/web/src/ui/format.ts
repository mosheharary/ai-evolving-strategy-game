import type { GameState, ResourceType, Resources } from "@echoes/game-types";

export const RESOURCE_META: Record<ResourceType, { icon: string; label: string; color: string }> = {
  food: { icon: "🌾", label: "Food", color: "#e3c56a" },
  wood: { icon: "🪵", label: "Wood", color: "#b08455" },
  stone: { icon: "🪨", label: "Stone", color: "#b9b2a5" },
  metal: { icon: "⚙️", label: "Metal", color: "#9aa4ad" },
  energy: { icon: "⚡", label: "Energy", color: "#ffd34d" },
  knowledge: { icon: "📜", label: "Knowledge", color: "#8fc7ff" },
  influence: { icon: "👑", label: "Influence", color: "#d29bff" },
};

export const fmt = (n: number, digits = 0): string => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(digits));
export const signed = (n: number, digits = 1): string => `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;

export function costText(cost: Partial<Resources>): string {
  return (Object.entries(cost) as [ResourceType, number][])
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${v} ${RESOURCE_META[k].icon}`)
    .join("  ");
}

export function factionName(state: GameState, id: string | null): string {
  if (!id) return "Unclaimed";
  if (id === "player") return state.civilizationName;
  return state.factions.find((f) => f.id === id)?.name ?? id;
}

export const titleCase = (s: string): string => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function relationOf(state: GameState, a: string, b: string) {
  const [x, y] = a < b ? [a, b] : [b, a];
  return state.relations.find((r) => r.key === `${x}|${y}`);
}
