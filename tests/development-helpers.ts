import { expect, type Page } from "@playwright/test";
import { createGame, getCityGrowth, getHarvestReason, getImprovementReason, getPortBuildingReason, getRoadBuildingReason, getReachableTiles, getTile, getTerritory, getTechnology, getTechnologyCost, hasTechnology, canUnitEnterTerrain, improvementDefinitions, positionKey, type Position, type TechnologyId } from "../packages/game-core/src/index";
import "../apps/web/src/debug";

export const snapshot = (page: Page) => page.evaluate(() => window.__GAME_DEBUG__!.getState());
export async function settled(page: Page, revision?: number) {
  if (revision !== undefined) await expect.poll(async () => (await snapshot(page)).revision).toBe(revision);
  await expect.poll(() => page.evaluate(() => window.__GAME_DEBUG__!.isAnimating())).toBe(false);
}
export async function tile(page: Page, position: Position) {
  const point = await page.evaluate(p => window.__GAME_DEBUG__!.getTileScreenPosition(p.x, p.y), position);
  await page.mouse.click(point.x, point.y);
}
export async function round(page: Page, guest = page) {
  for (const client of [page, guest]) {
    const revision = (await snapshot(page)).revision;
    await client.getByRole("button", { name: "End Turn", exact: true }).click();
    await settled(page, revision + 1);
    if (guest !== page) await settled(guest, revision + 1);
  }
}
export async function fund(page: Page, amount: number, guest = page) {
  while (true) { const state = await snapshot(page); if (state.players.find(player => player.id === state.activePlayerId)!.resources.gold >= amount) return; await round(page, guest); }
}
export async function research(page: Page, id: TechnologyId, guest = page) {
  const state = await snapshot(page);
  if (hasTechnology(state, state.activePlayerId, id)) return;
  await fund(page, getTechnologyCost(state, state.activePlayerId, id), guest);
  const name = getTechnology(id)!.name;
  await page.getByRole("button", { name: "Technologies", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(`^${name}: `) }).click();
  await page.getByRole("button", { name: `Research ${name}`, exact: true }).click();
  await settled(page, state.revision === (await snapshot(page)).revision ? state.revision + 1 : undefined);
  await page.getByRole("button", { name: "Close technologies" }).click();
}
export async function inspect(page: Page, position: Position) {
  await page.keyboard.press("Escape");
  await tile(page, position);
  if ((await snapshot(page)).units.some(unit => positionKey(unit) === positionKey(position))) await page.getByRole("button", { name: "Develop this tile", exact: true }).click();
  await expect(page.getByRole("region", { name: "Develop tile", exact: true })).toBeVisible();
}
export async function move(page: Page, id: string, position: Position) {
  await page.keyboard.press("Escape");
  const before = await snapshot(page);
  const point = await page.evaluate(id => window.__GAME_DEBUG__!.getUnitScreenPosition(id), id);
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => page.evaluate(() => window.__GAME_DEBUG__!.getSelectedUnitId())).toBe(id);
  await tile(page, position);
  await settled(page, before.revision + 1);
}
export async function travel(page: Page, id: string, target: Position, roads = false) {
  const map = createGame("fern-104", 2, { scenario: "demo" }).tiles;
  for (let step = 0; step < 70; step++) {
    let state = await snapshot(page);
    const unit = state.units.find(unit => unit.id === id)!;
    if (roads) {
      await fund(page, 6);
      state = await snapshot(page);
      if (getRoadBuildingReason(state, state.activePlayerId, unit) === null) {
        await page.getByRole("button", { name: "Build Roads", exact: true }).click();
        await tile(page, unit);
        await page.getByRole("button", { name: "Build Road · 3 Gold", exact: true }).click();
        await page.getByRole("button", { name: "Cancel roads" }).click();
        state = await snapshot(page);
      }
    }
    if (positionKey(unit) === positionKey(target)) return;
    const distances = new Map([[positionKey(target), 0]]), queue = [{ ...target, distance: 0 }];
    while (queue.length) {
      const current = queue.shift()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = getTile({ ...state, tiles: map }, current.x + dx, current.y + dy);
        if (!next || distances.has(positionKey(next)) || !canUnitEnterTerrain(state, unit.ownerId, unit, next.terrain) || state.units.some(other => other.id !== id && positionKey(other) === positionKey(next))) continue;
        distances.set(positionKey(next), current.distance + 1); queue.push({ ...next, distance: current.distance + 1 });
      }
    }
    const next = getReachableTiles(state, id).sort((a, b) => (distances.get(positionKey(a)) ?? Infinity) - (distances.get(positionKey(b)) ?? Infinity))[0];
    if (!next || (distances.get(positionKey(next)) ?? Infinity) >= (distances.get(positionKey(unit)) ?? Infinity)) { await round(page); continue; }
    await move(page, id, next);
    if (roads) await round(page);
  }
  throw new Error("Could not reach city");
}
export async function develop(page: Page, cityId: string, level: number) {
  const technologies: TechnologyId[] = level === 2 ? ["organization"] : ["organization", "farming", "hunting", "forestry", "mathematics", "climbing", "mining", "smithery", "fishing"];
  for (const id of technologies) await research(page, id);
  for (let step = 0; step < 80; step++) {
    let state = await snapshot(page);
    const city = state.cities.find(city => city.id === cityId)!;
    if (city.townHallLevel >= level) return;
    if (city.rewardPending) {
      await page.keyboard.press("Escape"); await tile(page, city);
      const name = city.townHallLevel === 2 ? /^Workshop/ : city.townHallLevel === 3 ? /^Resources/ : /^Border Growth/;
      await page.getByRole("button", { name }).click(); continue;
    }
    await fund(page, 7); state = await snapshot(page);
    const claims = getTerritory(state);
    const tiles = state.tiles.filter(tile => claims.some(claim => claim.cityId === cityId && positionKey(claim) === positionKey(tile)));
    const harvest = tiles.find(tile => getHarvestReason(state, state.activePlayerId, tile) === null);
    if (harvest) { await inspect(page, harvest); await page.getByRole("button", { name: /^Harvest/ }).click(); continue; }
    let built = false;
    for (const [type, definition] of Object.entries(improvementDefinitions)) {
      const tile = tiles.find(tile => getImprovementReason(state, state.activePlayerId, tile, type) === null);
      if (tile) { await inspect(page, tile); await page.getByRole("button", { name: `Build ${definition.name} · ${definition.cost} Gold`, exact: true }).click(); built = true; break; }
    }
    if (built) continue;
    const port = tiles.find(tile => getPortBuildingReason(state, state.activePlayerId, tile) === null);
    if (port) {
      await page.getByRole("button", { name: "Build Ports", exact: true }).click(); await tile(page, port);
      await page.getByRole("button", { name: "Build Port · 7 Gold", exact: true }).click(); await page.getByRole("button", { name: "Cancel ports" }).click(); continue;
    }
    throw new Error(`No development at city ${cityId}: ${JSON.stringify(getCityGrowth(state, city))}`);
  }
  throw new Error("City progression did not finish");
}
