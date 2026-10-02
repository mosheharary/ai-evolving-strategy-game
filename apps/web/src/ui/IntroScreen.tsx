"use client";

import { heroAssetKey } from "@echoes/game-types";
import { useGame } from "@/store/gameStore";

/** Campaign introduction: generated once by Gemini and persisted; a local prologue shows until it arrives. */
export function IntroScreen() {
  const view = useGame((s) => s.view);
  const seen = useGame((s) => s.introSeen);
  const dismiss = useGame((s) => s.dismissIntro);
  if (!view || seen) return null;
  const intro = view.narratives.intro;
  const hero = view.assets[heroAssetKey("intro", 1)];
  const capital = view.state.settlements.find((s) => s.ownerId === "player");
  return (
    <div className="modal-backdrop" style={{ background: "rgba(5,7,9,0.78)" }}>
      <div className="panel modal wide" role="dialog" aria-modal="true" aria-label="Campaign introduction" data-testid="intro">
        {hero ? <img className="thumb" src={hero.url} alt="The frontier at the dawn of your civilization" style={{ borderRadius: "12px 12px 0 0", aspectRatio: "21/9" }} /> : <div className="thumb shimmer" style={{ borderRadius: "12px 12px 0 0", aspectRatio: "21/9" }} />}
        <div className="modal-body" style={{ paddingTop: "1rem" }}>
          <h2 style={{ fontSize: "1.6rem" }}>{intro?.title ?? `The Last Embers of ${view.state.civilizationName}`}</h2>
          <p className="prose">
            {intro?.body ?? `When the old world went quiet, only ${view.state.civilizationName} remained. Your people raise their first hearth${capital ? ` at ${capital.name}` : ""}. The land is wide, and it remembers everything.`}
          </p>
          <p className="faint" style={{ fontSize: "0.8rem" }}>World seed {view.state.seed} · {view.state.config.difficulty} · {intro ? (intro.source === "gemini" ? "Written by Gemini" : "Local chronicle") : "The chronicler is writing…"}</p>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn primary" onClick={dismiss} autoFocus data-testid="begin">Begin</button>
          </div>
        </div>
      </div>
    </div>
  );
}
