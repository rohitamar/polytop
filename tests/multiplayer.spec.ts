import { expect, test, type Page } from "@playwright/test";

const snapshot = (page: Page) => page.evaluate(() => window.__GAME_DEBUG__!.getState());
async function settled(page: Page, revision: number) {
  await expect.poll(async () => (await snapshot(page)).revision).toBe(revision);
  await expect.poll(() => page.evaluate(() => window.__GAME_DEBUG__!.isAnimating()), { timeout: 10000 }).toBe(false);
}
async function move(page: Page, unitId: string, x: number, y: number) {
  const unit = await page.evaluate(id => window.__GAME_DEBUG__!.getUnitScreenPosition(id), unitId);
  await page.mouse.click(unit.x, unit.y);
  await expect.poll(() => page.evaluate(() => window.__GAME_DEBUG__!.getSelectedUnitId())).toBe(unitId);
  const tile = await page.evaluate(({ x, y }) => window.__GAME_DEBUG__!.getTileScreenPosition(x, y), { x, y });
  await page.mouse.click(tile.x, tile.y);
}

test("independent browsers play one authoritative match including economy and combat", async ({ browser, page }) => {
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
    for (const client of [page, guest]) await expect(client.getByTestId("active-player")).toContainText("Fern");
    const hostView = await snapshot(page), guestView = await snapshot(guest);
    expect(guestView.revision).toBe(hostView.revision);
    expect(guestView.perspectiveId).not.toBe(hostView.perspectiveId);
    expect(Object.keys(hostView.exploration!)).toEqual([hostView.perspectiveId]);
    expect(Object.keys(guestView.exploration!)).toEqual([guestView.perspectiveId]);
    await expect(guest.getByRole("button", { name: "End Turn", exact: true })).toBeDisabled();
    const neutralTerritory = await page.evaluate(() => window.__GAME_DEBUG__!.getTerritory().filter(tile => tile.cityId === "neutral-1"));
    await move(page, "warrior-1", 5, 5);
    for (const client of [page, guest]) await settled(client, 1);
    expect((await snapshot(guest)).revision).toBe((await snapshot(page)).revision);
    const territory = await page.evaluate(() => window.__GAME_DEBUG__!.getTerritory());
    expect(await guest.evaluate(() => window.__GAME_DEBUG__!.getTerritory())).not.toEqual(territory);
    const ownerId = (await snapshot(page)).players[0].id;
    for (const tile of neutralTerritory) expect(territory.find(candidate => candidate.x === tile.x && candidate.y === tile.y)?.playerId).toBe(ownerId);
    const cityPosition = await page.evaluate(() => window.__GAME_DEBUG__!.getTileScreenPosition(4, 5));
    await page.mouse.click(cityPosition.x, cityPosition.y);
    const work = await page.evaluate(() => {
      const debug = window.__GAME_DEBUG__!;
      return debug.getState().tiles.find(tile => tile.resource && debug.getTileTerritory(tile.x, tile.y)?.cityId === "city-1")!;
    });
    const resource = await page.evaluate(tile => window.__GAME_DEBUG__!.getTileScreenPosition(tile.x, tile.y), work);
    await page.mouse.click(resource.x, resource.y);
    await expect(page.getByRole("region", { name: "Resource tile", exact: true })).toContainText("Gold once");
    await expect(page.getByRole("button", { name: "Assign Civilian", exact: true })).toHaveCount(0);
    const goldBefore = (await snapshot(page)).players[0].resources.gold;
    await page.getByRole("button", { name: "End Turn", exact: true }).click();
    for (const client of [page, guest]) {
      await settled(client, 2);
      await expect(client.getByTestId("active-player")).toContainText("Moss");
    }
    await move(guest, "warrior-2", 7, 4);
    for (const client of [page, guest]) await settled(client, 3);
    expect((await snapshot(guest)).revision).toBe((await snapshot(page)).revision);
    await guest.getByRole("button", { name: "End Turn", exact: true }).click();
    for (const client of [page, guest]) await settled(client, 4);
    expect((await snapshot(page)).players[0].resources.gold).toBeGreaterThan(goldBefore);
    await move(page, "warrior-1", 6, 5);
    for (const client of [page, guest]) await settled(client, 5);
    await page.getByRole("button", { name: "End Turn", exact: true }).click();
    for (const client of [page, guest]) await settled(client, 6);
    await move(guest, "warrior-2", 7, 5);
    for (const client of [page, guest]) await settled(client, 7);
    await guest.getByRole("button", { name: "End Turn", exact: true }).click();
    for (const client of [page, guest]) await settled(client, 8);
    const attacker = await page.evaluate(() => window.__GAME_DEBUG__!.getUnitScreenPosition("warrior-1"));
    await page.mouse.click(attacker.x, attacker.y);
    const target = await page.evaluate(() => window.__GAME_DEBUG__!.getUnitScreenPosition("warrior-2"));
    await page.mouse.click(target.x, target.y);
    await page.getByRole("button", { name: "Attack", exact: true }).click();
    for (const client of [page, guest]) await settled(client, 9);
    expect((await snapshot(page)).units.some(unit => unit.hp < unit.maxHp)).toBe(true);
    expect((await snapshot(guest)).revision).toBe((await snapshot(page)).revision);
    await page.screenshot({ path: "test-results/multiplayer-host.png" });
    await guest.screenshot({ path: "test-results/multiplayer-guest.png" });
  } finally {
    await context.close();
  }
});
