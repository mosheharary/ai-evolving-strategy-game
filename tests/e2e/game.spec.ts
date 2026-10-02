import { expect, test, type Page } from "@playwright/test";

/**
 * Full player journey through the real UI and server:
 * start game → research → build → collect resources → interact with a faction →
 * end turn → observe faction AI → save → reload → continue.
 */

type Hooks = { store: { getState(): { view: { state: { turn: number; units: { id: string; type: string; ownerId: string }[]; buildings: { type: string; ownerId: string }[] } } | null; select(s: unknown): void } }; clickTile(t: number): void; validBuildTiles(type: string): number[] };
const hooks = (page: Page) => page.evaluate(() => Boolean((window as unknown as { __echoes?: unknown }).__echoes));

test("a campaign can be played, saved, reloaded and continued", async ({ page }) => {
  await page.goto("/?debug=1");
  const start = page.getByTestId("quick-start").or(page.getByTestId("new-game"));
  await start.first().waitFor();
  // Always create a fresh world via the New Game form.
  await page.getByTestId("new-game").click();
  await page.getByTestId("civ-name").fill("Playwright Folk");
  await page.getByTestId("seed").fill("e2e-world-1");
  await page.getByTestId("start-game").click();
  await page.waitForURL(/\/play\/g[0-9a-f]{16}/);
  const gameUrl = page.url().split("?")[0]!;
  await page.goto(`${gameUrl}?debug=1`);
  await expect(page.getByTestId("game-root")).toBeVisible();
  await expect.poll(() => hooks(page)).toBe(true);

  // Intro (generated once, persisted) → begin.
  await page.getByTestId("begin").click();
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByTestId("turn")).toHaveText("1");

  // Research a technology.
  await page.getByTestId("btn-research").click();
  await page.getByTestId("tech-irrigation").click();
  await expect(page.getByTestId("btn-research")).toContainText("Irrigation");

  // Build a farm on a valid tile (same code path as clicking the 3D map).
  await page.getByTestId("btn-build").click();
  await page.getByTestId("build-farm").click();
  const tile = await page.evaluate(() => (window as unknown as { __echoes: Hooks }).__echoes.validBuildTiles("farm")[0]!);
  await page.evaluate((t) => (window as unknown as { __echoes: Hooks }).__echoes.clickTile(t), tile);
  await expect(page.getByTestId("toast-info").filter({ hasText: /Farm/ })).toBeVisible();

  // Collect resources with a worker (clear selection to show the unit roster).
  await page.keyboard.press("Escape");
  await page.getByTestId("unit-worker").first().click();
  const gather = page.getByTestId("gather");
  if (await gather.isEnabled()) {
    await gather.click();
    await expect(page.getByTestId("toast-info").filter({ hasText: /Gathered/ })).toBeVisible();
  }

  // Interact with a faction: send a gift and propose trade.
  await page.getByTestId("btn-diplomacy").click();
  await page.getByTestId("dip-saltwind").click();
  await page.getByTestId("send-gift").click();
  await expect(page.getByTestId("toast-info").filter({ hasText: /Gift delivered/ })).toBeVisible();
  await page.getByTestId("propose-trade").click();
  await page.keyboard.press("Escape");

  // End turn and observe faction AI.
  await page.getByTestId("end-turn").click();
  const summary = page.getByTestId("turn-summary");
  await expect(summary).toBeVisible({ timeout: 60_000 });
  await expect(summary.getByTestId("faction-actions").locator("li")).toHaveCount(5);
  await page.getByTestId("continue-turn").click();
  while (await page.getByTestId("event-modal").isVisible()) await page.keyboard.press("Escape");
  await expect(page.getByTestId("turn")).toHaveText("2");

  // Save (named) via the UI.
  await page.getByTestId("open-saves").click();
  await page.getByLabel("Save name").fill("E2E checkpoint");
  await page.getByTestId("save-as").click();
  await expect(page.getByTestId("save-row").filter({ hasText: "E2E checkpoint" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Advance once more, then reload the page: state persists server-side.
  await page.getByTestId("end-turn").click();
  await expect(page.getByTestId("turn-summary")).toBeVisible({ timeout: 60_000 });
  await page.reload();
  await expect(page.getByTestId("turn")).toHaveText("3");

  // Load the checkpoint and continue the campaign.
  await page.getByTestId("open-saves").click();
  await page.getByTestId("save-row").filter({ hasText: "E2E checkpoint" }).getByTestId("load-save").click();
  await expect(page.getByTestId("turn")).toHaveText("2");
  await page.getByTestId("end-turn").click();
  await expect(page.getByTestId("turn-summary")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("continue-turn").click();
  await expect(page.getByTestId("turn")).toHaveText("3");

  // The farm we built is still part of the authoritative world.
  const farms = await page.evaluate(() => (window as unknown as { __echoes: Hooks }).__echoes.store.getState().view!.state.buildings.filter((b) => b.ownerId === "player" && b.type === "farm").length);
  expect(farms).toBeGreaterThanOrEqual(1);
});

test("API keys never reach the browser", async ({ page, request }) => {
  const scripts: string[] = [];
  page.on("response", async (r) => {
    if (r.url().endsWith(".js")) scripts.push(await r.text().catch(() => ""));
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const ready = await request.get("/api/demo");
  expect(ready.ok()).toBe(true);
  for (const s of scripts) {
    expect(s).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
    expect(s).not.toContain("GOOGLE_API_KEY");
    expect(s).not.toContain("TYPESAFE_API_KEY");
  }
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(storage).not.toMatch(/key/i);
});
