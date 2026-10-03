import { describe, expect, it } from "vitest";
import { applyAction, createGame, getMapSize, getReachableTiles, getTerritory, getTile, movementCost, positionKey, terrainRules } from "./index";

describe("strategic worlds", () => {
  it.each([[2, 20], [3, 24], [4, 24], [5, 28], [6, 28], [7, 30], [8, 30]])("sizes %i players at %i", (count, size) => {
    const state = createGame("fern-104", count);
    expect(getMapSize(count)).toEqual({ width: size, height: size });
    expect(state).toMatchObject({ width: size, height: size });
    expect(state.tiles).toHaveLength(size * size);
  });
  it.each([0, 1, 9, 2.5, NaN])("rejects player count %s", count => {
    expect(() => createGame("test", count)).toThrow("2-8");
  });
  it("reproduces all state from seed and configuration", () => {
    const config = { width: 32, height: 18, terrain: { elevationScale: 5, waterMin: 0.16, waterMax: 0.18 } };
    const state = createGame("world", 6, config);
    expect(createGame("world", 6, config)).toEqual(state);
    expect(createGame("other", 6, config).tiles).not.toEqual(state.tiles);
    expect(createGame("world", 6).tiles).not.toEqual(state.tiles);
    expect(getTerritory(state)).toEqual(getTerritory(createGame("world", 6, config)));
    const to = getReachableTiles(state, state.units[0].id)[0];
    expect(applyAction(state, { type: "move", playerId: state.activePlayerId, unitId: state.units[0].id, to }).units[0]).toMatchObject({ x: to.x, y: to.y });
    expect(getTile(state, 31, 17)).toBeDefined();
    expect(getTile(state, 32, 17)).toBeUndefined();
    const reversed = { ...state, tiles: [...state.tiles].reverse() };
    expect(getTile(reversed, 31, 17)).toEqual(getTile(state, 31, 17));
  });
  it.each([{ width: 9 }, { height: 129 }, { width: 20.5 }, { terrain: { elevationScale: 0 } }, { terrain: { safeRadius: 1 } }])("rejects invalid config %j", config => {
    expect(() => createGame("test", 2, config)).toThrow();
  });
  it.each([2, 4, 6, 8])("protects and connects starts and cities for %i players across seeds", count => {
    for (let seed = 0; seed < 30; seed++) {
      const state = createGame(String(seed), count);
      expect(new Set(state.cities.map(positionKey)).size).toBe(state.cities.length);
      for (const unit of state.units) {
        const city = state.cities.find(city => city.id === unit.homeCityId)!;
        expect(city).toMatchObject({ x: unit.x, y: unit.y, ownerId: unit.ownerId });
        const near = state.tiles.filter(tile => Math.abs(tile.x - city.x) + Math.abs(tile.y - city.y) <= terrainRules.safeRadius);
        expect(near).toHaveLength(13);
        expect(near.every(tile => tile.terrain !== "water")).toBe(true);
        expect(near.filter(tile => Math.abs(tile.x - city.x) + Math.abs(tile.y - city.y) <= 1).every(tile => Number.isFinite(movementCost[tile.terrain]))).toBe(true);
        expect(getTerritory(state).find(tile => tile.x === city.x && tile.y === city.y)).toMatchObject({ cityId: city.id, playerId: city.ownerId });
        for (const other of state.units.filter(other => other.id !== unit.id)) expect(Math.abs(unit.x - other.x) + Math.abs(unit.y - other.y)).toBeGreaterThanOrEqual(6);
        expect(getReachableTiles({ ...state, activePlayerId: unit.ownerId, units: state.units.map(other => ({ ...other, movement: 2 })) }, unit.id).length).toBeGreaterThanOrEqual(4);
      }
      const visited = new Set<string>([positionKey(state.units[0])]);
      const queue = [state.units[0] as { x: number; y: number }];
      for (let i = 0; i < queue.length; i++) for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const tile = getTile(state, queue[i].x + dx, queue[i].y + dy);
        if (tile && Number.isFinite(movementCost[tile.terrain]) && !visited.has(positionKey(tile))) { visited.add(positionKey(tile)); queue.push(tile); }
      }
      for (const city of state.cities) {
        expect(getTile(state, city.x, city.y)?.terrain).toBe("grass");
        expect(visited.has(positionKey(city))).toBe(true);
      }
    }
  });
  it.each([2, 4, 6, 8])("keeps water, forests and mountains at 13.33 percent of the board for %i players", count => {
    for (let seed = 0; seed < 30; seed++) {
      const state = createGame(String(seed), count);
      for (const terrain of ["water", "forest", "mountain"] as const) {
        expect(state.tiles.filter(tile => tile.terrain === terrain)).toHaveLength(Math.round(state.tiles.length * 0.1333));
      }
    }
  });
  it("uses the same terrain proportions in the local demo and rectangular worlds", () => {
    for (const state of [createGame("fern-104", 2, { scenario: "demo" }), createGame("fern-104", 8, { width: 32, height: 18 })]) {
      for (const terrain of ["water", "forest", "mountain"] as const) expect(state.tiles.filter(tile => tile.terrain === terrain)).toHaveLength(Math.round(state.tiles.length * 0.1333));
    }
  });
  it("preserves wooded start neighborhoods instead of clearing identical grass diamonds", () => {
    const worlds = Array.from({ length: 12 }, (_, seed) => createGame(String(seed), 8));
    const neighborhoods = worlds.flatMap(state => state.units.map(unit => state.tiles.filter(tile => Math.abs(tile.x - unit.x) + Math.abs(tile.y - unit.y) <= 1)));
    expect(neighborhoods.some(tiles => tiles.some(tile => tile.terrain === "forest"))).toBe(true);
    expect(neighborhoods.every(tiles => tiles.every(tile => Number.isFinite(movementCost[tile.terrain])))).toBe(true);
  });
  it("scatters mountains instead of forming elevation ridges", () => {
    const state = createGame("fern-104", 8);
    const mountains = state.tiles.filter(tile => tile.terrain === "mountain");
    const isolated = mountains.filter(tile => [[0, -1], [1, 0], [0, 1], [-1, 0]].every(([dx, dy]) => getTile(state, tile.x + dx, tile.y + dy)?.terrain !== "mountain"));
    expect(mountains.length).toBeGreaterThan(20);
    expect(isolated.length / mountains.length).toBeGreaterThan(0.45);
  });
  it("forms neighboring terrain regions rather than independent scattered tiles", () => {
    const state = createGame("fern-104", 8);
    for (const terrain of ["water", "forest"] as const) {
      const tiles = state.tiles.filter(tile => tile.terrain === terrain);
      expect(tiles.length).toBeGreaterThan(20);
      const clustered = tiles.filter(tile => [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => getTile(state, tile.x + dx, tile.y + dy)?.terrain === terrain));
      expect(clustered.length / tiles.length).toBeGreaterThan(0.85);
    }
  });
});
