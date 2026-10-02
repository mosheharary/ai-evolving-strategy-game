import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";

/** Resolve relative paths against the monorepo root so api and worker share one asset directory. */
function resolveFromRepoRoot(p: string): string {
  if (isAbsolute(p)) return p;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return resolve(dir, p);
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return resolve(p);
}

const bool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

export const PlatformEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().min(1).default("postgresql://echoes:echoes@localhost:5432/echoes"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  ASSET_STORAGE_DIR: z.string().min(1).default("./data/assets"),
  API_PORT: z.coerce.number().int().default(4000),
  API_HOST: z.string().default("0.0.0.0"),
  COOKIE_SECRET: z.string().min(16).default("dev-only-cookie-secret-change-me"),
  /** Origins allowed to make state-changing requests (CSRF defence). Comma separated. */
  ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),
  DEV_TOOLS_ENABLED: bool.default(true),
  INTERNAL_TOKEN: z.string().optional(),
  DEMO_MODE: bool.default(true),
  TRUST_PROXY: bool.default(true),
});

export type PlatformEnv = z.infer<typeof PlatformEnvSchema>;

export function loadPlatformEnv(env: Record<string, string | undefined> = process.env): PlatformEnv {
  const parsed = PlatformEnvSchema.parse(env);
  parsed.ASSET_STORAGE_DIR = resolveFromRepoRoot(parsed.ASSET_STORAGE_DIR);
  if (parsed.NODE_ENV === "production" && parsed.COOKIE_SECRET === "dev-only-cookie-secret-change-me") {
    // Fail loudly rather than run production with a known secret.
    console.warn(JSON.stringify({ level: "warn", msg: "COOKIE_SECRET is the development default; set a strong secret for production" }));
  }
  return parsed;
}
