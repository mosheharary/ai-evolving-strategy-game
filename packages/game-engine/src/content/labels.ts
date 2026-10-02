const RESOURCE_NODE_LABEL: Record<string, string> = {
  iron: "iron", stone_deposit: "stone", game_herd: "game herd", fish: "fishing", sunstone: "sunstone", relic: "relic", salt: "salt",
};
export const resourceLabel = (type: string): string => RESOURCE_NODE_LABEL[type] ?? type.replace(/_/g, " ");
