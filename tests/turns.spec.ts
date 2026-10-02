import { expect, test, type Page } from "@playwright/test";
import "../apps/web/src/debug";

async function clickUnit(page: Page, unitId: string) {
  const point = await page.evaluate(
    (id) => window.__GAME_DEBUG__!.getUnitScreenPosition(id),
    unitId,
  );
  await page.mouse.click(point.x, point.y);
}

async function clickTile(page: Page, x: number, y: number) {
  const point = await page.evaluate(
    ({ x, y }) => window.__GAME_DEBUG__!.getTileScreenPosition(x, y),
    { x, y },
  );
  await page.mouse.click(point.x, point.y);
}

test("two owners move on their turns, reject enemy control and regain movement", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await page.waitForFunction(() => !!window.__GAME_DEBUG__);
  await expect(page.getByTestId("active-player")).toHaveText(
    "The Sunward Company",
  );
  expect(
    await page.evaluate(() => window.__GAME_DEBUG__!.getActivePlayer().id),
  ).toBe("player-1");
  expect(
    await page.evaluate(() => window.__GAME_DEBUG__!.getTurnNumber()),
  ).toBe(1);
  await clickUnit(page, "warrior-1");
  await expect
    .poll(() => page.evaluate(() => window.__GAME_DEBUG__!.getSelectedUnitId()))
    .toBe("warrior-1");
  await clickTile(page, 6, 5);
  await expect
    .poll(() => page.evaluate(() => window.__GAME_DEBUG__!.isAnimating()))
    .toBe(false);
  expect(
    await page.evaluate(() => window.__GAME_DEBUG__!.getUnits()[0]),
  ).toMatchObject({ x: 6, y: 5, movement: 0, ownerId: "player-1" });
  await expect(
    page.getByText("Movement spent. End your turn.", { exact: true }),
  ).toBeVisible();
  const exhausted = await page.evaluate(() =>
    window.__GAME_DEBUG__!.getState(),
  );
  await clickTile(page, 5, 5);
  expect(await page.evaluate(() => window.__GAME_DEBUG__!.getState())).toEqual(
    exhausted,
  );
  await clickUnit(page, "warrior-2");
  await expect(page.getByRole("status")).toContainText(
    "Tideward's warrior is waiting",
  );
  expect(
    await page.evaluate(() => window.__GAME_DEBUG__!.getSelectedUnitId()),
  ).toBeNull();
  expect(
    await page.evaluate(() => window.__GAME_DEBUG__!.getMarkerCount()),
  ).toBe(0);
  await clickTile(page, 7, 4);
  expect(await page.evaluate(() => window.__GAME_DEBUG__!.getState())).toEqual(
    exhausted,
  );

  await page.getByRole("button", { name: "End Turn", exact: true }).click();
  await expect(page.getByTestId("active-player")).toHaveText(
    "The Tideward Company",
  );
  await expect(page.getByTestId("turn-number")).toHaveText("2");
  const second = await page.evaluate(() => window.__GAME_DEBUG__!.getState());
  expect(second.activePlayerId).toBe("player-2");
  expect(second.units.map((unit) => unit.movement)).toEqual([0, 2]);
  await clickUnit(page, "warrior-1");
  await expect(page.getByRole("status")).toContainText(
    "Sunward's warrior is waiting",
  );
  expect(
    await page.evaluate(() => window.__GAME_DEBUG__!.getSelectedUnitId()),
  ).toBeNull();
  await clickTile(page, 5, 5);
  expect(await page.evaluate(() => window.__GAME_DEBUG__!.getState())).toEqual(
    second,
  );
  await clickUnit(page, "warrior-2");
  await expect
    .poll(() => page.evaluate(() => window.__GAME_DEBUG__!.getSelectedUnitId()))
    .toBe("warrior-2");
  await expect(page.getByText("OWNER · TIDEWARD")).toBeVisible();
  expect(
    await page.evaluate(() => window.__GAME_DEBUG__!.getMarkerCount()),
  ).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath("tideward-turn.png") });
  await clickTile(page, 7, 4);
  await expect
    .poll(() => page.evaluate(() => window.__GAME_DEBUG__!.isAnimating()))
    .toBe(false);
  expect(
    await page.evaluate(() => window.__GAME_DEBUG__!.getUnits()[1]),
  ).toMatchObject({ x: 7, y: 4, movement: 1, ownerId: "player-2" });
  expect(
    await page.evaluate(() =>
      window.__GAME_DEBUG__!.getVisualPosition("warrior-2"),
    ),
  ).toMatchObject({ x: 7, y: 4 });
  await page.getByRole("button", { name: "End Turn", exact: true }).click();
  const third = await page.evaluate(() => window.__GAME_DEBUG__!.getState());
  expect(third).toMatchObject({
    activePlayerId: "player-1",
    turnNumber: 3,
    revision: 4,
  });
  expect(third.units.map((unit) => unit.movement)).toEqual([2, 1]);
  expect(
    await page.evaluate(() => window.__GAME_DEBUG__!.getSelectedUnitId()),
  ).toBeNull();
  expect(
    await page.evaluate(() => window.__GAME_DEBUG__!.getMarkerCount()),
  ).toBe(0);
  await clickUnit(page, "warrior-1");
  await clickTile(page, 5, 5);
  await expect
    .poll(() => page.evaluate(() => window.__GAME_DEBUG__!.isAnimating()))
    .toBe(false);
  expect(
    await page.evaluate(() => window.__GAME_DEBUG__!.getUnits()[0]),
  ).toMatchObject({ x: 5, y: 5, movement: 1 });
  await testInfo.attach("Tideward turn and ownership styling", {
    path: testInfo.outputPath("tideward-turn.png"),
    contentType: "image/png",
  });
  expect(errors).toEqual([]);
});
