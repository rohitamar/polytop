import { expect, test } from "@playwright/test";
import "../apps/web/src/debug";

test("mountain tiles can be selected, mined and unassigned on a 30x30 board", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.waitForFunction(() => !!window.__GAME_DEBUG__);
  await page.evaluate(() => window.__GAME_DEBUG__!.setWorld("fern-104", 8));
  const target = await page.evaluate(() => {
    const debug = window.__GAME_DEBUG__!;
    const state = debug.getState();
    const claims = debug.getTerritory();
    const city = state.cities.find(city => city.ownerId && state.tiles.some(tile => tile.terrain === "mountain" && claims.some(claim => claim.x === tile.x && claim.y === tile.y && claim.cityId === city.id)))!;
    const tile = state.tiles.find(tile => tile.terrain === "mountain" && claims.some(claim => claim.x === tile.x && claim.y === tile.y && claim.cityId === city.id))!;
    const unit = state.units.find(unit => unit.ownerId === city.ownerId)!;
    return { city, tile, unit };
  });
  while (await page.evaluate(() => window.__GAME_DEBUG__!.getState().activePlayerId) !== target.city.ownerId) await page.getByRole("button", { name: "End Turn", exact: true }).click();
  const unitPoint = await page.evaluate(unit => window.__GAME_DEBUG__!.getUnitScreenPosition(unit.id), target.unit);
  await page.mouse.click(unitPoint.x, unitPoint.y);
  await page.getByRole("button", { name: "Manage resources", exact: true }).click();
  const point = await page.evaluate(tile => window.__GAME_DEBUG__!.getTileScreenPosition(tile.x, tile.y), target.tile);
  await page.mouse.click(point.x, point.y);
  const panel = page.getByRole("region", { name: "Resource tile", exact: true });
  await expect(panel.getByRole("heading")).toHaveText("Mountain · Steel");
  await expect(panel).toContainText("+2 Steel/turn when worked");
  const materials = await page.evaluate(() => window.__GAME_DEBUG__!.getProfile().materials);
  await panel.getByRole("button", { name: "Assign Civilian", exact: true }).click();
  await expect(panel.getByRole("heading")).toHaveText("Mine");
  await expect(page.getByTestId("available-civilians")).toHaveText("1");
  expect(await page.evaluate(() => window.__GAME_DEBUG__!.getResourceRenderStats().developed)).toBe(1);
  expect(await page.evaluate(() => window.__GAME_DEBUG__!.getProfile().materials)).toBe(materials);
  await page.screenshot({ path: testInfo.outputPath("developed-mountain-mine.png") });
  await panel.getByRole("button", { name: "Unassign Civilian", exact: true }).click();
  await expect(panel.getByRole("heading")).toHaveText("Mountain · Steel");
  await expect(page.getByTestId("available-civilians")).toHaveText("2");
});
