import { Queue, type ConnectionOptions } from "bullmq";

export const NARRATIVE_QUEUE = "echoes-narrative";
export const IMAGE_QUEUE = "echoes-images";

export type NarrativeJob =
  | { kind: "intro"; gameId: string; playerId: string; correlationId: string }
  | { kind: "turn"; gameId: string; playerId: string; turn: number; eventIds: string[]; correlationId: string }
  | { kind: "summary"; gameId: string; playerId: string; correlationId: string }
  | { kind: "quest"; gameId: string; playerId: string; questId: string; correlationId: string }
  | { kind: "faction"; gameId: string; playerId: string; factionId: string; turn: number; correlationId: string };

export type ImageJob =
  | { kind: "event"; gameId: string; playerId: string; eventId: string; sceneDetail: string | null; correlationId: string }
  | { kind: "faction"; gameId: string; playerId: string; factionId: string; correlationId: string }
  | { kind: "technology"; gameId: string; playerId: string; techId: string; correlationId: string }
  | { kind: "hero"; gameId: string; playerId: string; heroKind: "intro" | "era"; era: number; sceneDetail: string | null; correlationId: string };

export function redisConnection(url: string): ConnectionOptions {
  return { url, maxRetriesPerRequest: null };
}

export interface Queues {
  narrative: Queue<NarrativeJob>;
  images: Queue<ImageJob>;
  close(): Promise<void>;
}

export function createQueues(redisUrl: string): Queues {
  const connection = redisConnection(redisUrl);
  const defaultJobOptions = { attempts: 2, backoff: { type: "exponential" as const, delay: 2_000 }, removeOnComplete: 500, removeOnFail: 500 };
  const narrative = new Queue<NarrativeJob>(NARRATIVE_QUEUE, { connection, defaultJobOptions });
  const images = new Queue<ImageJob>(IMAGE_QUEUE, { connection, defaultJobOptions });
  return {
    narrative,
    images,
    async close() {
      await Promise.all([narrative.close(), images.close()]);
    },
  };
}

/**
 * Deterministic job ids give queue-level deduplication: the same work is never
 * enqueued twice (BullMQ ignores an add() whose id already exists).
 */
export function narrativeJobId(job: NarrativeJob): string {
  switch (job.kind) {
    case "intro":
      return `intro-${job.gameId}`;
    case "turn":
      return `turn-${job.gameId}-${job.turn}-${job.eventIds.join("_").slice(0, 120) || "quiet"}`;
    case "summary":
      return `summary-${job.gameId}-${Math.floor(Date.now() / 60_000)}`;
    case "quest":
      return `quest-${job.gameId}-${job.questId}`;
    case "faction":
      return `faction-${job.gameId}-${job.factionId}-${job.turn}`;
  }
}

export function imageJobId(job: ImageJob): string {
  switch (job.kind) {
    case "event":
      return `event-${job.gameId}-${job.eventId}`;
    case "faction":
      return `faction-${job.gameId}-${job.factionId}`;
    case "technology":
      return `tech-${job.gameId}-${job.techId}`;
    case "hero":
      return `hero-${job.gameId}-${job.heroKind}-${job.era}`;
  }
}
