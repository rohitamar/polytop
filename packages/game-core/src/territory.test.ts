import { describe, expect, it } from "vitest";
import { applyAction, createGame as generateGame, getTerritory, getTileTerritory, territoryRules } from "./index";

const createGame = (seed = "fern-104", count = 2) => generateGame(seed, count, count === 2 ? { scenario: "demo" } : {});

describe("city territory", () => {
  it("claims its own tile and a compact square region, leaving distant tiles unclaimed", () => {
    const state = createGame();
    state.cities = [state.cities[0]];
    expect(getTerritory(state).filter(tile => tile.cityId)).toHaveLength(9);
    expect(getTileTerritory(state, 4, 5)).toMatchObject({ cityId: "city-1", playerId: "player-1" });
    expect(getTileTerritory(state, 5, 5)?.cityId).toBe("city-1");
    expect(getTileTerritory(state, 6, 6)?.cityId).toBeNull();
    expect(getTerritory(state, 0).filter(tile => tile.cityId)).toHaveLength(1);
    expect(territoryRules.radius).toBe(1);
    expect(() => getTerritory(state, -1)).toThrow();
  });
  it("resolves overlaps by distance then stable city ID regardless of array order", () => {
    const state = createGame();
    state.cities = [{ ...state.cities[0], id: "b", x: 4, y: 5 }, { ...state.cities[1], id: "a", x: 6, y: 5 }];
    expect(getTileTerritory(state, 5, 5)?.cityId).toBe("a");
    expect(getTileTerritory(state, 4, 5)?.cityId).toBe("b");
    const before = getTerritory(state);
    state.cities.reverse();
    expect(getTerritory(state)).toEqual(before);
  });
  it("keeps neutral city claims and transfers the whole region on capture immutably", () => {
    const state = createGame();
    const before = getTerritory(state);
    const neutral = before.filter(tile => tile.cityId === "neutral-1");
    expect(neutral.length).toBeGreaterThan(1);
    expect(neutral.every(tile => tile.playerId === null)).toBe(true);
    const next = applyAction(state, { type: "move", playerId: "player-1", unitId: "warrior-1", to: { x: 5, y: 5 } });
    expect(getTerritory(next).filter(tile => tile.cityId === "neutral-1")).toEqual(neutral.map(tile => ({ ...tile, playerId: "player-1" })));
    expect(getTerritory(state)).toEqual(before);
    expect(getTerritory(next).filter(tile => tile.cityId === "city-1").every(tile => tile.playerId === "player-1")).toBe(true);
  });
  it("transfers a defeated enemy city's territory on combat advance", () => {
    const state = createGame();
    state.units[0] = { ...state.units[0], x: 6, y: 3 };
    state.units[1] = { ...state.units[1], hp: 1 };
    state.tiles = state.tiles.map(tile => tile.x === 7 && tile.y === 3 ? { ...tile, terrain: "grass" } : tile);
    const before = getTerritory(state).filter(tile => tile.cityId === "city-2");
    const next = applyAction(state, { type: "ATTACK_UNIT", playerId: "player-1", unitId: "warrior-1", targetId: "warrior-2" });
    expect(getTerritory(next).filter(tile => tile.cityId === "city-2")).toEqual(before.map(tile => ({ ...tile, playerId: "player-1" })));
    expect(getTerritory(state).filter(tile => tile.cityId === "city-2")).toEqual(before);
  });
  it("keeps individual city claims for adjoining friendly and opposing regions", () => {
    const state = generateGame("territory", 2, { width: 12, height: 16 });
    state.cities = [{ ...state.cities[0], x: 4, y: 5 }, { ...state.cities[1], x: 7, y: 5, ownerId: state.players[0].id }];
    expect(getTileTerritory(state, 5, 5)).toMatchObject({ cityId: "city-1", playerId: "player-1" });
    expect(getTileTerritory(state, 6, 5)).toMatchObject({ cityId: "city-2", playerId: "player-1" });
    state.cities[1].ownerId = state.players[1].id;
    expect(getTileTerritory(state, 6, 5)).toMatchObject({ cityId: "city-2", playerId: "player-2" });
    expect(getTileTerritory(state, 0, 0)).toMatchObject({ cityId: null, playerId: null });
  });
  it("clips claims to map tiles and keeps territory stable through upgrades", () => {
    const state = createGame();
    state.cities = [{ ...state.cities[0], x: 0, y: 0 }];
    state.players[0].resources.gold = 10;
    expect(getTerritory(state).filter(tile => tile.cityId)).toHaveLength(4);
    state.cities[0] = { ...state.cities[0], townHallLevel: 2, population: 2, rewardPending: true };
    const next = applyAction(state, { type: "CHOOSE_CITY_REWARD", playerId: "player-1", cityId: "city-1", reward: "workshop" });
    expect(getTerritory(next)).toEqual(getTerritory(state));
  });
  it.each([2, 3, 8])("derives every city owner for %i players deterministically", count => {
    const state = createGame("fern-104", count);
    for (const city of state.cities) {
      expect(getTileTerritory(state, city.x, city.y)).toMatchObject({ cityId: city.id, playerId: city.ownerId });
    }
    for (const tile of getTerritory(state).filter(tile => tile.cityId)) {
      expect(tile.playerId).toBe(state.cities.find(city => city.id === tile.cityId)!.ownerId);
    }
    expect(getTerritory(state)).toEqual(getTerritory(createGame("fern-104", count)));
  });
});
