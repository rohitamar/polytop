import { expect, test, type Page } from "@playwright/test";
import "../apps/web/src/debug";

const snapshot = (page: Page) => page.evaluate(() => window.__GAME_DEBUG__!.getState());
async function tile(page: Page, x: number, y: number) {
  const point = await page.evaluate(({ x, y }) => window.__GAME_DEBUG__!.getTileScreenPosition(x, y), { x, y });
  await page.mouse.click(point.x, point.y);
}
async function unit(page: Page, id: string) {
  const point = await page.evaluate(id => window.__GAME_DEBUG__!.getUnitScreenPosition(id), id);
  await page.mouse.click(point.x, point.y);
}

test("recruits through synchronized city controls and activates on the next owner turn", async ({ page, browser }, testInfo) => {
  test.setTimeout(120000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const guest = await context.newPage();
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Multiplayer lobby" }).click();
    await page.getByLabel("Player name", { exact: true }).fill("Fern");
    await page.getByRole("button", { name: "Create room", exact: true }).click();
    await expect(page.getByLabel("Room code", { exact: true })).toHaveValue(/^[A-HJ-NP-Z2-9]{6}$/);
    const code = await page.getByLabel("Room code", { exact: true }).inputValue();
    await guest.goto("/");
    await guest.getByRole("button", { name: "Multiplayer lobby" }).click();
    await guest.getByLabel("Player name", { exact: true }).fill("Moss");
    await guest.getByLabel("Join with room code").fill(code);
    await guest.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(page.getByRole("button", { name: "Start game", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await expect(page.getByTestId("active-player")).toContainText("Fern");
    const settle = async (revision: number) => {
      for (const client of [page, guest]) await expect.poll(async () => (await snapshot(client)).revision).toBe(revision);
      await expect((await snapshot(page)).activePlayerId === (await snapshot(page)).players[0].id ? page.getByRole("button", { name: "End Turn", exact: true }) : guest.getByRole("button", { name: "End Turn", exact: true })).toBeEnabled();
      expect((await snapshot(guest)).revision).toBe((await snapshot(page)).revision);
    };
    await unit(page, "warrior-1");
    await tile(page, 5, 5);
    await settle(1);
    await page.getByRole("button", { name: "End Turn", exact: true }).click();
    await settle(2);
    await guest.getByRole("button", { name: "End Turn", exact: true }).click();
    await settle(3);
    await page.getByRole("button", { name: "End Turn", exact: true }).click();
    await settle(4);
    await guest.getByRole("button", { name: "End Turn", exact: true }).click();
    await settle(5);
    await page.getByRole("button", { name: "End Turn", exact: true }).click();
    await settle(6);
    await guest.getByRole("button", { name: "End Turn", exact: true }).click();
    await settle(7);
    for (let revision = 8; revision <= 11; revision++) {
      await (revision % 2 === 0 ? page : guest).getByRole("button", { name: "End Turn", exact: true }).click();
      await settle(revision);
    }
    await tile(page, 4, 5);
    await page.getByRole("button", { name: "Recruit units", exact: true }).click();
    const panel = page.getByRole("region", { name: "Recruit units", exact: true });
    await expect(panel.getByRole("article", { name: "Archer", exact: true })).toContainText("Requires Archery");
    await expect(panel.getByRole("button", { name: "Recruit Archer", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Technologies", exact: true }).click();
    await page.getByRole("button", { name: /^Hunting: / }).click();
    await page.getByRole("button", { name: "Research Hunting", exact: true }).click();
    await settle(12);
    await page.getByRole("button", { name: /^Archery: / }).click();
    await page.getByRole("button", { name: "Research Archery", exact: true }).click();
    await settle(13);
    await page.getByRole("button", { name: "Close technologies" }).click();
    await expect(panel.getByRole("button", { name: "Recruit Archer", exact: true })).toBeEnabled();
    await panel.getByRole("button", { name: "Recruit Archer", exact: true }).click();
    await settle(14);
    const state = await snapshot(page);
    const recruit = state.units.at(-1)!;
    expect(recruit).toMatchObject({ unitType: "archer", x: 4, y: 5, movement: 0, hasAttacked: true, homeCityId: "city-1" });
    expect(state.players[0].resources.gold).toBeGreaterThanOrEqual(0);
    await expect(page.getByTestId("available-population")).toHaveText("4");
    expect(await page.evaluate(id => window.__GAME_DEBUG__!.getVisualPosition(id), recruit.id)).toMatchObject({ x: 4, y: 5 });
    expect((await snapshot(guest)).units.some(unit => unit.id === recruit.id)).toBe(false);
    await unit(page, recruit.id);
    expect(await page.evaluate(id => window.__GAME_DEBUG__!.getReachableTiles(id), recruit.id)).toEqual([]);
    expect((await snapshot(page)).units.at(-1)?.unitType).toBe("archer");
    await page.screenshot({ path: testInfo.outputPath("recruited-archer.png") });
    await page.getByRole("button", { name: "End Turn", exact: true }).click();
    await settle(15);
    await guest.getByRole("button", { name: "End Turn", exact: true }).click();
    await settle(16);
    await unit(page, recruit.id);
    await tile(page, 3, 5);
    await settle(17);
    expect((await snapshot(page)).units.find(u => u.id === recruit.id)).toMatchObject({ x: 3, y: 5, movement: 0, hasAttacked: false });
  } finally {
    await context.close();
  }
});

test("recruitment costs and restrictions fit a narrow viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.waitForFunction(() => !!window.__GAME_DEBUG__);
  await unit(page, "warrior-1");
  await page.getByRole("button", { name: "Recruit units", exact: true }).click();
  const panel = page.getByRole("region", { name: "Selected city", exact: true });
  for (const name of ["Warrior", "Archer", "Rider", "Swordsman", "Defender", "Catapult"]) {
    const option = page.getByRole("article", { name, exact: true });
    await option.scrollIntoViewIfNeeded();
    await expect(option).toBeVisible();
    await expect(option.getByRole("button")).toBeDisabled();
  }
  const bounds = (await panel.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y + bounds.height).toBeLessThan((await page.getByRole("button", { name: "End Turn", exact: true }).boundingBox())!.y);
  await page.screenshot({ path: testInfo.outputPath("recruitment-mobile.png") });
});
