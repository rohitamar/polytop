import { expect, test } from "@playwright/test";
import { createGame, getTerritory, positionKey } from "../packages/game-core/src/index";
import { snapshot, inspect, research } from "./development-helpers";

test("Climbing reveals metal while Mining remains required to build mines", async ({ page }, info) => {
  await page.goto("/"); await page.waitForFunction(() => !!window.__GAME_DEBUG__);
  await page.evaluate(() => window.__GAME_DEBUG__!.setWorld("fern-104", 8));
  const canonical = createGame("fern-104", 8);
  const claims = getTerritory(canonical);
  const mountain = canonical.tiles.find(tile => tile.terrain === "mountain" && claims.some(claim => claim.playerId && positionKey(claim) === positionKey(tile)))!;
  const owner = claims.find(claim => positionKey(claim) === positionKey(mountain))!.playerId;
  while ((await snapshot(page)).activePlayerId !== owner) await page.getByRole("button", { name: "End Turn", exact: true }).click();
  expect((await snapshot(page)).tiles.find(tile => positionKey(tile) === positionKey(mountain))?.resource).toBeUndefined();
  await research(page, "climbing");
  expect((await snapshot(page)).tiles.find(tile => positionKey(tile) === positionKey(mountain))?.resource).toBe("mine");
  await inspect(page, mountain);
  await expect(page.getByRole("region", { name: "Develop tile" })).toContainText("Requires Mining");
  await expect(page.getByRole("button", { name: "Build Mine · 5 Gold" })).toBeDisabled();
  await page.screenshot({ path: info.outputPath("metal-discovery.png") });
});
