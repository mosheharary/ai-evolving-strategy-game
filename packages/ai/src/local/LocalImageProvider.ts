import { SeededRandom } from "@echoes/shared";
import type { CallContext, ImageGenerationProvider, ImageRequest, ImageResult } from "../providers/types";

/**
 * LocalImageProvider — procedural, deterministic SVG "paintings" used when image
 * generation is unavailable (mock mode, failures, budget exhausted). Layered
 * ridgelines, sky gradients and silhouettes coloured by the event palette.
 */

const PALETTES: Record<string, { sky: [string, string]; land: string[]; sun: string; accent: string }> = {
  fire: { sky: ["#2a0f0a", "#d4683a"], land: ["#5a2a1d", "#3c1b14", "#22100c"], sun: "#ffcf7a", accent: "#ff7a3d" },
  water: { sky: ["#0d1d2e", "#5f8fb3"], land: ["#2c4a5c", "#1d3443", "#10202b"], sun: "#e8f2ff", accent: "#7fc8ff" },
  earth: { sky: ["#1e1a14", "#b49a6a"], land: ["#5e4d36", "#3f3325", "#231d15"], sun: "#ffe2a8", accent: "#d8b26a" },
  life: { sky: ["#0f2117", "#8cc79a"], land: ["#2f5a3a", "#1f3f28", "#122717"], sun: "#f3ffd8", accent: "#a6f0a0" },
  gold: { sky: ["#221a0b", "#e2b25a"], land: ["#5c4724", "#3f3118", "#241c0d"], sun: "#fff1c2", accent: "#ffd36b" },
  shadow: { sky: ["#0c0d14", "#4b4f6b"], land: ["#2a2c3c", "#1b1c28", "#0f1018"], sun: "#c9cbe0", accent: "#8f93c0" },
  arcane: { sky: ["#140b22", "#7d5bc2"], land: ["#3a2a5c", "#271c40", "#150f25"], sun: "#efe2ff", accent: "#c9a6ff" },
};

function ridge(rng: SeededRandom, w: number, h: number, base: number, amp: number): string {
  const pts: string[] = [`0,${h}`];
  let y = base;
  for (let x = 0; x <= w; x += 32) {
    y = Math.max(base - amp, Math.min(base + amp, y + rng.range(-amp / 3, amp / 3)));
    pts.push(`${x},${Math.round(y)}`);
  }
  pts.push(`${w},${h}`);
  return pts.join(" ");
}

export function renderProceduralSvg(req: ImageRequest): { svg: string; width: number; height: number } {
  const rng = new SeededRandom(`${req.facts.seed}:${req.facts.kind}:${req.facts.title}`);
  const [w, h] = req.aspectRatio === "1:1" ? [768, 768] : req.aspectRatio === "3:4" ? [640, 853] : [1024, 576];
  const p = PALETTES[req.facts.palette] ?? PALETTES.earth!;
  const sunX = rng.int(Math.round(w * 0.2), Math.round(w * 0.8));
  const sunY = rng.int(Math.round(h * 0.18), Math.round(h * 0.4));
  const layers = p.land.map((c, i) => `<polygon points="${ridge(rng, w, h, h * (0.5 + i * 0.13), h * (0.14 - i * 0.03))}" fill="${c}" opacity="${0.92 + i * 0.03}"/>`).join("");
  const structures = Array.from({ length: rng.int(2, 6) }, () => {
    const x = rng.int(40, w - 80);
    const bh = rng.int(18, 60);
    const bw = rng.int(14, 34);
    const y = Math.round(h * 0.78) - bh;
    return `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="#0b0b0f" opacity="0.85"/><polygon points="${x - 4},${y} ${x + bw / 2},${y - bw * 0.7} ${x + bw + 4},${y}" fill="#0b0b0f" opacity="0.85"/><rect x="${x + bw / 3}" y="${y + bh / 3}" width="4" height="6" fill="${p.accent}" opacity="0.9"/>`;
  }).join("");
  const motes = Array.from({ length: 40 }, () => `<circle cx="${rng.int(0, w)}" cy="${rng.int(0, Math.round(h * 0.7))}" r="${rng.range(0.6, 2.2).toFixed(1)}" fill="${p.accent}" opacity="${rng.range(0.15, 0.6).toFixed(2)}"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.sky[0]}"/><stop offset="1" stop-color="${p.sky[1]}"/></linearGradient>` +
    `<radialGradient id="sun" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${p.sun}" stop-opacity="1"/><stop offset="1" stop-color="${p.sun}" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0.55" stop-color="${p.sky[1]}" stop-opacity="0"/><stop offset="1" stop-color="${p.sky[0]}" stop-opacity="0.65"/></linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#sky)"/><circle cx="${sunX}" cy="${sunY}" r="${Math.round(h * 0.35)}" fill="url(#sun)" opacity="0.55"/><circle cx="${sunX}" cy="${sunY}" r="${Math.round(h * 0.06)}" fill="${p.sun}"/>` +
    `${motes}${layers}${structures}<rect width="${w}" height="${h}" fill="url(#haze)"/></svg>`;
  return { svg, width: w, height: h };
}

export class LocalImageProvider implements ImageGenerationProvider {
  readonly name = "local" as const;

  async generateImage(req: ImageRequest, _ctx: CallContext): Promise<ImageResult> {
    const { svg, width, height } = renderProceduralSvg(req);
    return { bytes: new TextEncoder().encode(svg), mimeType: "image/svg+xml", width, height, model: "procedural-svg-v1" };
  }
}
