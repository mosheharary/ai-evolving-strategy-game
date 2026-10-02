import { pino, type Logger as PinoLogger } from "pino";

/**
 * Structured JSON logging. Secrets are redacted defensively even though they are
 * never intentionally logged: API keys, cookies, auth headers and env-like fields.
 */
export const REDACT_PATHS = [
  "apiKey", "*.apiKey", "*.*.apiKey", "api_key", "*.api_key",
  "GOOGLE_API_KEY", "GEMINI_API_KEY", "TYPESAFE_API_KEY", "*.GOOGLE_API_KEY", "*.GEMINI_API_KEY", "*.TYPESAFE_API_KEY",
  "req.headers.authorization", "req.headers.cookie", "req.headers['x-goog-api-key']", "req.headers['x-internal-token']",
  "res.headers['set-cookie']", "headers.authorization", "headers.cookie", "cookie", "password", "secret", "*.secret",
];

export function createLogger(service: string, level: string = process.env.LOG_LEVEL ?? "info"): PinoLogger {
  return pino({
    level,
    base: { service },
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
  });
}

export type Logger = PinoLogger;
