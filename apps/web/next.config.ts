import path from "node:path";
import type { NextConfig } from "next";

const API = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

// The browser only ever talks to this origin; /api and /internal are proxied server-side
// to the Fastify API. No API key or provider endpoint is ever part of the client bundle.
const csp = [
  "default-src 'self'",
  process.env.NODE_ENV === "development" ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  transpilePackages: ["@echoes/game-engine", "@echoes/game-types", "@echoes/procedural-world", "@echoes/shared"],
  reactStrictMode: true,
  // Do not generate AGENTS.md / CLAUDE.md files into the project.
  agentRules: false,
  poweredByHeader: false,
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API}/api/:path*` },
      { source: "/internal/:path*", destination: `${API}/internal/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default config;
