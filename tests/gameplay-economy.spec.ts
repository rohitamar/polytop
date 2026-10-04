import { expect, test, type Page } from "@playwright/test";
import { createGame, gridDistance, getTechnologyCost, canUnitEnterTerrain, getReachableTiles, getTile, movementCost, positionKey, type GameState, type Position } from "../packages/game-core/src/index";
import "../apps/web/src/debug";

const snapshot = (page: Page) => page.evaluate(() => window.__GAME_DEBUG__!.getState());
async function settled(page: Page, revision?: number) {
  if (revision !== undefined) await expect.poll(async () => (await snapshot(page)).revision).toBe(revision);
  await expect.poll(() => page.evaluate(() => window.__GAME_DEBUG__!.isAnimating())).toBe(false);
}
async function tile(page: Page, position: Position) {
  const point = await page.evaluate(p => window.__GAME_DEBUG__!.getTileScreenPosition(p.x, p.y), position);
  await page.mouse.click(point.x, point.y);
}
async function move(page: Page, id: string, position: Position) {
  const before = await snapshot(page);
  const point = await page.evaluate(id => window.__GAME_DEBUG__!.getUnitScreenPosition(id), id);
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => page.evaluate(() => window.__GAME_DEBUG__!.getSelectedUnitId())).toBe(id);
  await tile(page, position);
  await settled(page, before.revision + 1);
}
async function round(page: Page) {
  for (let i = 0; i < 2; i++) {
    const revision = (await snapshot(page)).revision;
    await page.getByRole("button", { name: "End Turn", exact: true }).click();
    await settled(page, revision + 1);
  }
}
function distances(state: GameState, unitId: string, target: Position) {
  const unit = state.units.find(unit => unit.id === unitId)!;
  const result = new Map([[positionKey(target), 0]]);
  const pending = [{ ...target, cost: 0 }];
  while (pending.length) {
    pending.sort((a, b) => a.cost - b.cost);
    const current = pending.shift()!;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const tile = getTile(state, current.x + dx, current.y + dy);
      if (!tile || !canUnitEnterTerrain(state, unit.ownerId, unit, tile.terrain) || state.units.some(other => other.id !== unitId && positionKey(other) === positionKey(tile))) continue;
      const cost = current.cost + movementCost[getTile(state, current.x, current.y)!.terrain];
      if (cost >= (result.get(positionKey(tile)) ?? Infinity)) continue;
      result.set(positionKey(tile), cost);
      pending.push({ ...tile, cost });
    }
  }
  return result;
}
async function travel(page: Page, id: string, target: Position, map?: GameState["tiles"]) {
  for (let i = 0; i < 45; i++) {
    const state = await snapshot(page);
    const unit = state.units.find(unit => unit.id === id)!;
    if (positionKey(unit) === positionKey(target)) return;
    const planning = map ? { ...state, tiles: map, perspectiveId: undefined } : state;
    const distance = distances(planning, id, target);
    const next = getReachableTiles(planning, id).sort((a, b) => (distance.get(positionKey(a)) ?? Infinity) - (distance.get(positionKey(b)) ?? Infinity))[0];
    if (!next || (distance.get(positionKey(next)) ?? Infinity) >= (distance.get(positionKey(unit)) ?? Infinity)) { await round(page); continue; }
    await move(page, id, next);
  }
  throw new Error("Could not reach target");
}

test("Climbing and Mining enable independent mountain access and one-time Gold collection", async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.goto("/");
  await page.waitForFunction(() => !!window.__GAME_DEBUG__);
  await round(page);
  await round(page);
  await page.getByRole("button", { name: "Technologies", exact: true }).click();
  await page.getByRole("button", { name: /^Mining: / }).click();
  await expect(page.getByRole("region", { name: "Technology details" })).toContainText("Requires Climbing");
  await page.getByRole("button", { name: /^Climbing: / }).click();
  await page.getByRole("button", { name: "Research Climbing", exact: true }).click();
  await page.getByRole("button", { name: "Close technologies" }).click();
  await move(page, "warrior-1", { x: 3, y: 5 });
  await round(page);
  await move(page, "warrior-1", { x: 3, y: 6 });
  await round(page);
  let state = await snapshot(page);
  const target = state.tiles.filter(tile => tile.resource === "mine").sort((a, b) => (distances(state, "warrior-1", a).get(positionKey(state.units[0])) ?? Infinity) - (distances(state, "warrior-1", b).get(positionKey(state.units[0])) ?? Infinity))[0];
  await travel(page, "warrior-1", target);
  state = await snapshot(page);
  expect(getTile(state, target.x, target.y)!.resource).toBe("mine");
  expect(state.players[0].technologies).toEqual(["climbing"]);
  while ((await snapshot(page)).players[0].resources.gold < getTechnologyCost(await snapshot(page), "player-1", "mining")) await round(page);
  const before = await snapshot(page);
  await page.getByRole("button", { name: "Technologies", exact: true }).click();
  await page.getByRole("button", { name: /^Mining: / }).click();
  await page.getByRole("button", { name: "Research Mining", exact: true }).click();
  const next = await snapshot(page);
  expect(getTile(next, target.x, target.y)!.resource).toBeUndefined();
  expect(next.players[0].resources.gold).toBe(before.players[0].resources.gold - getTechnologyCost(before, "player-1", "mining") + 3);
  expect(next.players[1].technologies).toEqual([]);
  await page.getByRole("button", { name: "Close technologies" }).click();
  await expect(page.getByRole("status")).toContainText("+3 Gold");
  await page.screenshot({ path: testInfo.outputPath("mining-collection.png") });
});

test("Fishing builds Ports and existing units embark, sail and land", async ({ page }, testInfo) => {
  test.setTimeout(180000);
  await page.goto("/");
  await page.waitForFunction(() => !!window.__GAME_DEBUG__);
  let state = await snapshot(page);
  const canonical = createGame("fern-104", 2, { scenario: "demo" });
  const city = canonical.cities.find(city => city.id === "neutral-2")!;
  await travel(page, "warrior-1", city, canonical.tiles);
  while ((await snapshot(page)).players[0].resources.gold < getTechnologyCost(await snapshot(page), "player-1", "fishing") + 7) await round(page);
  await page.getByRole("button", { name: "Technologies", exact: true }).click();
  await page.getByRole("button", { name: /^Fishing: / }).click();
  await page.getByRole("button", { name: "Research Fishing", exact: true }).click();
  await page.getByRole("button", { name: "Close technologies" }).click();
  state = await snapshot(page);
  const water = state.tiles.find(tile => tile.terrain === "water" && gridDistance(tile, city) === 1)!;
  await page.getByRole("button", { name: "Build Ports", exact: true }).click();
  const panel = page.getByRole("region", { name: "Build Port", exact: true });
  await tile(page, city);
  await expect(panel).toContainText("Ports require Water");
  await expect(panel.getByRole("button", { name: "Build Port · 7 Gold" })).toBeDisabled();
  await tile(page, water);
  await page.screenshot({ path: testInfo.outputPath("port-construction.png") });
  const before = await snapshot(page);
  await panel.getByRole("button", { name: "Build Port · 7 Gold" }).click();
  state = await snapshot(page);
  expect(getTile(state, water.x, water.y)?.port).toBe(true);
  expect(state.players[0].resources.gold).toBe(before.players[0].resources.gold - 7);
  await page.getByRole("button", { name: "Cancel ports" }).click();
  await round(page);
  await move(page, "warrior-1", water);
  state = await snapshot(page);
  expect(state.units[0]).toMatchObject({ unitType: "warrior", embarked: true, movement: 0, hasAttacked: true });
  await page.screenshot({ path: testInfo.outputPath("port-embarked.png") });
  await round(page);
  state = await snapshot(page);
  const destination = getReachableTiles(state, "warrior-1").find(tile => getTile(state, tile.x, tile.y)?.terrain === "water" && tile.path.length >= 1)!;
  expect(destination).toBeDefined();
  await move(page, "warrior-1", destination);
  await round(page);
  state = await snapshot(page);
  const landing = getReachableTiles(state, "warrior-1").find(tile => getTile(state, tile.x, tile.y)?.terrain === "grass")!;
  expect(landing).toBeDefined();
  const hp = state.units[0].hp;
  await move(page, "warrior-1", landing);
  expect((await snapshot(page)).units[0]).toMatchObject({ unitType: "warrior", embarked: false, hp, movement: 0, hasAttacked: true });
  await page.screenshot({ path: testInfo.outputPath("raft-landed.png") });
});

test("resource depletion and technology ownership survive multiplayer reload without duplicate income", async ({ page, browser }, testInfo) => {
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
    await expect(guest.getByTestId("active-player")).toContainText("Fern");
    await move(page, "warrior-1", { x: 4, y: 4 });
    await settled(guest, 1);
    await page.getByRole("button", { name: "End Turn", exact: true }).click();
    await settled(guest, 2);
    await guest.getByRole("button", { name: "End Turn", exact: true }).click();
    await settled(page, 3);
    const before = await snapshot(page);
    await move(page, "warrior-1", { x: 4, y: 3 });
    await settled(guest, 4);
    expect((await snapshot(page)).players[0].resources.gold).toBe(before.players[0].resources.gold + 2);
    expect((await snapshot(page)).players[1].resources).toEqual(before.players[1].resources);
    expect(getTile(await snapshot(guest), 4, 3)?.resource).toBeUndefined();
    await page.getByRole("button", { name: "Technologies", exact: true }).click();
    await page.getByRole("button", { name: /^Climbing: / }).click();
    await page.getByRole("button", { name: "Research Climbing", exact: true }).click();
    await settled(page, 5);
    await settled(guest, 5);
    const saved = await snapshot(page);
    expect(saved.players[0].technologies).toEqual(["climbing"]);
    expect(saved.players[1].technologies).toEqual([]);
    await page.reload();
    await expect.poll(async () => (await snapshot(page)).revision).toBe(saved.revision);
    await expect(page.getByTestId("active-player")).toContainText("Fern");
    expect(await snapshot(page)).toEqual(saved);
    expect((await snapshot(guest)).revision).toBe(saved.revision);
    await page.getByRole("button", { name: "Technologies", exact: true }).click();
    await expect(page.getByRole("button", { name: "Climbing: Researched", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close technologies" }).click();
    await page.getByRole("button", { name: "End Turn", exact: true }).click();
    await settled(guest, 6);
    expect((await snapshot(guest)).players[0].resources.gold).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("resumed-economy.png") });
  } finally { await context.close(); }
});


test("Port construction fits a narrow viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.waitForFunction(() => !!window.__GAME_DEBUG__);
  await round(page);
  await round(page);
  await page.getByRole("button", { name: "Technologies", exact: true }).click();
  await page.getByRole("button", { name: /^Fishing: / }).click();
  await page.getByRole("button", { name: "Research Fishing", exact: true }).click();
  await page.getByRole("button", { name: "Close technologies" }).click();
  await page.getByRole("button", { name: "Build Ports", exact: true }).click();
  const panel = page.getByRole("region", { name: "Build Port", exact: true });
  await expect(panel).toContainText("Embarking and landing end its turn");
  const bounds = (await panel.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y + bounds.height).toBeLessThan((await page.getByRole("button", { name: "End Turn", exact: true }).boundingBox())!.y);
  await page.screenshot({ path: testInfo.outputPath("ports-mobile.png") });
});
