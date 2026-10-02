import type { CommandBody, GameView, NewGameRequest, SaveSummary, TurnReport } from "@echoes/game-types";

/**
 * Browser API client. Talks only to this origin (/api is proxied to the game server).
 * Sends intent (commands) — never resource values — plus a CSRF header.
 */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

const FRIENDLY: Record<number, string> = {
  0: "The frontier is unreachable — check your connection. Your campaign is safe.",
  429: "Too many orders at once — give the world a moment.",
  500: "Something went wrong on the frontier. Your campaign is safe — please try again.",
  502: "The game server is restarting. Please try again shortly.",
  503: "The game server is busy. Please try again shortly.",
};

async function request<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: method === "GET" ? { accept: "application/json" } : { "content-type": "application/json", accept: "application/json", "x-echoes-client": "web" },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "network", FRIENDLY[0]!);
  }
  if (res.status === 204) return undefined as T;
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? "error", err?.message ?? FRIENDLY[res.status] ?? FRIENDLY[500]!);
  }
  return data as T;
}

export const newCommandId = (): string => crypto.randomUUID();

export interface CommandResponse {
  ok: boolean;
  error: string | null;
  lines: string[];
  focusTiles: number[];
  duplicate: boolean;
  view: GameView;
}

export interface GameListItem {
  id: string;
  name: string;
  civilizationName: string;
  currentTurn: number;
  era: number;
  seed: string;
  status: string;
  updatedAt: string;
}

export const api = {
  session: () => request<{ playerId: string }>("POST", "/api/session"),
  listGames: () => request<{ games: GameListItem[] }>("GET", "/api/games"),
  createGame: (req: Partial<NewGameRequest> & { civilizationName: string }) => request<{ gameId: string }>("POST", "/api/games", req),
  getGame: (id: string) => request<GameView>("GET", `/api/games/${id}`),
  command: (id: string, turn: number, body: CommandBody) => request<CommandResponse>("POST", `/api/games/${id}/commands`, { commandId: newCommandId(), turn, ...body }),
  endTurn: (id: string) => request<{ ok: boolean; duplicate: boolean; report: TurnReport; view: GameView }>("POST", `/api/games/${id}/end-turn`, { commandId: newCommandId() }),
  events: (id: string, since: number) => request<Pick<GameView, "narratives" | "assets" | "ai"> & { turn: number; stateHash: string }>("GET", `/api/games/${id}/events?since=${since}`),
  history: (id: string) => request<{ inState: GameView["state"]["history"]; persisted: { turn: number; type: string; importance: number; summary: string }[]; summary: GameView["narratives"][string] | null }>("GET", `/api/games/${id}/history`),
  requestSummary: (id: string) => request<{ status: string }>("POST", `/api/games/${id}/summary`),
  requestAsset: (id: string, body: { kind: "faction"; factionId: string } | { kind: "technology"; techId: string }) => request<{ key: string; status: string }>("POST", `/api/games/${id}/assets/request`, body),
  requestFactionNarrative: (id: string, factionId: string) => request<{ key: string }>("POST", `/api/games/${id}/narratives/faction`, { factionId }),
  save: (id: string, name?: string) => request<SaveSummary>("POST", `/api/games/${id}/save`, name ? { name } : {}),
  listSaves: () => request<{ saves: SaveSummary[] }>("GET", "/api/saves"),
  loadSave: (saveId: string) => request<{ gameId: string; migratedFrom: number | null }>("POST", `/api/saves/${saveId}/load`),
  deleteSave: (saveId: string) => request<void>("DELETE", `/api/saves/${saveId}`),
  demo: () => request<{ available: boolean }>("GET", "/api/demo"),
  claimDemo: () => request<{ gameId: string }>("POST", "/api/demo/claim"),
  devTelemetry: () => request<{ summary: unknown; status: unknown; faults: DevFaults }>("GET", "/internal/ai/telemetry"),
  setDevFaults: (f: Partial<DevFaults>) => request<DevFaults>("POST", "/internal/ai/faults", f),
  replayVerify: (id: string) => request<{ ok: boolean; expected: string; actual: string; commands: number; root: string }>("GET", `/internal/games/${id}/replay-verify`),
  decisions: (id: string) => request<{ decisions: unknown[] }>("GET", `/internal/games/${id}/decisions`),
};

export interface DevFaults {
  disableGemini: boolean;
  disableTypeSafe: boolean;
  forceRateLimit: boolean;
  forceTimeout: boolean;
}
