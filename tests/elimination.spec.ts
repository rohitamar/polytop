import { expect, test } from "@playwright/test";
import { createGame } from "../packages/game-core/src/index";
import { snapshot, settled, move } from "./development-helpers";

test("last-city capture shows victory and defeat, survives reload, and returns players to the lobby", async ({ page, browser }, testInfo) => {
  test.setTimeout(120000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const guest = await context.newPage();
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Multiplayer lobby" }).click();
    await page.getByLabel("Player name", { exact: true }).fill("Winner");
    await page.getByRole("button", { name: "Create room", exact: true }).click();
    await expect(page.getByLabel("Room code", { exact: true })).toHaveValue(/.{6}/);
    const code = await page.getByLabel("Room code", { exact: true }).inputValue();
    await guest.goto("/");
    await guest.getByRole("button", { name: "Multiplayer lobby" }).click();
    await guest.getByLabel("Player name", { exact: true }).fill("Defeated");
    await guest.getByLabel("Join with room code").fill(code);
    await guest.getByRole("button", { name: "Join room", exact: true }).click();
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await expect(page.getByTestId("active-player")).toContainText("Winner");
    await move(page, "warrior-1", { x: 5, y: 5 });
    await page.getByRole("button", { name: "End Turn", exact: true }).click();
    await settled(guest, 2);
    await move(guest, "warrior-2", { x: 7, y: 4 });
    await guest.getByRole("button", { name: "End Turn", exact: true }).click();
    await settled(page, 4);
    const map = createGame("fern-104", 2, { scenario: "demo" });
    const target = map.cities.find(city => city.id === "city-2")!;
    const queue = [{ x: 5, y: 5, path: [] as { x: number; y: number }[] }];
    const seen = new Set(["5,5"]);
    let path: { x: number; y: number }[] = [];
    while (queue.length) {
      const current = queue.shift()!;
      if (current.x === target.x && current.y === target.y) { path = current.path; break; }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const tile = map.tiles.find(tile => tile.x === current.x + dx && tile.y === current.y + dy);
        if (!tile || !["grass", "forest"].includes(tile.terrain) || tile.x === 7 && tile.y === 4 || seen.has(`${tile.x},${tile.y}`)) continue;
        seen.add(`${tile.x},${tile.y}`);
        queue.push({ ...tile, path: [...current.path, { x: tile.x, y: tile.y }] });
      }
    }
    expect(path.length).toBeGreaterThan(0);
    for (const destination of path) {
      await move(page, "warrior-1", destination);
      const next = await snapshot(page);
      await settled(guest, next.revision);
      if (next.outcome?.winnerId) break;
      await page.getByRole("button", { name: "End Turn", exact: true }).click();
      await settled(guest, next.revision + 1);
      await guest.getByRole("button", { name: "End Turn", exact: true }).click();
      await settled(page, next.revision + 2);
    }
    await expect(page.getByRole("heading", { name: "You won!" })).toBeVisible();
    await expect(guest.getByRole("heading", { name: "You lost" })).toBeVisible();
    expect((await snapshot(guest)).outcome).toEqual((await snapshot(page)).outcome);
    await expect(guest.getByRole("button", { name: "End Turn", exact: true })).toBeDisabled();
    await guest.reload();
    await expect(guest.getByRole("heading", { name: "You lost" })).toBeVisible();
    await guest.screenshot({ path: testInfo.outputPath("defeat.png") });
    await guest.getByRole("button", { name: "Return to lobby", exact: true }).click();
    await expect(guest.getByLabel("Player name", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "You won!" })).toBeVisible();
    await page.getByRole("button", { name: "Return to lobby", exact: true }).click();
    await expect(page.getByLabel("Player name", { exact: true })).toBeVisible();
    expect(await guest.evaluate(() => sessionStorage.getItem("polytop-session"))).toBeNull();
  } finally { await context.close(); }
});
