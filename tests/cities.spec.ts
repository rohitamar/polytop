import { expect, test } from "@playwright/test";
import "../apps/web/src/debug";

test("capture a city, collect income and upgrade", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.waitForFunction(() => !!window.__GAME_DEBUG__);
  await expect(page.getByTestId("stars")).toHaveText("2");
  const warrior = await page.evaluate(() =>
    window.__GAME_DEBUG__!.getUnitScreenPosition("warrior-1"),
  );
  await page.mouse.click(warrior.x, warrior.y);
  const city = await page.evaluate(() =>
    window.__GAME_DEBUG__!.getTileScreenPosition(5, 5),
  );
  await page.mouse.click(city.x, city.y);
  await expect
    .poll(() => page.evaluate(() => window.__GAME_DEBUG__!.isAnimating()))
    .toBe(false);
  expect(
    await page.evaluate(
      () =>
        window
          .__GAME_DEBUG__!.getState()
          .cities.find((city) => city.id === "neutral-1")?.ownerId,
    ),
  ).toBe("player-1");
  await expect(page.getByTestId("income")).toHaveText("+4");
  await expect(
    page.getByRole("button", { name: "Upgrade City" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "End Turn", exact: true }).click();
  await expect(page.getByTestId("stars")).toHaveText("2");
  await page.getByRole("button", { name: "End Turn", exact: true }).click();
  await expect(page.getByTestId("stars")).toHaveText("6");
  const point = await page.evaluate(() =>
    window.__GAME_DEBUG__!.getTileScreenPosition(4, 5),
  );
  await page.mouse.click(point.x, point.y);
  await page.getByRole("button", { name: "Upgrade City" }).click();
  await expect(page.getByTestId("stars")).toHaveText("2");
  await expect(page.getByTestId("income")).toHaveText("+6");
  expect(
    await page.evaluate(() => window.__GAME_DEBUG__!.getState().cities[0]),
  ).toMatchObject({ level: 2, income: 4 });
  await page.screenshot({ path: testInfo.outputPath("city-economy.png") });
});
