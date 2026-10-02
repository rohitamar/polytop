import { describe, expect, it } from "vitest";
import { applyAction, createGame, economy, getCityPopulation, getCityProduction, getProduction, getTerritory, getTile, getTileTerritory, getWorkableTiles, positionKey, type GameState, type Position } from "./index";

const end = (state: GameState) => applyAction(state, { type: "END_TURN", playerId: state.activePlayerId });
const assign = (state: GameState, cityId: string, tile: Position, remove = false) => applyAction(state, { type: remove ? "UNASSIGN_WORKER" : "ASSIGN_WORKER", playerId: state.activePlayerId, cityId, tile });

describe("resource opportunities", () => {
  it.each([2, 4, 6, 8])("generates reproducible compatible resources for %i players", count => {
    for (const seed of ["fern-104", "coast", "orchard", "ridge"]) {
      const state = createGame(seed, count);
      expect(state.tiles).toEqual(createGame(seed, count).tiles);
      expect(state.tiles).not.toEqual(createGame(seed + "-other", count).tiles);
      expect(new Set(state.tiles.map(tile => tile.resource).filter(Boolean))).toEqual(new Set(["orchard", "wheat", "fishery", "forest", "mine"]));
      for (const tile of state.tiles) {
        if (tile.resource === "orchard" || tile.resource === "wheat" || tile.resource === "mine") expect(tile.terrain).toBe("grass");
        if (tile.resource === "forest") expect(tile.terrain).toBe("forest");
        const near = [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dx, dy]) => getTile(state, tile.x + dx, tile.y + dy));
        if (tile.resource === "fishery") { expect(tile.terrain).toBe("water"); expect(near.some(tile => tile && tile.terrain !== "water")).toBe(true); }
        if (tile.resource === "mine") expect(near.some(tile => tile?.terrain === "mountain")).toBe(true);
      }
      for (const city of state.cities) expect(getTile(state, city.x, city.y)?.resource).toBeUndefined();
      for (const city of state.cities.filter(city => city.ownerId)) {
        const resources = getWorkableTiles(state, city.id);
        expect(resources.length).toBeGreaterThanOrEqual(3);
        expect(resources.some(tile => tile.resource === "wheat" || tile.resource === "orchard")).toBe(true);
        for (const tile of resources) expect(getTileTerritory(state, tile.x, tile.y)?.cityId).toBe(city.id);
      }
    }
  });
  it("leaves open ground and clusters food opportunities", () => {
    const state = createGame("fern-104", 8);
    const fields = state.tiles.filter(tile => tile.resource === "orchard" || tile.resource === "wheat");
    expect(state.tiles.filter(tile => tile.terrain === "grass" && !tile.resource).length).toBeGreaterThan(30);
    const grouped = fields.filter(tile => [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => getTile(state, tile.x + dx, tile.y + dy)?.resource === tile.resource));
    expect(grouped.length / fields.length).toBeGreaterThan(0.7);
  });
  it("supports rectangular resource placement", () => {
    const config = { width: 34, height: 16 };
    const state = createGame("fern-104", 8, config);
    expect(state.tiles).toHaveLength(544);
    expect(state).toEqual(createGame("fern-104", 8, config));
    expect(state.tiles.some(tile => tile.resource === "mine")).toBe(true);
  });
});

describe("city-controlled resource development", () => {
  it("rejects another city's tile even with the same player owner, neutral and unclaimed land", () => {
    const state = createGame("fern-104", 2, { scenario: "demo" });
    const other = getWorkableTiles(state, "city-2")[0];
    state.cities[1].ownerId = "player-1";
    const neutral = state.tiles.find(tile => tile.resource && getTileTerritory(state, tile.x, tile.y)?.cityId === "neutral-1")!;
    const unclaimed = state.tiles.find(tile => tile.resource && !getTileTerritory(state, tile.x, tile.y)?.cityId)!;
    for (const tile of [other, neutral, unclaimed]) {
      const before = structuredClone(state);
      expect(() => assign(state, "city-1", tile)).toThrow("not workable");
      expect(state).toEqual(before);
    }
    expect(getWorkableTiles(state, "neutral-1")).toEqual([]);
    expect(() => assign(state, "neutral-1", neutral)).toThrow("Not your city");
  });
  it("spends and restores exactly one civilian without producing on assignment", () => {
    const state = createGame("fern-104", 8);
    const tiles = getWorkableTiles(state, "city-1");
    const one = assign(state, "city-1", tiles[0]);
    const two = assign(one, "city-1", tiles[1]);
    expect(getCityPopulation(one, one.cities[0]).available).toBe(1);
    expect(getCityPopulation(two, two.cities[0]).available).toBe(0);
    expect(two.players[0].resources).toEqual(state.players[0].resources);
    expect(() => assign(two, "city-1", tiles[2])).toThrow("No available civilians");
    const next = assign(two, "city-1", tiles[0], true);
    expect(getCityPopulation(next, next.cities[0])).toMatchObject({ total: 3, civilian: 2, military: 1, available: 1 });
    expect(state.cities[0].workedTiles).toEqual([]);
  });
  it("sums Food, Wood and Steel from different cities and pays only on owner handoff", () => {
    let state = createGame("fern-104", 2, { scenario: "demo" });
    state.cities[1].ownerId = "player-1";
    const first = getWorkableTiles(state, "city-1").slice(0, 2);
    const second = getWorkableTiles(state, "city-2").slice(0, 2);
    first[0].resource = "wheat"; first[1].resource = "forest";
    second[0].resource = "fishery"; second[1].resource = "mine";
    for (const tile of first) state = assign(state, "city-1", tile);
    for (const tile of second) state = assign(state, "city-2", tile);
    expect(getCityProduction(state, "city-1")).toEqual({ gold: 2, food: 3, wood: 2, steel: 0 });
    expect(getProduction(state, "player-1")).toEqual({ gold: 4, food: 5, wood: 2, steel: 2 });
    expect(getProduction(state, "player-2")).toEqual({ gold: 0, food: 0, wood: 0, steel: 0 });
    expect(end(state).players[0].resources).toEqual(state.players[0].resources);
    expect(end(end(state)).players[0].resources).toEqual({ gold: 6, food: 5, wood: 2, steel: 2 });
    expect(end(end(state))).toEqual(end(end(state)));
  });
  it("captures developed resources, retaining assignments and transferring production and authority", () => {
    let state = createGame("fern-104", 2, { scenario: "demo" });
    const city = state.cities.find(city => city.id === "neutral-1")!;
    city.ownerId = "player-2";
    state.activePlayerId = "player-2";
    const tile = getWorkableTiles(state, city.id)[0];
    state = assign(state, city.id, tile);
    const before = getTerritory(state);
    const key = positionKey(tile);
    state = end(state);
    const next = applyAction(state, { type: "move", playerId: "player-1", unitId: "warrior-1", to: { x: 5, y: 5 } });
    expect(next.cities.find(city => city.id === "neutral-1")!.workedTiles).toEqual([key]);
    expect(getTileTerritory(next, tile.x, tile.y)).toMatchObject({ cityId: "neutral-1", playerId: "player-1" });
    expect(before.find(claim => positionKey(claim) === key)?.playerId).toBe("player-2");
    expect(getCityProduction(next, "neutral-1")[economy.yields[tile.resource!].resource]).toBe(economy.yields[tile.resource!].amount);
    expect(() => applyAction({ ...next, activePlayerId: "player-2" }, { type: "UNASSIGN_WORKER", playerId: "player-2", cityId: "neutral-1", tile })).toThrow("Not your city");
    expect(assign(next, "neutral-1", tile, true).cities.find(city => city.id === "neutral-1")!.workedTiles).toEqual([]);
  });
});
