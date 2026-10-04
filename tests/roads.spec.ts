import { expect, test, type Page } from "@playwright/test";
import "../apps/web/src/debug";

const snapshot = (page: Page) => page.evaluate(() => window.__GAME_DEBUG__!.getState());
async function tile(page: Page, x: number, y: number) {
  const point = await page.evaluate(({ x, y }) => window.__GAME_DEBUG__!.getTileScreenPosition(x, y), { x, y });
  await page.mouse.click(point.x, point.y);
}

test("road controls build shared infrastructure, reject invalid tiles and recover synchronized roads on reload", async ({ page, browser }, testInfo) => {
  test.setTimeout(120000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const guest = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Multiplayer lobby" }).click();
    await page.getByLabel("Player name", { exact: true }).fill("Fern");
    await page.getByRole("button", { name: "Create room", exact: true }).click();
    await expect(page.getByLabel("Room code", { exact: true })).toHaveValue(/^[A-HJ-NP-Z2-9]{6}$/);
    const code = await page.getByLabel("Room code", { exact: true }).inputValue();
    await guest.goto("/");
    await guest.getByRole("button", { name: "Multiplayer lobby" }).click();
    await guest.getByLabel("Player name", { exact: true }).fill("Moss");
    await guest.getByLabel("Join with room code").fill(code);
    await guest.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(page.getByRole("button", { name: "Start game", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await expect(page.getByTestId("active-player")).toContainText("Fern");
    const settled = async (revision: number) => {
      for (const client of [page, guest]) await expect.poll(async () => (await snapshot(client)).revision).toBe(revision);
      const state = await snapshot(page);
      await expect((state.activePlayerId === state.players[0].id ? page : guest).getByRole("button", { name: "End Turn", exact: true })).toBeEnabled();
      expect(await snapshot(page)).toEqual(await snapshot(guest));
    };
    const round = async () => {
      for (const client of [page, guest]) {
        const revision = (await snapshot(page)).revision;
        await client.getByRole("button", { name: "End Turn", exact: true }).click();
        await settled(revision + 1);
      }
    };
    await round();
    await round();
    await round();
    await round();
    await page.getByRole("button", { name: "Technologies", exact: true }).click();
    await expect(page.getByRole("article", { name: "Roads", exact: true })).toContainText("Tier 2 · 6 Gold");
    await page.getByRole("button", { name: "Unlock Roads", exact: true }).click();
    await settled(9);
    await page.getByRole("button", { name: "Close technologies" }).click();
    await page.getByRole("button", { name: "Build Roads", exact: true }).click();
    const panel = page.getByRole("region", { name: "Build Road", exact: true });
    const build = panel.getByRole("button", { name: "Build Road · 3 Gold", exact: true });
    await expect(build).toBeDisabled();
    await tile(page, 4, 4);
    await expect(build).toBeEnabled();
    const gold = (await snapshot(page)).players[0].resources.gold;
    await build.click();
    await settled(10);
    expect((await snapshot(page)).players[0].resources.gold).toBe(gold - 3);
    expect((await snapshot(guest)).tiles.find(tile => tile.x === 4 && tile.y === 4)?.road).toBe(true);
    await expect(build).toBeDisabled();
    await expect(panel).toContainText("Already road-connected");
    await tile(page, 7, 4);
    await expect(build).toBeDisabled();
    await expect(panel).toContainText("Enemy-controlled land");
    await page.getByRole("button", { name: "Cancel roads" }).click();
    await round();
    const neutral = await page.evaluate(() => {
      const debug = window.__GAME_DEBUG__!;
      const state = debug.getState();
      return state.tiles.find(tile => tile.x >= 8 && tile.x <= 12 && tile.y >= 6 && tile.y <= 10 && tile.terrain === "grass" && !debug.getTileTerritory(tile.x, tile.y)?.playerId && !state.cities.some(city => city.x === tile.x && city.y === tile.y))!;
    });
    expect(neutral).toBeDefined();
    await page.getByRole("button", { name: "Build Roads", exact: true }).click();
    await tile(page, neutral.x, neutral.y);
    await expect(build).toBeEnabled();
    await build.click();
    await settled(13);
    await page.screenshot({ path: testInfo.outputPath("shared-roads.png") });
    const saved = await snapshot(page);
    await page.reload();
    await expect.poll(async () => (await snapshot(page)).revision).toBe(saved.revision);
    expect(await snapshot(page)).toEqual(saved);
    expect(await snapshot(guest)).toEqual(saved);
    await expect(page.getByTestId("gold")).toHaveText(String(saved.players[0].resources.gold));
    await page.screenshot({ path: testInfo.outputPath("roads-reconnected.png") });
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test("road placement controls fit a narrow viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.waitForFunction(() => !!window.__GAME_DEBUG__);
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "End Turn", exact: true }).click();
  await page.getByRole("button", { name: "Technologies", exact: true }).click();
  await page.getByRole("button", { name: "Unlock Roads", exact: true }).click();
  await page.getByRole("button", { name: "Close technologies" }).click();
  await page.getByRole("button", { name: "Build Roads", exact: true }).click();
  const panel = page.getByRole("region", { name: "Build Road", exact: true });
  await expect(panel).toContainText("Cost: 3 Gold");
  const bounds = (await panel.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y + bounds.height).toBeLessThan((await page.getByRole("button", { name: "End Turn", exact: true }).boundingBox())!.y);
  await expect(panel.getByRole("button", { name: "Build Road \u00b7 3 Gold" })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("roads-mobile.png") });
});
