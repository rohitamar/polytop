import { expect, test } from "@playwright/test";
import { snapshot, tile, round, develop } from "./development-helpers";

test("population levels cities and reward choices increase income and unit slots", async ({ page }, testInfo) => {
  test.setTimeout(180000);
  await page.goto("/"); await page.waitForFunction(() => !!window.__GAME_DEBUG__);
  await tile(page, { x: 4, y: 5 });
  await expect(page.getByTestId("population")).toHaveText("1 / 2");
  await expect(page.getByTestId("town-hall")).toHaveText("Level 1");
  const initial = await snapshot(page);
  expect(initial.players[0].resources.gold).toBe(5);
  await round(page);
  expect((await snapshot(page)).players[0].resources.gold).toBe(7);
  await develop(page, "city-1", 2);
  await page.keyboard.press("Escape"); await tile(page, { x: 4, y: 5 });
  await expect(page.getByTestId("population")).toHaveText("1 / 3");
  await expect(page.getByTestId("town-hall")).toHaveText("Level 2");
  const before = await snapshot(page);
  await page.getByRole("button", { name: /^Workshop/ }).click();
  expect((await snapshot(page)).players[0].resources.gold).toBe(before.players[0].resources.gold);
  await expect(page.getByTestId("income")).toHaveText("+4/turn");
  await page.screenshot({ path: testInfo.outputPath("population-city.png") });
});
