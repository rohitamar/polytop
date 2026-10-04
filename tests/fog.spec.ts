import { expect, test, type Page } from "@playwright/test";
import "../apps/web/src/debug";

const snapshot = (page: Page) => page.evaluate(() => window.__GAME_DEBUG__!.getState());

async function move(page: Page, x: number, y: number, unitId = "warrior-1") {
  const unit = await page.evaluate(id => window.__GAME_DEBUG__!.getUnitScreenPosition(id), unitId);
  await page.mouse.click(unit.x, unit.y);
  await expect.poll(() => page.evaluate(() => window.__GAME_DEBUG__!.getSelectedUnitId())).toBe(unitId);
  const tile = await page.evaluate(position => window.__GAME_DEBUG__!.getTileScreenPosition(position.x, position.y), { x, y });
  await page.mouse.click(tile.x, tile.y);
  await expect.poll(async () => {
    const unit = (await snapshot(page)).units.find(unit => unit.id === unitId);
    return unit && { x: unit.x, y: unit.y };
  }).toEqual({ x, y });
  await expect.poll(() => page.evaluate(() => window.__GAME_DEBUG__!.isAnimating())).toBe(false);
}

test("local fog obscures hidden metadata, changes perspective and preserves exploration", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.waitForFunction(() => !!window.__GAME_DEBUG__);
  const initial = await snapshot(page);
  expect(initial.perspectiveId).toBe("player-1");
  expect(initial.units.map(unit => unit.id)).toEqual(["warrior-1"]);
  expect(initial.tiles.length).toBeLessThan(initial.width * initial.height);
  const hidden = await page.evaluate(() => window.__GAME_DEBUG__!.getTileScreenPosition(7, 3));
  await page.mouse.click(hidden.x, hidden.y);
  await expect(page.getByRole("status")).toContainText("Explore this tile");
  await expect(page.getByRole("region", { name: "Selected city" })).toHaveCount(0);
  await page.getByRole("button", { name: "End Turn", exact: true }).click();
  const guest = await snapshot(page);
  expect(guest.perspectiveId).toBe("player-2");
  expect(guest.units.map(unit => unit.id)).toEqual(["warrior-2"]);
  expect(Object.keys(guest.exploration!)).toEqual(["player-2"]);
  await page.getByRole("button", { name: "End Turn", exact: true }).click();
  for (const [x, y] of [[3, 5], [2, 5], [2, 6], [2, 7], [2, 6], [2, 5]]) {
    await move(page, x, y);
    await page.getByRole("button", { name: "End Turn", exact: true }).click();
    await page.getByRole("button", { name: "End Turn", exact: true }).click();
  }
  const explored = await snapshot(page);
  expect(explored.exploration!["player-1"].exploredTiles).toContain("2,8");
  expect(explored.exploration!["player-1"].visibleTiles).not.toContain("2,8");
  expect(explored.tiles.some(tile => tile.x === 2 && tile.y === 8)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: "test-results/fog-local.png" });
});

test("retains the stationary enemy's sighting until that enemy moves, independently for each player", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.waitForFunction(() => !!window.__GAME_DEBUG__);
  const endTurn = () => page.getByRole("button", { name: "End Turn", exact: true }).click();
  await move(page, 5, 5);
  await endTurn();
  await move(page, 7, 4, "warrior-2");
  await endTurn();
  await move(page, 6, 5);
  await endTurn();
  await move(page, 7, 5, "warrior-2");
  expect((await snapshot(page)).units.map(unit => unit.id)).toEqual(["warrior-1", "warrior-2"]);
  await endTurn();
  expect((await snapshot(page)).units.map(unit => unit.id)).toEqual(["warrior-1", "warrior-2"]);
  await endTurn();
  await move(page, 7, 6, "warrior-2");
  const second = await snapshot(page);
  expect(second.units.map(unit => unit.id)).toEqual(["warrior-2"]);
  expect(second.rememberedUnits).toEqual([expect.objectContaining({ id: "warrior-1", x: 6, y: 5 })]);
  const rememberedTile = await page.evaluate(() => window.__GAME_DEBUG__!.getTileScreenPosition(6, 5));
  await page.keyboard.press("Escape");
  await page.mouse.click(rememberedTile.x, rememberedTile.y);
  await expect(page.getByRole("status")).toContainText("Previously explored");
  expect(await page.evaluate(() => window.__GAME_DEBUG__!.getSelectedUnitId())).toBeNull();
  await expect(page.getByRole("button", { name: "Attack", exact: true })).toHaveCount(0);
  await page.screenshot({ path: "test-results/fog-remembered-enemy.png" });
  await endTurn();
  const first = await snapshot(page);
  expect(first.units.map(unit => unit.id)).toEqual(["warrior-1"]);
  expect(first.rememberedUnits).toEqual([]);
  await move(page, 5, 5);
  await endTurn();
  expect((await snapshot(page)).rememberedUnits).toEqual([]);
  expect(errors).toEqual([]);
});
