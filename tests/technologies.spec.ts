import { expect, test, type Page } from "@playwright/test";
import { getTechnologyCost } from "../packages/game-core/src/index";
import "../apps/web/src/debug";

const snapshot = (page: Page) => page.evaluate(() => window.__GAME_DEBUG__!.getState());
const node = (page: Page, name: string) => page.getByRole("button", { name: new RegExp(`^${name}: `) });
const modal = (page: Page) => page.getByRole("dialog", { name: "Technologies", exact: true });
const details = (page: Page) => page.getByRole("region", { name: "Technology details" });

async function research(page: Page, name: string) {
  await node(page, name).click();
  await page.getByRole("button", { name: `Research ${name}`, exact: true }).click();
}

test("modal research validates prerequisites, synchronizes multiplayer and survives reconnect", async ({ browser, page }, testInfo) => {
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
    for (const client of [page, guest]) {
      await expect(client.getByTestId("active-player")).toContainText("Fern");
      const before = await snapshot(client);
      await client.getByRole("button", { name: "Technologies", exact: true }).click();
      await expect(modal(client)).toBeVisible();
      const connectors = client.locator(".technology-tree svg");
      expect((await connectors.boundingBox())!.width).toBeGreaterThan(800);
      await expect(connectors.locator("line")).toHaveCount(11);
      await expect(node(client, "Archery")).toHaveAccessibleName("Archery: Locked");
      await expect(node(client, "Sailing")).toHaveAccessibleName("Sailing: Locked");
      await node(client, "Archery").click();
      await expect(details(client)).toContainText(client === page ? "Requires Hunting" : "Not your turn");
      await expect(client.getByRole("button", { name: "Research Archery" })).toBeDisabled();
      await node(client, "Farming").click();
      await expect(node(client, "Farming")).toHaveAccessibleName("Farming: Locked");
      await expect(details(client)).toContainText(client === page ? "Requires Organization" : "Not your turn");
      await expect(client.getByRole("button", { name: "Research Farming" })).toBeDisabled();
      await client.getByRole("button", { name: "Close technologies" }).click();
      expect(await snapshot(client)).toEqual(before);
    }
    const synced = async (revision: number) => {
      for (const client of [page, guest]) await expect.poll(async () => (await snapshot(client)).revision).toBe(revision);
    };
    while ((await snapshot(page)).players[0].resources.gold < 17) {
      for (const client of [page, guest]) {
        const revision = (await snapshot(page)).revision;
        await client.getByRole("button", { name: "End Turn", exact: true }).click();
        await synced(revision + 1);
      }
    }
    await page.getByRole("button", { name: "Technologies", exact: true }).click();
    const before = await snapshot(page);
    await research(page, "Hunting");
    await synced(before.revision + 1);
    await expect(node(page, "Hunting")).toHaveAccessibleName("Hunting: Researched");
    await expect(node(page, "Archery")).toHaveAccessibleName("Archery: Available");
    expect((await snapshot(page)).players[0].resources.gold).toBe(before.players[0].resources.gold - getTechnologyCost(before, before.players[0].id, "hunting"));
    await research(page, "Archery");
    await synced(before.revision + 2);
    await expect(details(page)).toContainText("Already researched");
    await expect(page.getByRole("button", { name: "Research Archery" })).toHaveCount(0);
    for (const removed of ["Aquatism", "Construction", "Diplomacy", "Spiritualism"]) await expect(node(page, removed)).toHaveCount(0);
    await research(page, "Fishing");
    await synced(before.revision + 3);
    await expect(node(page, "Sailing")).toHaveAccessibleName("Sailing: Locked");
    const saved = await snapshot(page);
    expect(saved.players[0].technologies).toEqual(["hunting", "archery", "fishing"]);
    expect(saved.players[0].resources.gold).toBe(before.players[0].resources.gold - 16);
    expect((await snapshot(guest)).players[0].technologies).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("technology-tree-desktop.png") });
    await page.reload();
    await expect.poll(async () => (await snapshot(page)).revision).toBe(saved.revision);
    expect(await snapshot(page)).toEqual(saved);
    await page.getByRole("button", { name: "Technologies", exact: true }).click();
    await expect(node(page, "Archery")).toHaveAccessibleName("Archery: Researched");
    await expect(node(page, "Sailing")).toHaveAccessibleName("Sailing: Locked");
    await page.getByRole("button", { name: "Close technologies" }).click();
    await page.getByRole("button", { name: "End Turn", exact: true }).click();
    await synced(saved.revision + 1);
    await guest.getByRole("button", { name: "Technologies", exact: true }).click();
    await research(guest, "Fishing");
    await synced(saved.revision + 2);
    expect((await snapshot(guest)).players[1].technologies).toEqual(["fishing"]);
    await expect(node(guest, "Sailing")).toHaveAccessibleName("Sailing: Available");
    await guest.screenshot({ path: testInfo.outputPath("technology-tree-guest.png") });
  } finally { await context.close(); }
});

test("modal contains focus, scrolls on mobile and closes without changing board state", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.waitForFunction(() => !!window.__GAME_DEBUG__);
  const before = await snapshot(page);
  await page.getByRole("button", { name: "Technologies", exact: true }).click();
  const bounds = (await modal(page).boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  await expect(page.getByRole("button", { name: "Close technologies" })).toBeFocused();
  await node(page, "Archery").click();
  await expect(details(page)).toContainText("Requires Hunting");
  await node(page, "Navigation").click();
  await expect(details(page)).toContainText("Requires Sailing");
  await expect(page.getByRole("button", { name: "Research Navigation" })).toBeDisabled();
  await node(page, "Hunting").click();
  await expect(details(page)).toContainText("Available");
  await page.screenshot({ path: testInfo.outputPath("technology-tree-mobile.png") });
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.closest("dialog") !== null)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(modal(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Technologies", exact: true })).toBeFocused();
  expect(await snapshot(page)).toEqual(before);
});
