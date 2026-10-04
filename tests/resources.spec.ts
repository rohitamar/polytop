import { expect, test } from "@playwright/test";
import { getHarvestReason, getTerritory, positionKey } from "../packages/game-core/src/index";
import { snapshot, inspect, research, fund } from "./development-helpers";

test("development controls show paid population actions without hover rebuilds", async ({ page }, info) => {
  await page.goto("/"); await page.waitForFunction(() => !!window.__GAME_DEBUG__);
  const initial = await snapshot(page);
  const resource = initial.tiles.find(tile => tile.resource === "orchard" && getTerritory(initial).some(claim => claim.playerId === initial.activePlayerId && positionKey(claim) === positionKey(tile)))!;
  const stats = await page.evaluate(() => window.__GAME_DEBUG__!.getResourceRenderStats());
  await inspect(page, resource);
  const panel = page.getByRole("region", { name: "Develop tile" });
  await expect(panel).toContainText("2 Gold · +1 population");
  await expect(panel).toContainText("Requires Organization");
  for (let i = 0; i < 20; i++) await page.mouse.move(550 + i * 10, 500);
  expect(await snapshot(page)).toEqual(initial);
  expect((await page.evaluate(() => window.__GAME_DEBUG__!.getResourceRenderStats())).builds).toBe(stats.builds);
  await page.screenshot({ path: info.outputPath("paid-development.png") });
});

test("development controls fit desktop and mobile viewports", async ({ page }, info) => {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport); await page.goto("/"); await page.waitForFunction(() => !!window.__GAME_DEBUG__);
    const state = await snapshot(page);
    const resource = state.tiles.find(tile => tile.resource === "orchard" && getTerritory(state).some(claim => claim.playerId === state.activePlayerId && positionKey(claim) === positionKey(tile)))!;
    await inspect(page, resource);
    const panel = page.getByRole("region", { name: "Develop tile" });
    const bounds = (await panel.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    const end = (await page.getByRole("button", { name: "End Turn", exact: true }).boundingBox())!;
    expect(bounds.x + bounds.width <= end.x || end.x + end.width <= bounds.x || bounds.y + bounds.height <= end.y || end.y + end.height <= bounds.y).toBe(true);
    await page.screenshot({ path: info.outputPath(`development-${viewport.width}.png`) });
  }
});

test("harvesting spends Gold exactly once and increases city population", async ({ page }, info) => {
  await page.goto("/"); await page.waitForFunction(() => !!window.__GAME_DEBUG__);
  await research(page, "organization"); await fund(page, 2);
  const before = await snapshot(page);
  const resource = before.tiles.find(tile => getHarvestReason(before, before.activePlayerId, tile) === null)!;
  await inspect(page, resource); await page.getByRole("button", { name: /^Harvest/ }).click();
  const after = await snapshot(page);
  expect(after.players[0].resources.gold).toBe(before.players[0].resources.gold - 2);
  expect(after.tiles.find(tile => tile.x === resource.x && tile.y === resource.y)?.resource).toBeUndefined();
  expect(after.cities.reduce((sum, city) => sum + (city.population ?? 0), 0)).toBe(1);
  await expect(page.getByRole("button", { name: /^Harvest/ })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("harvested-population.png") });
});
