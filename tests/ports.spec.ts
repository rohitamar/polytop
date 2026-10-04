import { expect, test, type Page } from "@playwright/test";
import { getPortBuildingReason, getReachableTiles, getTile, type Position } from "../packages/game-core/src/index";
import "../apps/web/src/debug";

const snapshot = (page: Page) => page.evaluate(() => window.__GAME_DEBUG__!.getState());
async function tile(page: Page, position: Position) {
  const point = await page.evaluate(p => window.__GAME_DEBUG__!.getTileScreenPosition(p.x, p.y), position);
  await page.mouse.click(point.x, point.y);
}
async function round(page: Page) {
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "End Turn", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__GAME_DEBUG__!.isAnimating())).toBe(false);
  }
}

test("starting territory provides highlighted Port sites and permits embarkation without capturing a city", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.waitForFunction(() => !!window.__GAME_DEBUG__);
  const initial = await snapshot(page);
  const home = initial.cities.find(city => city.id === initial.units[0].homeCityId)!;
  for (let i = 0; i < 5; i++) await round(page);
  await page.getByRole("button", { name: "Technologies", exact: true }).click();
  await page.getByRole("button", { name: /^Fishing: / }).click();
  await page.getByRole("button", { name: "Research Fishing", exact: true }).click();
  await page.getByRole("button", { name: "Close technologies" }).click();
  await page.getByRole("button", { name: "Build Ports", exact: true }).click();
  let state = await snapshot(page);
  const sites = state.tiles.filter(tile => getPortBuildingReason(state, state.activePlayerId, tile) === null);
  expect(sites.length).toBeGreaterThan(0);
  const site = sites.find(tile => Math.abs(tile.x - home.x) + Math.abs(tile.y - home.y) <= 2)!;
  expect(site).toBeDefined();
  await expect.poll(() => page.evaluate(() => window.__GAME_DEBUG__!.getPortMarkerCount())).toBe(sites.length);
  const panel = page.getByRole("region", { name: "Build Port", exact: true });
  await expect(panel).toContainText("highlighted in gold");
  await tile(page, home);
  await expect(panel.getByRole("button", { name: "Build Port", exact: false })).toBeDisabled();
  await tile(page, site);
  await expect(panel.getByRole("button", { name: "Build Port", exact: false })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("starting-coast-port-sites.png") });
  await panel.getByRole("button", { name: "Build Port", exact: false }).click();
  expect(getTile(await snapshot(page), site.x, site.y)?.port).toBe(true);
  await page.getByRole("button", { name: "Cancel ports" }).click();
  await expect.poll(() => page.evaluate(() => window.__GAME_DEBUG__!.getPortMarkerCount())).toBe(0);
  for (let step = 0; step < 3; step++) {
    state = await snapshot(page);
    const unit = state.units[0];
    if (unit.embarked) break;
    const destination = getReachableTiles(state, unit.id).sort((a, b) => (Math.abs(a.x - site.x) + Math.abs(a.y - site.y)) - (Math.abs(b.x - site.x) + Math.abs(b.y - site.y)))[0];
    expect(destination).toBeDefined();
    const point = await page.evaluate(id => window.__GAME_DEBUG__!.getUnitScreenPosition(id), unit.id);
    await page.mouse.click(point.x, point.y);
    await tile(page, destination);
    await expect.poll(() => page.evaluate(() => window.__GAME_DEBUG__!.isAnimating())).toBe(false);
    if (!(await snapshot(page)).units[0].embarked) await round(page);
  }
  state = await snapshot(page);
  expect(state.units[0]).toMatchObject({ embarked: true, x: site.x, y: site.y });
  expect(state.cities.filter(city => city.ownerId === initial.players[0].id)).toHaveLength(1);
  await page.screenshot({ path: testInfo.outputPath("starting-coast-embarked.png") });
});
