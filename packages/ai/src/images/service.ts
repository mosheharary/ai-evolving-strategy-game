import type { GameState, WorldEvent } from "@echoes/game-types";
import type { AIOrchestrator } from "../orchestrator";
import type { CallContext, ImageRequest } from "../providers/types";
import { InFlightDeduper } from "../resilience/controls";
import type { AssetStorage } from "../storage/storage";
import { eventImageRequest, factionPortraitRequest, heroImageRequest, locationImageRequest, technologyImageRequest } from "./prompts";
import { sha256Hex } from "@echoes/shared";

export interface AssetRecord {
  assetId: string;
  promptHash: string;
  kind: string;
  model: string;
  source: "gemini" | "local";
  promptId: string;
  promptVersion: number;
  width: number;
  height: number;
  mimeType: string;
  storageLocation: string;
  gameId: string | null;
  eventId: string | null;
  createdAt: Date;
}

export interface AssetRepository {
  findByPromptHash(promptHash: string): Promise<AssetRecord | null>;
  create(rec: Omit<AssetRecord, "assetId" | "createdAt">): Promise<AssetRecord>;
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" };

/**
 * ImageGenerationService — Gemini creates visual content.
 *   game event → canonical prompt → cache lookup (content hash) → reuse
 *                                                     └ missing → image model → storage → DB
 * The same image is never generated twice: identical prompts share one asset, and
 * concurrent identical requests are collapsed in flight.
 */
export class ImageGenerationService {
  private readonly inflight = new InFlightDeduper();

  constructor(private readonly ai: AIOrchestrator, private readonly storage: AssetStorage, private readonly repo: AssetRepository) {}

  private expectedHash(req: Omit<ImageRequest, "model">, hero: boolean): string {
    const model = hero ? this.ai.config.google.heroImageModel : this.ai.config.google.imageModel;
    const liveHash = sha256Hex(`${model}|${req.promptId}@${req.promptVersion}|${req.aspectRatio}|${req.prompt}`);
    return this.ai.config.effective.images === "live" ? liveHash : sha256Hex(`local|${liveHash}`);
  }

  private async produce(req: Omit<ImageRequest, "model">, ctx: CallContext, meta: { kind: string; eventId: string | null; hero?: boolean }): Promise<AssetRecord> {
    const expected = this.expectedHash(req, meta.hero ?? false);
    const existing = await this.repo.findByPromptHash(expected);
    if (existing && (await this.storage.exists(existing.storageLocation))) return existing;
    const { promise } = this.inflight.run(expected, async () => {
      const img = await this.ai.generateImage(req, ctx, { hero: meta.hero });
      // A fallback image may have a different hash than expected — check again before writing.
      const already = await this.repo.findByPromptHash(img.promptHash);
      if (already && (await this.storage.exists(already.storageLocation))) return already;
      const ext = EXT[img.mimeType] ?? "bin";
      const { location } = await this.storage.put(`${meta.kind}/${img.promptHash.slice(0, 2)}/${img.promptHash}.${ext}`, img.bytes, img.mimeType);
      return this.repo.create({
        promptHash: img.promptHash, kind: meta.kind, model: img.model, source: img.source, promptId: req.promptId, promptVersion: req.promptVersion,
        width: img.width, height: img.height, mimeType: img.mimeType, storageLocation: location, gameId: ctx.gameId, eventId: meta.eventId,
      });
    });
    return promise;
  }

  generateEventImage(state: GameState, e: WorldEvent, sceneDetail: string | null, ctx: CallContext): Promise<AssetRecord> {
    return this.produce(eventImageRequest(state, e, sceneDetail), ctx, { kind: "event", eventId: e.id, hero: e.type === "era_dawn" });
  }

  generateLocationImage(state: GameState, e: WorldEvent, ctx: CallContext): Promise<AssetRecord> {
    return this.produce(locationImageRequest(state, e), ctx, { kind: "location", eventId: e.id });
  }

  generateFactionPortrait(state: GameState, factionId: string, ctx: CallContext): Promise<AssetRecord> {
    return this.produce(factionPortraitRequest(state, factionId), ctx, { kind: "faction", eventId: null });
  }

  generateTechnologyImage(state: GameState, techId: string, ctx: CallContext): Promise<AssetRecord> {
    return this.produce(technologyImageRequest(state, techId), ctx, { kind: "technology", eventId: null });
  }

  generateHeroImage(state: GameState, kind: "intro" | "era", sceneDetail: string | null, ctx: CallContext): Promise<AssetRecord> {
    return this.produce(heroImageRequest(state, kind, sceneDetail), ctx, { kind: "hero", eventId: null, hero: true });
  }
}
