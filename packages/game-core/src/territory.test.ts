import { describe, expect, it } from "vitest";
import { applyAction, createGame, getTerritory, getTileTerritory, territoryRules } from "./index";

describe("city territory", () => {
  it("claims its own tile and a compact Manhattan region, leaving distant tiles unclaimed", () => {
    const state = createGame();
    state.cities = [state.cities[0]];
    expect(getTerritory(state).filter(tile => tile.cityId)).toHaveLength(13);
    expect(getTileTerritory(state, 4, 5)).toMatchObject({ cityId: "city-1", playerId: "player-1" });
    expect(getTileTerritory(state, 6, 5)?.cityId).toBe("city-1");
    expect(getTileTerritory(state, 6, 6)?.cityId).toBeNull();
    expect(getTerritory(state, 0).filter(tile => tile.cityId)).toHaveLength(1);
    expect(territoryRules.radius).toBe(2);
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
  it("clips claims to map tiles and keeps territory stable through upgrades", () => {
    const state = createGame();
    state.cities = [{ ...state.cities[0], x: 0, y: 0 }];
    state.players[0].resources.gold = 10;
    expect(getTerritory(state).filter(tile => tile.cityId)).toHaveLength(6);
    const next = applyAction(state, { type: "UPGRADE_TOWN_HALL", playerId: "player-1", cityId: "city-1" });
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
