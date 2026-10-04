import { describe, expect, it } from "vitest";
import { applyAction, createGame, getCityGrowth, getCityRewards, getIncome, getTerritory, getTile, type CityReward, type GameState } from "./index";
const fixture = () => createGame("fern-104", 2, { scenario: "demo" });
const choose = (state: GameState, reward: CityReward) => applyAction(state, { type: "CHOOSE_CITY_REWARD", playerId: "player-1", cityId: "city-1", reward });
describe("city progression", () => {
  it("levels automatically from population, pauses for a choice, and carries overflow", () => {
    let state = fixture(); state.cities[0].population = 12;
    state = applyAction(state, { type: "END_TURN", playerId: "player-1" });
    expect(state.cities[0]).toMatchObject({ townHallLevel: 2, rewardPending: true });
    state = applyAction(state, { type: "END_TURN", playerId: "player-2" });
    state = choose(state, "workshop");
    expect(state.cities[0]).toMatchObject({ townHallLevel: 3, rewardPending: true, workshop: true });
    state = choose(state, "resources");
    expect(state.cities[0]).toMatchObject({ townHallLevel: 4, rewardPending: true });
    state = choose(state, "population");
    expect(state.cities[0]).toMatchObject({ townHallLevel: 5, rewardPending: true, population: 15 });
    state = choose(state, "giant");
    expect(state.cities[0]).toMatchObject({ townHallLevel: 5, giantReward: "available", rewardPending: false });
    expect(getCityGrowth(state, state.cities[0]).current).toBe(1);
  });
  it.each([2, 3, 4, 5, 8])("offers two valid rewards at level %i", level => {
    expect(getCityRewards(level)).toHaveLength(2);
    for (const reward of getCityRewards(level)) {
      const state = fixture(); state.cities[0] = { ...state.cities[0], townHallLevel: level, population: level * (level + 1) / 2 - 1, rewardPending: true };
      const next = choose(state, reward);
      expect(next.cities[0].rewardPending).toBe(false);
      expect(state.cities[0].rewardPending).toBe(true);
      if (reward === "resources") expect(next.players[0].resources.gold).toBe(10);
      if (reward === "park") expect(getIncome(next, "player-1")).toBe(getIncome(state, "player-1") + 1);
      if (reward === "explorer") expect(next.exploration!["player-1"].exploredTiles.length).toBeGreaterThan(state.exploration!["player-1"].exploredTiles.length);
    }
  });
  it("expands territory only when Border Growth is chosen", () => {
    const state = fixture(); state.cities = [{ ...state.cities[0], townHallLevel: 4, population: 9, rewardPending: true }];
    expect(getTerritory(state).filter(claim => claim.cityId)).toHaveLength(9);
    expect(getTerritory(choose(state, "borders")).filter(claim => claim.cityId)).toHaveLength(25);
  });
  it.each(["unavailable", "wrong-level", "foreign", "inactive", "duplicate"])("rejects %s reward claims atomically", reason => {
    let state = fixture(); state.cities[0] = { ...state.cities[0], townHallLevel: 2, population: 2, rewardPending: reason !== "unavailable" };
    if (reason === "foreign") state.cities[0].ownerId = "player-2";
    if (reason === "inactive") state.activePlayerId = "player-2";
    if (reason === "duplicate") state = choose(state, "workshop");
    const before = structuredClone(state);
    expect(() => choose(state, reason === "wrong-level" ? "giant" : "workshop")).toThrow();
    expect(state).toEqual(before);
  });
  it("combat capture rehomes the advancing unit and detaches enemy support", () => {
    const state = fixture(); state.cities[2].ownerId = "player-2";
    state.units[1] = { ...state.units[1], x: 5, y: 5, hp: 1, homeCityId: state.cities[2].id };
    state.units.push({ ...state.units[1], id: "survivor", hp: 10, x: 10, y: 8 });
    const next = applyAction(state, { type: "ATTACK_UNIT", playerId: "player-1", unitId: "warrior-1", targetId: "warrior-2" });
    expect(next.cities[2].ownerId).toBe("player-1");
    expect(next.units.find(unit => unit.id === "warrior-1")!.homeCityId).toBe(state.cities[2].id);
    expect(next.units.find(unit => unit.id === "survivor")!.homeCityId).toBeNull();
  });
  it("captures only the destination city, rehomes the capturer and detaches surviving enemy support", () => {
    const state = fixture(); state.cities[2].ownerId = "player-2"; state.units[1].homeCityId = state.cities[2].id;
    const next = applyAction(state, { type: "move", playerId: "player-1", unitId: "warrior-1", to: { x: 5, y: 5 } });
    expect(next.units[0].homeCityId).toBe(state.cities[2].id);
    expect(next.units[1].homeCityId).toBeNull();
    expect(next.cities[2].ownerId).toBe("player-1");
    expect(getTile(next, 5, 5)).toBeDefined();
  });
});
