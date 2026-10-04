import { expect, test, type Page } from "@playwright/test";
import { WebSocket } from "ws";
import { createGame, getReachableTiles, getTerritory, canUnitEnterTerrain, movementCost, positionKey, type GameState } from "../packages/game-core/src/index";
import type { LobbyServerMessage } from "../packages/protocol/src/index";
import "../apps/web/src/debug";

const snapshot = (page: Page) => page.evaluate(() => window.__GAME_DEBUG__!.getState());
async function settled(page: Page, revision: number) {
  await expect.poll(async () => (await snapshot(page)).revision).toBe(revision);
  await expect.poll(() => page.evaluate(() => window.__GAME_DEBUG__!.isAnimating())).toBe(false);
}
async function clickTile(page: Page, x: number, y: number) {
  const point = await page.evaluate(({ x, y }) => window.__GAME_DEBUG__!.getTileScreenPosition(x, y), { x, y });
  await page.mouse.click(point.x, point.y);
}

function distances(state: GameState, target: { x: number; y: number }) {
  const result = new Map([[positionKey(target), 0]]);
  const pending = [{ ...target, cost: 0 }];
  while (pending.length) {
    pending.sort((a, b) => a.cost - b.cost);
    const current = pending.shift()!;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const x = current.x + dx, y = current.y + dy;
      const tile = state.tiles.find(tile => tile.x === x && tile.y === y);
      if (!tile || !canUnitEnterTerrain(state, state.units[0].ownerId, state.units[0], tile.terrain) || state.units.some(unit => unit.id !== "warrior-1" && unit.x === x && unit.y === y)) continue;
      const cost = current.cost + movementCost[tile.terrain];
      const key = positionKey(tile);
      if (cost >= (result.get(key) ?? Infinity)) continue;
      result.set(key, cost);
      pending.push({ x, y, cost });
    }
  }
  return result;
}

test("eight-player 30x30 match sanitizes terrain, captures territory and renders borders", async ({ page, browser }, testInfo) => {
  test.setTimeout(180000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const guest = await context.newPage();
  const bots: { socket: WebSocket; state?: GameState }[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  guest.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Multiplayer lobby" }).click();
    await page.getByLabel("Player name", { exact: true }).fill("Host");
    await page.getByRole("button", { name: "Create room", exact: true }).click();
    await expect(page.getByLabel("Room code", { exact: true })).toHaveValue(/^[A-HJ-NP-Z2-9]{6}$/);
    const code = await page.getByLabel("Room code", { exact: true }).inputValue();
    await guest.goto("/");
    await guest.getByRole("button", { name: "Multiplayer lobby" }).click();
    await guest.getByLabel("Player name", { exact: true }).fill("Guest");
    await guest.getByLabel("Join with room code").fill(code);
    await guest.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(guest.getByRole("button", { name: "Leave room", exact: true })).toBeVisible();
    for (let i = 2; i < 8; i++) {
      const socket = new WebSocket(`ws://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "3001"}/lobby`);
      const bot: { socket: WebSocket; state?: GameState } = { socket };
      bots.push(bot);
      await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
      const joined = new Promise<void>(resolve => socket.once("message", () => resolve()));
      socket.on("message", data => {
        const message = JSON.parse(data.toString()) as LobbyServerMessage;
        if (message.type === "MATCH_STATE") bot.state = message.state;
      });
      socket.send(JSON.stringify({ type: "JOIN_ROOM", name: `Bot ${i}`, code }));
      await joined;
    }
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).width).toBe(30);
    await expect.poll(async () => (await snapshot(guest)).width).toBe(30);
    let state = await snapshot(page);
    expect(state.height).toBe(30);
    expect(state.tiles.length).toBeLessThan(900);
    expect(state.units).toHaveLength(1);
    expect(state.players).toHaveLength(8);
    expect((await snapshot(guest)).revision).toBe(state.revision);
    for (const bot of bots) { await expect.poll(() => bot.state?.width).toBe(30); expect(bot.state!.perspectiveId).not.toBe(state.perspectiveId); }
    const initialStats = await page.evaluate(() => window.__GAME_DEBUG__!.getTerritoryRenderStats());
    expect(initialStats.meshes).toBe(1);
    const warrior = state.units[0];
    const canonical = createGame("fern-104", 8);
    const planned = { ...state, tiles: canonical.tiles, perspectiveId: undefined };
    const target = canonical.cities.filter(city => city.ownerId === null).sort((a, b) => (distances(planned, a).get(positionKey(warrior)) ?? Infinity) - (distances(planned, b).get(positionKey(warrior)) ?? Infinity))[0];
    const before = getTerritory(canonical).filter(tile => tile.cityId === target.id);
    for (let turn = 0; turn < 30 && state.cities.find(city => city.id === target.id)?.ownerId !== state.players[0].id; turn++) {
      const planning = { ...state, tiles: canonical.tiles, perspectiveId: undefined };
      const distance = distances(planning, target);
      const next = getReachableTiles(planning, "warrior-1").sort((a, b) => (distance.get(positionKey(a)) ?? Infinity) - (distance.get(positionKey(b)) ?? Infinity))[0];
      expect(next).toBeDefined();
      const unit = state.units[0];
      await clickTile(page, unit.x, unit.y);
      await expect.poll(() => page.evaluate(() => window.__GAME_DEBUG__!.getSelectedUnitId())).toBe("warrior-1");
      await clickTile(page, next.x, next.y);
      await settled(page, state.revision + 1);
      await settled(guest, state.revision + 1);
      state = await snapshot(page);
      if (state.cities.find(city => city.id === target.id)?.ownerId === state.players[0].id) break;
      await page.getByRole("button", { name: "End Turn", exact: true }).click();
      await settled(guest, state.revision + 1);
      await guest.getByRole("button", { name: "End Turn", exact: true }).click();
      await settled(page, state.revision + 2);
      for (let i = 0; i < bots.length; i++) {
        const revision = state.revision + 2 + i;
        await expect.poll(() => bots[i].state?.revision).toBe(revision);
        bots[i].socket.send(JSON.stringify({ type: "GAME_ACTION", requestId: `turn-${turn}-${i}`, expectedRevision: revision, action: { type: "END_TURN" } }));
        await expect.poll(() => bots[i].state?.revision).toBe(revision + 1);
      }
      await settled(page, state.revision + 8);
      await settled(guest, state.revision + 8);
      state = await snapshot(page);
    }
    expect(state.cities.find(city => city.id === target.id)!.ownerId).toBe(state.players[0].id);
    const after = getTerritory(state);
    for (const tile of before) expect(after.find(claim => positionKey(claim) === positionKey(tile))?.playerId).toBe(state.players[0].id);
    expect((await snapshot(guest)).revision).toBe(state.revision);
    expect(await guest.evaluate(() => window.__GAME_DEBUG__!.getTerritory())).not.toEqual(after);
    for (const bot of bots) { await expect.poll(() => bot.state?.revision).toBe(state.revision); expect(bot.state!.perspectiveId).not.toBe(state.perspectiveId); expect(Object.keys(bot.state!.exploration!)).toEqual([bot.state!.perspectiveId]); }
    await clickTile(page, target.x, target.y);
    await page.getByRole("button", { name: "Inspect resources", exact: true }).click();
    const resource = state.tiles.find(tile => tile.resource && after.some(claim => positionKey(claim) === positionKey(tile) && claim.cityId === target.id))!;
    await clickTile(page, resource.x, resource.y);
    await expect(page.getByRole("region", { name: "Resource tile", exact: true })).toContainText("Gold once");
    await expect(page.getByRole("button", { name: "Assign Civilian", exact: true })).toHaveCount(0);
    expect((await snapshot(guest)).revision).toBe(state.revision);
    for (const bot of bots) expect(bot.state!.perspectiveId).not.toBe(state.perspectiveId);
    for (const client of [page, guest]) {
      const resources = await client.evaluate(() => window.__GAME_DEBUG__!.getResourceRenderStats());
      expect(resources.developed).toBe(0);
      expect(resources.opportunities).toBe((await snapshot(client)).tiles.filter(tile => tile.resource).length);
    }
    for (const client of [page, guest]) {
      if (client === guest) {
        await page.screenshot({ path: testInfo.outputPath("eight-player-captured-territory.png") });
        await page.getByRole("button", { name: "End Turn", exact: true }).click();
        await settled(page, state.revision + 1);
        await settled(guest, state.revision + 1);
      }
      const clientState = await snapshot(client);
      const city = clientState.cities.find(city => city.ownerId === clientState.perspectiveId)!;
      await clickTile(client, city.x, city.y);
      await expect.poll(() => client.evaluate(() => window.__GAME_DEBUG__!.getTerritoryRenderStats().selectedCityId)).toBe(city.id);
      const stats = await client.evaluate(() => window.__GAME_DEBUG__!.getTerritoryRenderStats());
      expect(stats.meshes).toBeLessThanOrEqual(10);
      expect(stats.builds).toBeGreaterThan(initialStats.builds);
    }
    await guest.screenshot({ path: testInfo.outputPath("eight-player-guest-territory.png") });
    await testInfo.attach("Eight-player city capture", { path: testInfo.outputPath("eight-player-captured-territory.png"), contentType: "image/png" });
    expect(errors).toEqual([]);
  } finally {
    for (const bot of bots) bot.socket.close();
    await context.close();
  }
});

test("large and rectangular boards preserve batching and avoid hover rebuilds", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.waitForFunction(() => !!window.__GAME_DEBUG__);
  for (const dimensions of [{ width: 30, height: 30 }, { width: 32, height: 18 }]) {
    await page.evaluate(dimensions => window.__GAME_DEBUG__!.setWorld("fern-104", 8, dimensions), dimensions);
    expect((await snapshot(page)).tiles.length).toBeLessThan(dimensions.width * dimensions.height);
    expect(await page.evaluate(() => window.__GAME_DEBUG__!.getHoveredTile())).toBe("");
    const before = await page.evaluate(() => ({ render: window.__GAME_DEBUG__!.getTerritoryRenderStats(), profile: window.__GAME_DEBUG__!.getProfile() }));
    for (let i = 0; i < 12; i++) await page.mouse.move(500 + i * 20, 480);
    const after = await page.evaluate(() => ({ render: window.__GAME_DEBUG__!.getTerritoryRenderStats(), profile: window.__GAME_DEBUG__!.getProfile() }));
    expect(after.render.builds).toBe(before.render.builds);
    expect(after.profile.builds).toBe(before.profile.builds);
    expect(after.profile.materials).toBe(before.profile.materials);
    expect(after.profile.loops).toBe(1);
    expect(after.render.meshes).toBe(1);
    const city = (await snapshot(page)).cities[0];
    await clickTile(page, city.x, city.y);
    await expect.poll(() => page.evaluate(() => window.__GAME_DEBUG__!.getTerritoryRenderStats().selectedCityId)).toBe(city.id);
    expect((await page.evaluate(() => window.__GAME_DEBUG__!.getTerritoryRenderStats())).meshes).toBe(2);
    await page.screenshot({ path: testInfo.outputPath(`${dimensions.width}x${dimensions.height}-city.png`) });
  }
});
