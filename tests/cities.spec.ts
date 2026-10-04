import { expect, test } from "@playwright/test";
import "../apps/web/src/debug";

test("automatic Gold income and Town Hall capacity use real city controls", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.waitForFunction(() => !!window.__GAME_DEBUG__);
  await page.evaluate(() => window.__GAME_DEBUG__!.setSeed("fern-104"));
  const selectCity = async () => {
    const point = await page.evaluate(() => window.__GAME_DEBUG__!.getUnitScreenPosition("warrior-1"));
    await page.mouse.click(point.x, point.y);
    await expect(page.getByTestId("population")).toBeVisible();
  };
  await selectCity();
  await expect(page.getByTestId("population")).toHaveText("1 / 3");
  await expect(page.getByTestId("player-population")).toHaveText("1 / 3");
  await expect(page.getByTestId("available-population")).toHaveText("2");
  for (const resource of ["food", "wood", "steel"]) await expect(page.getByTestId(resource)).toHaveCount(0);
  const initial = await page.evaluate(() => window.__GAME_DEBUG__!.getState());
  const income = Number((await page.getByTestId("income").innerText()).match(/\d+/)![0]);
  expect(initial.players[0].resources).toEqual({ gold: income });
  await page.screenshot({ path: testInfo.outputPath("town-center-level-1.png") });
  const turn = page.getByRole("button", { name: "End Turn", exact: true });
  await turn.click();
  expect((await page.evaluate(() => window.__GAME_DEBUG__!.getState())).players[0].resources.gold).toBe(0);
  await turn.click();
  await selectCity();
  expect((await page.evaluate(() => window.__GAME_DEBUG__!.getState())).players[0].resources.gold).toBe(income * 2);
  await page.getByRole("button", { name: "Upgrade Town Center" }).click();
  await expect(page.getByTestId("population")).toHaveText("1 / 6");
  await expect(page.getByTestId("player-population")).toHaveText("1 / 6");
  await expect(page.getByTestId("town-hall")).toHaveText("2 / 3");
  expect((await page.evaluate(() => window.__GAME_DEBUG__!.getState())).players[0].resources).toEqual({ gold: income * 2 - 4 });
  await expect(page.getByTestId("income")).toHaveText(`+${income + 1}/turn`);
  await expect(page.getByRole("button", { name: "Grow Population" })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("town-center-level-2.png") });
  for (let round = 0; round < 3; round++) { await turn.click(); await turn.click(); }
  await selectCity();
  await page.getByRole("button", { name: "Upgrade Town Center" }).click();
  await expect(page.getByTestId("town-hall")).toHaveText("3 / 3");
  await expect(page.getByTestId("population")).toHaveText("1 / 9");
  await page.screenshot({ path: testInfo.outputPath("town-center-level-3.png") });
});
