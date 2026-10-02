import type { AIConfig } from "./config";
import { ContextCacheManager } from "./gemini/contextCache";
import { GoogleAIService } from "./gemini/GoogleAIService";
import { GeminiImageProvider, GeminiTextProvider } from "./gemini/providers";
import { ImageGenerationService, type AssetRepository } from "./images/service";
import { DeterministicDecisionProvider, MockDecisionProvider } from "./local/decisionProviders";
import { LocalImageProvider } from "./local/LocalImageProvider";
import { LocalTextProvider } from "./local/LocalTextProvider";
import { NarrativeService } from "./narrative/service";
import { AIOrchestrator } from "./orchestrator";
import type { KeyValueStore } from "./resilience/store";
import type { AssetStorage } from "./storage/storage";
import type { AIRecorder, Logger } from "./telemetry";
import { TypeSafeDecisionProvider } from "./typesafe/TypeSafeDecisionProvider";

export interface AIServices {
  orchestrator: AIOrchestrator;
  narrative: NarrativeService;
  images: ImageGenerationService;
  contextCache: ContextCacheManager;
}

/** Build AI services. Live providers are only constructed when a key exists and the mode is live. */
export function createAIServices(deps: { config: AIConfig; store: KeyValueStore; recorder: AIRecorder; logger: Logger; storage: AssetStorage; assets: AssetRepository }): AIServices {
  const { config } = deps;
  const google = config.google.apiKey && (config.effective.narrative === "live" || config.effective.images === "live")
    ? new GoogleAIService(config.google.apiKey, { textTimeoutMs: config.google.timeoutMs, imageTimeoutMs: config.google.imageTimeoutMs })
    : null;
  const typesafe = config.typesafe.apiKey && config.effective.strategy === "live"
    ? new TypeSafeDecisionProvider({ apiKey: config.typesafe.apiKey, model: config.typesafe.model, baseURL: config.typesafe.baseURL, timeoutMs: config.typesafe.timeoutMs })
    : null;
  const orchestrator = new AIOrchestrator({
    config, store: deps.store, recorder: deps.recorder, logger: deps.logger,
    retry: { attempts: Math.max(1, config.typesafe.maxRetries + 1) },
    providers: {
      text: { live: google ? new GeminiTextProvider(google) : null, local: new LocalTextProvider() },
      image: { live: google ? new GeminiImageProvider(google) : null, local: new LocalImageProvider() },
      decision: { live: typesafe, mock: new MockDecisionProvider(), deterministic: new DeterministicDecisionProvider() },
    },
  });
  return {
    orchestrator,
    narrative: new NarrativeService(orchestrator),
    images: new ImageGenerationService(orchestrator, deps.storage, deps.assets),
    contextCache: new ContextCacheManager(google, config, deps.store, deps.logger),
  };
}
