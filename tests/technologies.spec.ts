import { expect, test, type Page } from "@playwright/test";

const snapshot = (page: Page) => page.evaluate(() => window.__GAME_DEBUG__!.getState());
async function settled(page: Page, revision: number) {
  await expect.poll(async () => (await snapshot(page)).revision).toBe(revision);
  await expect(page.getByRole("button", { name: "End Turn", exact: true })).toBeEnabled();
}

test("technology purchases synchronize separate player unlocks through real controls", async ({ browser, page }) => {
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
    for (const client of [page, guest]) {
      await expect(client.getByTestId("active-player")).toContainText("Fern");
      await client.getByRole("button", { name: "Technologies", exact: true }).click();
    }
    const panelBounds = (await page.getByRole("region", { name: "Technologies", exact: true }).boundingBox())!;
    const unitBounds = (await page.getByRole("button", { name: "End Turn", exact: true }).boundingBox())!;
    expect(panelBounds.y + panelBounds.height).toBeLessThan(unitBounds.y);
    const archery = page.getByRole("article", { name: "Archery", exact: true });
    await expect(archery.getByRole("button")).toBeDisabled();
    await expect(guest.getByRole("article", { name: "Archery", exact: true })).toContainText("Not your turn");
    await page.getByRole("button", { name: "End Turn", exact: true }).click();
    await settled(guest, 1);
    await guest.getByRole("button", { name: "End Turn", exact: true }).click();
    await settled(page, 2);
    await page.getByRole("button", { name: "End Turn", exact: true }).click();
    await settled(guest, 3);
    await guest.getByRole("button", { name: "End Turn", exact: true }).click();
    await settled(page, 4);
    const goldBefore = (await snapshot(page)).players[0].resources.gold;
    await archery.getByRole("button", { name: "Unlock Archery" }).click();
    await settled(page, 5);
    await expect.poll(async () => (await snapshot(guest)).revision).toBe(5);
    expect((await snapshot(guest)).revision).toBe((await snapshot(page)).revision);
    expect((await snapshot(page)).players.map(player => player.technologies)).toEqual([["archery"], []]);
    expect((await snapshot(page)).players[0].resources.gold).toBe(goldBefore - 6);
    await expect(archery).toContainText("Unlocked");
    await expect(archery.getByRole("button")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Unlock Mining" })).toBeDisabled();
    await page.getByRole("button", { name: "End Turn", exact: true }).click();
    await settled(guest, 6);
    await guest.getByRole("button", { name: "Unlock Roads" }).click();
    await settled(guest, 7);
    await expect.poll(async () => (await snapshot(page)).revision).toBe(7);
    expect((await snapshot(guest)).revision).toBe((await snapshot(page)).revision);
    expect((await snapshot(page)).players.map(player => player.technologies)).toEqual([["archery"], []]);
    expect((await snapshot(guest)).players.map(player => player.technologies)).toEqual([[], ["roads"]]);
    await expect(guest.getByRole("article", { name: "Archery", exact: true })).toContainText("Locked");
    await page.screenshot({ path: "test-results/technologies-host.png" });
    await guest.screenshot({ path: "test-results/technologies-guest.png" });
    await guest.getByRole("button", { name: "End Turn", exact: true }).click();
    await settled(page, 8);
    await page.getByRole("button", { name: "Close technologies" }).click();
    const unit = await page.evaluate(() => window.__GAME_DEBUG__!.getUnitScreenPosition("warrior-1"));
    await page.mouse.click(unit.x, unit.y);
    await expect.poll(() => page.evaluate(() => window.__GAME_DEBUG__!.getSelectedUnitId())).toBe("warrior-1");
    const tile = await page.evaluate(() => window.__GAME_DEBUG__!.getTileScreenPosition(5, 5));
    await page.mouse.click(tile.x, tile.y);
    await settled(page, 9);
    await expect.poll(async () => (await snapshot(guest)).revision).toBe(9);
    expect((await snapshot(guest)).revision).toBe((await snapshot(page)).revision);
    expect((await snapshot(page)).players.map(player => player.technologies)).toEqual([["archery"], []]);
    expect((await snapshot(guest)).players.map(player => player.technologies)).toEqual([[], ["roads"]]);
  } finally {
    await context.close();
  }
});

test("local technology panel fits a narrow viewport and resets with the expedition", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Technologies", exact: true }).click();
  const panel = page.getByRole("region", { name: "Technologies", exact: true });
  await expect(panel).toBeVisible();
  const bounds = (await panel.boundingBox())!;
  const endTurn = (await page.getByRole("button", { name: "End Turn", exact: true }).boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y + bounds.height).toBeLessThan(endTurn.y);
  await page.getByRole("button", { name: "End Turn", exact: true }).click();
  await page.getByRole("button", { name: "End Turn", exact: true }).click();
  await page.getByRole("button", { name: "End Turn", exact: true }).click();
  await page.getByRole("button", { name: "End Turn", exact: true }).click();
  await page.getByRole("button", { name: "Unlock Farming" }).click();
  await expect(page.getByRole("article", { name: "Farming", exact: true })).toContainText("Unlocked");
  await page.screenshot({ path: "test-results/technologies-mobile.png" });
  await page.getByRole("button", { name: "Close technologies" }).click();
  await page.getByRole("button", { name: "Restart expedition" }).click();
  expect((await snapshot(page)).players.every(player => player.technologies.length === 0)).toBe(true);
});
