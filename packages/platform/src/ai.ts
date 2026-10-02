import { createAIServices, describeAIConfig, FileSystemAssetStorage, loadAIConfig, type AIServices, type KeyValueStore } from "@echoes/ai";
import { PrismaAIRecorder, PrismaAssetRepository, type Db } from "@echoes/database";
import type { Logger } from "./logger";

export interface PlatformAI extends AIServices {
  recorder: PrismaAIRecorder;
  assets: PrismaAssetRepository;
  storage: FileSystemAssetStorage;
}

/** Wire AI services with Postgres telemetry, filesystem asset storage and the shared Redis store. */
export function buildAI(args: { db: Db; store: KeyValueStore; logger: Logger; assetDir: string; env?: Record<string, string | undefined> }): PlatformAI {
  const config = loadAIConfig(args.env ?? process.env);
  const recorder = new PrismaAIRecorder(args.db);
  const assets = new PrismaAssetRepository(args.db);
  const storage = new FileSystemAssetStorage(args.assetDir);
  args.logger.info({ ai: describeAIConfig(config) }, "ai.configured");
  const services = createAIServices({
    config, store: args.store, recorder, storage, assets,
    logger: {
      info: (o, m) => args.logger.info(o, m),
      warn: (o, m) => args.logger.warn(o, m),
      error: (o, m) => args.logger.error(o, m),
    },
  });
  return { ...services, recorder, assets, storage };
}
