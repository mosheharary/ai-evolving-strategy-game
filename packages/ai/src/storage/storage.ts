import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";

/**
 * Object storage abstraction for generated assets. Game logic only sees this
 * interface; local development uses the filesystem (a Docker volume), and a
 * production deployment can provide an S3/GCS implementation with the same contract.
 */
export interface AssetStorage {
  readonly kind: string;
  put(key: string, bytes: Uint8Array, mimeType: string): Promise<{ location: string }>;
  get(location: string): Promise<Uint8Array | null>;
  exists(location: string): Promise<boolean>;
}

const SAFE_KEY = /^[a-z0-9][a-z0-9/_.-]{0,200}$/;

export class FileSystemAssetStorage implements AssetStorage {
  readonly kind = "filesystem";
  constructor(private readonly baseDir: string) {}

  private pathFor(location: string): string {
    if (!SAFE_KEY.test(location) || location.includes("..")) throw new Error("invalid storage key");
    const p = normalize(join(this.baseDir, location));
    if (!p.startsWith(normalize(this.baseDir))) throw new Error("invalid storage key");
    return p;
  }

  async put(key: string, bytes: Uint8Array, _mimeType: string): Promise<{ location: string }> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    return { location: key };
  }

  async get(location: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.pathFor(location)));
    } catch {
      return null;
    }
  }

  async exists(location: string): Promise<boolean> {
    try {
      await stat(this.pathFor(location));
      return true;
    } catch {
      return false;
    }
  }
}

export class MemoryAssetStorage implements AssetStorage {
  readonly kind = "memory";
  readonly files = new Map<string, Uint8Array>();
  async put(key: string, bytes: Uint8Array): Promise<{ location: string }> {
    this.files.set(key, bytes);
    return { location: key };
  }
  async get(location: string): Promise<Uint8Array | null> {
    return this.files.get(location) ?? null;
  }
  async exists(location: string): Promise<boolean> {
    return this.files.has(location);
  }
}
