import { expect, test, type Page } from "@playwright/test";
import "../apps/web/src/debug";

async function unit(page: Page, id: string) {
  const point = await page.evaluate(
    (id) => window.__GAME_DEBUG__!.getUnitScreenPosition(id),
    id,
  );
  await page.mouse.click(point.x, point.y);
}
async function tile(page: Page, x: number, y: number) {
  const point = await page.evaluate(
    ({ x, y }) => window.__GAME_DEBUG__!.getTileScreenPosition(x, y),
    { x, y },
  );
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(() => page.evaluate(() => window.__GAME_DEBUG__!.isAnimating()))
    .toBe(false);
}

test("two players preview, attack, retaliate and finish a duel through pointer controls", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.waitForFunction(() => !!window.__GAME_DEBUG__);
  await page.evaluate(() => window.__GAME_DEBUG__!.setSeed("fern-104"));
  await unit(page, "warrior-1");
  await tile(page, 6, 5);
  await page.getByRole("button", { name: "End Turn", exact: true }).click();
  await unit(page, "warrior-2");
  await tile(page, 7, 5);
  await unit(page, "warrior-1");
  const preview = page.getByRole("region", { name: "Combat preview" });
  await expect(preview).toContainText("You: 10 → 7");
  await expect(preview).toContainText("Enemy: 10 → 5");
  const before = await page.evaluate(() => window.__GAME_DEBUG__!.getState());
  await preview.getByRole("button", { name: "Cancel" }).click();
  expect(await page.evaluate(() => window.__GAME_DEBUG__!.getState())).toEqual(
    before,
  );
  await unit(page, "warrior-1");
  await page.screenshot({ path: testInfo.outputPath("combat-preview.png") });
  await page.evaluate(() => {
    const samples: {
      animating: boolean;
      endDisabled: boolean;
      restartDisabled: boolean;
    }[] = [];
    (window as unknown as { combatSamples: typeof samples }).combatSamples =
      samples;
    const sample = () => {
      samples.push({
        animating: window.__GAME_DEBUG__!.isAnimating(),
        endDisabled: (
          document.querySelector(
            'button[aria-label="End Turn"]',
          ) as HTMLButtonElement
        ).disabled,
        restartDisabled: (
          document.querySelector(
            "button.restart-expedition",
          ) as HTMLButtonElement
        ).disabled,
      });
      if (
        samples.length < 200 &&
        !(
          samples.some((sample) => sample.animating) &&
          !samples.at(-1)!.animating
        )
      )
        requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.getByRole("button", { name: "Attack", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__GAME_DEBUG__!.isAnimating()))
    .toBe(false);
  expect(
    await page.evaluate(() =>
      (
        window as unknown as {
          combatSamples: {
            animating: boolean;
            endDisabled: boolean;
            restartDisabled: boolean;
          }[];
        }
      ).combatSamples.some(
        (sample) =>
          sample.animating && sample.endDisabled && sample.restartDisabled,
      ),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() =>
      window
        .__GAME_DEBUG__!.getUnits()
        .map((unit) => [unit.hp, unit.hasAttacked]),
    ),
  ).toEqual([
    [5, false],
    [7, true],
  ]);
  await unit(page, "warrior-1");
  await expect(preview).toBeHidden();
  await page.getByRole("button", { name: "End Turn", exact: true }).click();
  await unit(page, "warrior-1");
  await unit(page, "warrior-2");
  await expect(preview).toContainText("You: 5 → 3");
  await expect(preview).toContainText("Enemy: 7 → 4");
  await page.getByRole("button", { name: "Attack", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__GAME_DEBUG__!.isAnimating()))
    .toBe(false);
  await page.getByRole("button", { name: "End Turn", exact: true }).click();
  await unit(page, "warrior-2");
  await unit(page, "warrior-1");
  await expect(preview).toContainText("You: 4 → 3");
  await expect(preview).toContainText("Enemy: 3 → 1");
  await page.getByRole("button", { name: "Attack", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__GAME_DEBUG__!.isAnimating()))
    .toBe(false);
  await page.getByRole("button", { name: "End Turn", exact: true }).click();
  await page.getByRole("button", { name: "End Turn", exact: true }).click();
  await unit(page, "warrior-2");
  await unit(page, "warrior-1");
  await expect(preview).toContainText("You: 3 → 3");
  await expect(preview).toContainText("Enemy: 1 → 0");
  await page.getByRole("button", { name: "Attack", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__GAME_DEBUG__!.isAnimating()))
    .toBe(false);
  const survivors = await page.evaluate(() =>
    window.__GAME_DEBUG__!.getUnits(),
  );
  expect(survivors).toHaveLength(1);
  expect(survivors[0]).toMatchObject({
    id: "warrior-2",
    hp: 3,
    x: 6,
    y: 5,
    hasAttacked: true,
  });
  expect(
    await page.evaluate(() => window.__GAME_DEBUG__!.getVisualPosition()),
  ).toMatchObject({ x: 6, y: 5 });
  await page.getByRole("button", { name: "End Turn", exact: true }).click();
  await expect(page.getByText("No warriors remain for Sunward.")).toBeVisible();
  await page.getByRole("button", { name: "End Turn", exact: true }).click();
  await unit(page, "warrior-2");
  await page.screenshot({ path: testInfo.outputPath("duel-finished.png") });
  await page.getByRole("button", { name: "Restart expedition" }).click();
  expect(
    await page.evaluate(() =>
      window.__GAME_DEBUG__!.getUnits().map((unit) => unit.hp),
    ),
  ).toEqual([10, 10]);
  expect(errors).toEqual([]);
});
