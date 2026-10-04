import { expect, test, type Page } from "@playwright/test";
import "../apps/web/src/debug";

async function clickTile(page: Page, x: number, y: number) {
  const point = await page.evaluate(({ x, y }) => window.__GAME_DEBUG__!.getTileScreenPosition(x, y), { x, y });
  await page.mouse.click(point.x, point.y);
}
async function manage(page: Page, id = "warrior-1") {
  const point = await page.evaluate(id => window.__GAME_DEBUG__!.getUnitScreenPosition(id), id);
  await page.mouse.click(point.x, point.y);
  await page.getByRole("button", { name: "Inspect resources", exact: true }).click();
}

test("one-time resource nodes display Gold rewards without hover rebuilds", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.waitForFunction(() => !!window.__GAME_DEBUG__);
  const initial = await page.evaluate(() => ({ resource: window.__GAME_DEBUG__!.getResourceRenderStats(), materials: window.__GAME_DEBUG__!.getProfile().materials, state: window.__GAME_DEBUG__!.getState() }));
  expect(initial.resource.opportunities).toBeGreaterThan(50);
  expect(initial.resource.developed).toBe(0);
  await manage(page);
  await clickTile(page, 4, 3);
  const panel = page.getByRole("region", { name: "Resource tile", exact: true });
  await expect(panel.getByRole("heading")).toHaveText("Wheat");
  await expect(panel).toContainText("+2 Gold once");
  await expect(panel).toContainText("Available");
  await expect(panel).toContainText("Controlled by Sunward");
  await expect(panel.getByRole("button", { name: /Civilian/ })).toHaveCount(0);
  await expect(page.getByTestId("available-population")).toHaveText("2");
  expect((await page.evaluate(() => window.__GAME_DEBUG__!.getProfile())).materials).toBe(initial.materials);
  expect((await page.evaluate(() => window.__GAME_DEBUG__!.getResourceRenderStats())).meshes).toBeLessThanOrEqual(9);
  for (let i = 0; i < 20; i++) await page.mouse.move(550 + i * 10, 500);
  expect((await page.evaluate(() => window.__GAME_DEBUG__!.getResourceRenderStats())).builds).toBe(initial.resource.builds);
  expect(await page.evaluate(() => window.__GAME_DEBUG__!.getState())).toEqual(initial.state);
  await page.screenshot({ path: testInfo.outputPath("automatic-farm-board.png") });
});

test("desktop city and resource controls fit without nested scrolling or covering unit controls", async ({ page }, testInfo) => {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.waitForFunction(() => !!window.__GAME_DEBUG__);
    await manage(page);
    await clickTile(page, 4, 3);
    const boxes = await page.evaluate(() => {
      const selectors = [".city-panel", ".resource-panel", ".restart", ".treasury-bar", ".expedition-card"];
      return selectors.map(selector => {
        const element = document.querySelector(selector) as HTMLElement;
        const rect = element.getBoundingClientRect();
        return { selector, x: rect.x, y: rect.y, width: rect.width, height: rect.height, scroll: element.scrollHeight > element.clientHeight + 1 && getComputedStyle(element).overflowY !== "visible" };
      });
    });
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      expect(box.scroll).toBe(false);
    }
    const end = boxes.find(box => box.selector === ".restart")!;
    for (const panel of boxes.filter(box => [".city-panel", ".resource-panel"].includes(box.selector))) {
      for (const control of [end]) expect(panel.x >= control.x + control.width || panel.x + panel.width <= control.x || panel.y >= control.y + control.height || panel.y + panel.height <= control.y).toBe(true);
    }
    await expect(page.getByRole("button", { name: "Assign Civilian", exact: true })).toHaveCount(0);
    await expect(page.getByTestId("player-population")).toBeVisible();
    await expect(page.getByRole("button", { name: "Upgrade Town Center" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`layout-${viewport.width}x${viewport.height}.png`) });
  }
});

test("automatic Gold and population agree across browsers", async ({ page, browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const guest = await context.newPage();
  const state = (client: Page) => client.evaluate(() => window.__GAME_DEBUG__!.getState());
  const settled = async (revision: number) => {
    for (const client of [page, guest]) {
      await expect.poll(async () => (await state(client)).revision).toBe(revision);
      await expect.poll(() => client.evaluate(() => window.__GAME_DEBUG__!.isAnimating())).toBe(false);
    }
    expect(await state(guest)).toEqual(await state(page));
  };
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
    await expect(guest.getByTestId("active-player")).toContainText("Fern");
    expect((await state(guest)).tiles).toEqual((await state(page)).tiles);
    await manage(page);
    await clickTile(page, 4, 3);
    const initial = await state(page);
    const income = Number((await page.getByTestId("income").innerText()).match(/\d+/)![0]);
    await expect(page.getByRole("region", { name: "Resource tile", exact: true })).toContainText("Available");
    await clickTile(guest, 4, 3);
    await expect(guest.getByRole("region", { name: "Resource tile", exact: true })).toContainText("Available");
    await expect(guest.getByRole("button", { name: "Assign Civilian", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "End Turn", exact: true }).click();
    await settled(1);
    expect((await state(page)).players[0].resources.gold).toBe(initial.players[0].resources.gold);
    await guest.getByRole("button", { name: "End Turn", exact: true }).click();
    await settled(2);
    expect((await state(page)).players[0].resources.gold).toBe(initial.players[0].resources.gold + income);
    await expect(page.getByTestId("player-population")).toHaveText("1 / 3");
    await expect(guest.getByTestId("player-population")).toHaveText("1 / 3");
    await page.screenshot({ path: testInfo.outputPath("multiplayer-resources.png") });
    expect(Object.keys((await state(page)).players[0].resources)).toEqual(["gold"]);
  } finally {
    await context.close();
  }
});
