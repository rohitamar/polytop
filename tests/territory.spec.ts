import { expect, test } from "@playwright/test";
import "../apps/web/src/debug";

test("city selection highlights its own region with bounded rendering batches", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => !!window.__GAME_DEBUG__)).toBe(true);
  const initial = await page.evaluate(() => ({ stats: window.__GAME_DEBUG__!.getTerritoryRenderStats(), materials: window.__GAME_DEBUG__!.getProfile().materials }));
  expect(initial.stats.meshes).toBe(1);
  expect(initial.stats.quads).toBeGreaterThan(0);
  const city = await page.evaluate(() => window.__GAME_DEBUG__!.getTileScreenPosition(4, 5));
  await page.mouse.click(city.x, city.y);
  await expect.poll(() => page.evaluate(() => window.__GAME_DEBUG__!.getTerritoryRenderStats().selectedCityId)).toBe("city-1");
  const selected = await page.evaluate(() => ({ stats: window.__GAME_DEBUG__!.getTerritoryRenderStats(), materials: window.__GAME_DEBUG__!.getProfile().materials, claims: window.__GAME_DEBUG__!.getTerritory().filter(tile => tile.cityId === "city-1").length }));
  expect(selected.stats.meshes).toBe(initial.stats.meshes + 1);
  expect(selected.stats.quads).toBe(initial.stats.quads + selected.claims);
  expect(selected.materials).toBe(initial.materials);
  await page.screenshot({ path: "test-results/territory-selected-city.png" });
});
