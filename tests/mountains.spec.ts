import { expect, test } from "@playwright/test";
import "../apps/web/src/debug";

test("mountain mines require Mining and show one-time Gold rewards on a 30x30 board", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.waitForFunction(() => !!window.__GAME_DEBUG__);
  await page.evaluate(() => window.__GAME_DEBUG__!.setWorld("fern-104", 8));
  let target;
  for (let i = 0; i < 8; i++) {
    target = await page.evaluate(() => {
    const debug = window.__GAME_DEBUG__!;
    const state = debug.getState();
    const claims = debug.getTerritory();
    const city = state.cities.find(city => city.ownerId && state.tiles.some(tile => tile.terrain === "mountain" && claims.some(claim => claim.x === tile.x && claim.y === tile.y && claim.cityId === city.id)))!;
    const tile = state.tiles.find(tile => tile.terrain === "mountain" && claims.some(claim => claim.x === tile.x && claim.y === tile.y && claim.cityId === city.id))!;
    if (!city || !tile) return null;
    const unit = state.units.find(unit => unit.ownerId === city.ownerId)!;
    return { city, tile, unit };
  });
    if (target) break;
    await page.getByRole("button", { name: "End Turn", exact: true }).click();
  }
  expect(target).toBeTruthy();
  if (!target) throw new Error("No visible mountain found");
  while (await page.evaluate(() => window.__GAME_DEBUG__!.getState().activePlayerId) !== target.city.ownerId) await page.getByRole("button", { name: "End Turn", exact: true }).click();
  const unitPoint = await page.evaluate(unit => window.__GAME_DEBUG__!.getUnitScreenPosition(unit.id), target.unit);
  await page.mouse.click(unitPoint.x, unitPoint.y);
  await page.getByRole("button", { name: "Inspect resources", exact: true }).click();
  const point = await page.evaluate(tile => window.__GAME_DEBUG__!.getTileScreenPosition(tile.x, tile.y), target.tile);
  await page.mouse.click(point.x, point.y);
  const panel = page.getByRole("region", { name: "Resource tile", exact: true });
  await expect(panel.getByRole("heading")).toHaveText("Mine");
  await expect(panel).toContainText("+3 Gold once");
  await expect(panel).toContainText("Available");
  await expect(panel).toContainText("Requires Mining");
  await expect(panel.getByRole("button", { name: /Civilian/ })).toHaveCount(0);
  await expect(page.getByTestId("available-population")).toHaveText("2");
  expect(await page.evaluate(() => window.__GAME_DEBUG__!.getResourceRenderStats().developed)).toBe(0);
  expect(await page.evaluate(id => window.__GAME_DEBUG__!.getReachableTiles(id), target.unit.id)).not.toContainEqual(expect.objectContaining({ x: target.tile.x, y: target.tile.y }));
  await page.screenshot({ path: testInfo.outputPath("automatic-mountain-mine.png") });
});
