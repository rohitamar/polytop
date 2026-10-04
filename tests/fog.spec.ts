import { expect, test, type Page } from "@playwright/test";
import "../apps/web/src/debug";

const snapshot = (page: Page) => page.evaluate(() => window.__GAME_DEBUG__!.getState());

async function move(page: Page, x: number, y: number) {
  const unit = await page.evaluate(() => window.__GAME_DEBUG__!.getUnitScreenPosition("warrior-1"));
  await page.mouse.click(unit.x, unit.y);
  await expect.poll(() => page.evaluate(() => window.__GAME_DEBUG__!.getSelectedUnitId())).toBe("warrior-1");
  const tile = await page.evaluate(position => window.__GAME_DEBUG__!.getTileScreenPosition(position.x, position.y), { x, y });
  await page.mouse.click(tile.x, tile.y);
  await expect.poll(async () => (await snapshot(page)).units.find(unit => unit.id === "warrior-1")?.x).toBe(x);
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
