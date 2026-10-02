import { expect, test } from "@playwright/test";
import "../apps/web/src/debug";

test("selects, highlights and animates a legal move using actual canvas clicks", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await page.waitForFunction(() => !!window.__GAME_DEBUG__);
  await page.evaluate(() => window.__GAME_DEBUG__!.setSeed("fern-104"));
  await expect(
    page.getByRole("heading", { name: "Beyond the familiar." }),
  ).toBeVisible();
  const unitPoint = await page.evaluate(() =>
    window.__GAME_DEBUG__!.getUnitScreenPosition(),
  );
  await page.mouse.click(unitPoint.x, unitPoint.y);
  await expect
    .poll(() => page.evaluate(() => window.__GAME_DEBUG__!.getSelectedUnitId()))
    .toBe("warrior-1");
  const legal = await page.evaluate(() =>
    window.__GAME_DEBUG__!.getReachableTiles(),
  );
  await expect
    .poll(() => page.evaluate(() => window.__GAME_DEBUG__!.getMarkerCount()))
    .toBe(legal.length);
  const destination = legal.find((tile) => tile.x === 6 && tile.y === 5)!;
  expect(destination.cost).toBe(2);
  const tilePoint = await page.evaluate(
    ({ x, y }) => window.__GAME_DEBUG__!.getTileScreenPosition(x, y),
    destination,
  );
  await page.mouse.move(tilePoint.x, tilePoint.y);
  await expect
    .poll(() => page.evaluate(() => window.__GAME_DEBUG__!.getHoveredTile()))
    .toBe("6,5");
  await page.screenshot({ path: testInfo.outputPath("01-selected-map.png") });
  await page.evaluate(() => {
    const samples: {
      animating: boolean;
      x: number;
      elevation: number;
      turnLocked: boolean;
      turnNumber: number;
    }[] = [];
    (
      window as unknown as { animationSamples: typeof samples }
    ).animationSamples = samples;
    const sample = () => {
      const debug = window.__GAME_DEBUG__!;
      samples.push({
        animating: debug.isAnimating(),
        turnLocked: (
          document.querySelector(
            'button[aria-label="End Turn"]',
          ) as HTMLButtonElement
        ).disabled,
        turnNumber: debug.getTurnNumber(),
        ...debug.getVisualPosition(),
      });
      if (
        samples.length < 200 &&
        !samples.some((value) => value.animating && value.x === 6)
      )
        requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.mouse.click(tilePoint.x, tilePoint.y);
  await expect
    .poll(() => page.evaluate(() => window.__GAME_DEBUG__!.getState().revision))
    .toBe(1);
  await expect
    .poll(() => page.evaluate(() => window.__GAME_DEBUG__!.isAnimating()))
    .toBe(false);
  const samples = await page.evaluate(
    () =>
      (
        window as unknown as {
          animationSamples: {
            animating: boolean;
            x: number;
            elevation: number;
            turnLocked: boolean;
            turnNumber: number;
          }[];
        }
      ).animationSamples,
  );
  expect(
    samples.some(
      (sample) =>
        sample.animating &&
        sample.x > 4 &&
        sample.x < 6 &&
        sample.elevation > 0.14,
    ),
  ).toBe(true);
  expect(
    samples
      .filter((sample) => sample.animating)
      .every((sample) => sample.turnLocked && sample.turnNumber === 1),
  ).toBe(true);
  const state = await page.evaluate(() => window.__GAME_DEBUG__!.getState());
  expect(state.units[0]).toMatchObject({ x: 6, y: 5, movement: 0 });
  expect(
    await page.evaluate(() => window.__GAME_DEBUG__!.getVisualPosition()),
  ).toMatchObject({ x: 6, y: 5 });
  await page.screenshot({
    path: testInfo.outputPath("02-movement-complete.png"),
  });
  await testInfo.attach("Rendered island after movement", {
    path: testInfo.outputPath("02-movement-complete.png"),
    contentType: "image/png",
  });
  expect(errors).toEqual([]);
});

test("rejects blocked moves, protects debug snapshots, resets seed and supports camera controls", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForFunction(() => !!window.__GAME_DEBUG__);
  await page
    .getByRole("button", { name: "Select warrior", exact: true })
    .click();
  const before = await page.evaluate(() => window.__GAME_DEBUG__!.getState());
  const blocked =
    before.tiles.find(
      (tile) =>
        tile.x > 2 &&
        tile.x < 7 &&
        tile.y > 5 &&
        tile.y < 7 &&
        tile.terrain === "water",
    ) ?? before.tiles.find((tile) => tile.terrain === "water")!;
  const point = await page.evaluate(
    ({ x, y }) => window.__GAME_DEBUG__!.getTileScreenPosition(x, y),
    blocked,
  );
  await page.mouse.click(point.x, point.y);
  await expect(page.getByRole("status")).toContainText("Beyond your reach");
  expect(await page.evaluate(() => window.__GAME_DEBUG__!.getState())).toEqual(
    before,
  );
  await page.evaluate(() => {
    const state = window.__GAME_DEBUG__!.getState();
    state.units[0].x = 99;
  });
  expect(
    await page.evaluate(() => window.__GAME_DEBUG__!.getUnits()[0].x),
  ).toBe(4);
  const original = await page.evaluate(() =>
    window.__GAME_DEBUG__!.getTileScreenPosition(4, 5),
  );
  await page.mouse.move(720, 460);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(860, 470, { steps: 10 });
  await page.mouse.up({ button: "right" });
  await expect
    .poll(async () => {
      const changed = await page.evaluate(() =>
        window.__GAME_DEBUG__!.getTileScreenPosition(4, 5),
      );
      return Math.abs(changed.x - original.x);
    })
    .toBeGreaterThan(2);
  await page.getByRole("button", { name: "Reset camera" }).click();
  await page.getByRole("button", { name: "Restart expedition" }).click();
  expect(await page.evaluate(() => window.__GAME_DEBUG__!.getState())).toEqual(
    before,
  );
  await page.evaluate(() => window.__GAME_DEBUG__!.setSeed("new-island"));
  expect(
    await page.evaluate(() => window.__GAME_DEBUG__!.getState().seed),
  ).toBe("new-island");
});
