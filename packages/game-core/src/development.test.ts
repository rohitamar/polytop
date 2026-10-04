import { describe, expect, it } from "vitest";
import { applyAction, createGame, getCityGrowth, getDefenseBonus, getHarvestReason, getImprovementReason, getPlayerView, getTile, getUnitStats, improvementDefinitions, getConnectedCities, fullRuleset, type GameAction, type GameState, type Opportunity, type Improvement } from "./index";

function fixture() {
  const state = createGame("fern-104", 2, { scenario: "demo" });
  state.cities = [{ ...state.cities[0], x: 4, y: 4, expanded: true }];
  state.tiles.forEach(tile => { tile.terrain = "grass"; delete tile.resource; });
  state.units[0].x = 4; state.units[0].y = 4;
  state.units[1].x = 15; state.units[1].y = 15;
  state.players[0].resources.gold = 100;
  state.players[0].technologies = ["organization", "farming", "hunting", "forestry", "mathematics", "climbing", "mining", "smithery", "fishing", "roads", "riding", "archery", "strategy"];
  return state;
}
function reject(state: GameState, action: GameAction) {
  const before = structuredClone(state);
  expect(() => applyAction(state, action)).toThrow();
  expect(state).toEqual(before);
}
describe("resource discovery", () => {
  it.each([["wheat", "organization"], ["mine", "climbing"], ["starfish", "fishing"]] as const)("reveals %s only after %s, including synchronized fog memory", (resource, technology) => {
    let state = fixture(); state.players[0].technologies = [];
    getTile(state, 3, 4)!.resource = resource;
    const locked = getPlayerView(state, "player-1");
    expect(getTile(locked, 3, 4)!.resource).toBeUndefined();
    expect(locked.exploration!["player-1"].tiles["3,4"].resource).toBeUndefined();
    state = applyAction(state, { type: "UNLOCK_TECHNOLOGY", playerId: "player-1", technologyId: technology });
    expect(getTile(getPlayerView(state, "player-1"), 3, 4)!.resource).toBe(resource);
    expect(getTile(getPlayerView(state, "player-2"), 3, 4)).toBeUndefined();
  });
});

describe("tile development", () => {
  it.each(["orchard", "animal", "fishery"] as Opportunity[])("harvests %s for Gold and population once without a unit", resource => {
    const state = fixture(); const tile = getTile(state, 3, 4)!; tile.resource = resource;
    tile.terrain = resource === "animal" ? "forest" : resource === "fishery" ? "water" : "grass";
    const action: GameAction = { type: "HARVEST_RESOURCE", playerId: "player-1", to: { x: 3, y: 4 } };
    expect(getHarvestReason(state, "player-1", tile)).toBeNull();
    const next = applyAction(state, action);
    expect(next.players[0].resources.gold).toBe(98);
    expect(next.cities[0].population).toBe(1);
    expect(getTile(next, 3, 4)!.resource).toBeUndefined();
    expect(next.units).toEqual(state.units);
    reject(next, action);
  });
  it.each(["turn", "technology", "gold", "foreign", "hidden", "coordinate", "enemy", "siege"])("rejects %s harvesting atomically", reason => {
    const state = fixture(); const tile = getTile(state, 3, 4)!; tile.resource = "orchard";
    if (reason === "turn") state.activePlayerId = "player-2";
    if (reason === "technology") state.players[0].technologies = [];
    if (reason === "gold") state.players[0].resources.gold = 1;
    if (reason === "foreign") state.cities[0].ownerId = "player-2";
    if (reason === "enemy") state.units[1] = { ...state.units[1], x: 3, y: 4 };
    if (reason === "siege") state.units[1] = { ...state.units[1], x: 4, y: 4 };
    reject(state, { type: "HARVEST_RESOURCE", playerId: "player-1", to: reason === "hidden" ? { x: 16, y: 16 } : reason === "coordinate" ? { x: 3.5, y: 4 } : { x: 3, y: 4 } });
  });
  it.each(Object.keys(improvementDefinitions) as Improvement[])("builds %s using one registry and credits its city's population", improvement => {
    const state = fixture(); const definition = improvementDefinitions[improvement]; const tile = getTile(state, 3, 4)!;
    tile.terrain = definition.terrain; tile.resource = definition.resource;
    if (definition.adjacent) getTile(state, 3, 3)!.improvement = definition.adjacent;
    const before = getCityGrowth(state, state.cities[0]).total;
    const next = applyAction(state, { type: "BUILD_IMPROVEMENT", playerId: "player-1", to: { x: 3, y: 4 }, improvement });
    expect(next.players[0].resources.gold).toBe(100 - definition.cost);
    expect(getCityGrowth(next, next.cities[0]).total - before).toBe(definition.population);
    expect(getTile(next, 3, 4)!.improvement).toBe(improvement);
    expect(getTile(next, 3, 4)!.resource).toBeUndefined();
    expect(getImprovementReason(next, "player-1", tile, improvement)).toBe("Tile already developed");
  });
  it("recomputes adjacency for friendly improvements across city borders and rejects duplicate multipliers", () => {
    const state = fixture(); getTile(state, 3, 3)!.improvement = "mine"; getTile(state, 4, 3)!.improvement = "mine";
    const next = applyAction(state, { type: "BUILD_IMPROVEMENT", playerId: "player-1", to: { x: 3, y: 4 }, improvement: "forge" });
    expect(getCityGrowth(next, next.cities[0]).total).toBe(8);
    reject(next, { type: "BUILD_IMPROVEMENT", playerId: "player-1", to: { x: 4, y: 4 }, improvement: "forge" });
    const transferred = structuredClone(next); transferred.cities.push({ id: "a", x: 3, y: 2, ownerId: "player-2", townHallLevel: 1 });
    expect(getCityGrowth(transferred, transferred.cities[0]).total).toBeLessThan(8);
  });
  it.each(["locked", "resource", "terrain", "cost", "adjacency", "unknown"])("rejects invalid %s construction without spending Gold", reason => {
    const state = fixture(); const tile = getTile(state, 3, 4)!; tile.resource = "wheat";
    if (reason === "locked") state.players[0].technologies = [];
    if (reason === "resource") delete tile.resource;
    if (reason === "terrain") tile.terrain = "forest";
    if (reason === "cost") state.players[0].resources.gold = 4;
    if (reason === "adjacency") delete tile.resource;
    reject(state, { type: "BUILD_IMPROVEMENT", playerId: "player-1", to: tile, improvement: reason === "adjacency" ? "sawmill" : reason === "unknown" ? "toString" as Improvement : "farm" });
  });
  it("clears an unimproved forest for one Gold, forfeiting animals but never clearing buildings", () => {
    const state = fixture(); const tile = getTile(state, 3, 4)!; tile.terrain = "forest"; tile.resource = "animal";
    const action: GameAction = { type: "CLEAR_FOREST", playerId: "player-1", to: tile };
    const next = applyAction(state, action);
    expect(next.players[0].resources.gold).toBe(101); expect(getTile(next, 3, 4)).toMatchObject({ terrain: "grass", resource: undefined });
    expect(next.cities[0].population).toBe(0);
    tile.improvement = "lumber-hut"; reject(state, action);
  });
  it("bridges allow land movement across shallow water without embarking", () => {
    const state = fixture(); getTile(state, 3, 4)!.terrain = "water";
    const built = applyAction(state, { type: "BUILD_BRIDGE", playerId: "player-1", to: { x: 3, y: 4 } });
    expect(built.players[0].resources.gold).toBe(95);
    const next = applyAction(built, { type: "move", playerId: "player-1", unitId: "warrior-1", to: { x: 3, y: 4 } });
    expect(next.units[0].embarked).toBeUndefined(); expect(next.units[0].unitType).toBe("warrior");
  });
  it("roads connect cities to the capital, add population to both, and recalculate after capture", () => {
    const state = fixture(); state.cities.push({ id: "town", ownerId: "player-1", x: 7, y: 4, townHallLevel: 1, population: 0 });
    getTile(state, 5, 4)!.road = true; getTile(state, 6, 4)!.road = true;
    expect(getConnectedCities(state, "player-1")).toEqual(["town"]);
    expect(getCityGrowth(state, state.cities[0]).total).toBe(1);
    expect(getCityGrowth(state, state.cities[1]).total).toBe(1);
    state.cities[1].ownerId = "player-2";
    expect(getConnectedCities(state, "player-1")).toEqual([]);
  });
  it("forest and mountain technology bonuses apply generically; walls require Fortify", () => {
    const state = fixture(); const unit = state.units[0];
    getTile(state, unit.x, unit.y)!.terrain = "forest"; state.cities[0].x = 8;
    expect(getDefenseBonus(state, unit)).toBe(1.5);
    getTile(state, unit.x, unit.y)!.terrain = "mountain"; expect(getDefenseBonus(state, unit)).toBe(1.5);
    state.cities[0].x = 4; state.cities[0].walls = true; expect(getDefenseBonus(state, unit)).toBe(4);
    state.units[0] = { ...unit, ...getUnitStats("swordsman") }; getTile(state, unit.x, unit.y)!.terrain = "grass";
    expect(getDefenseBonus(state, state.units[0])).toBe(1);
  });
  it("preserves development and reward state through serialization and owner views", () => {
    const state = fixture(); getTile(state, 3, 4)!.resource = "wheat";
    const next = applyAction(state, { type: "BUILD_IMPROVEMENT", playerId: "player-1", to: { x: 3, y: 4 }, improvement: "farm" });
    expect(next.cities[0].rewardPending).toBe(true);
    expect(getTile(getPlayerView(next, "player-1"), 3, 4)!.improvement).toBe("farm");
    const restored: GameState = JSON.parse(JSON.stringify(next));
    expect(getCityGrowth(restored, restored.cities[0])).toEqual(getCityGrowth(next, next.cities[0]));
    expect(getPlayerView(restored, "player-1").cities[0].rewardPending).toBe(true);
  });
  it("peace treaties prevent attacks and capture, and breaking peace exhausts the aggressor", () => {
    let state = fixture(); state.units[1] = { ...state.units[1], x: 5, y: 4 };
    state = applyAction(state, { type: "PROPOSE_PEACE", playerId: "player-1", otherPlayerId: "player-2" });
    state = applyAction(state, { type: "END_TURN", playerId: "player-1" });
    state = applyAction(state, { type: "ACCEPT_PEACE", playerId: "player-2", otherPlayerId: "player-1" });
    state = applyAction(state, { type: "END_TURN", playerId: "player-2" });
    reject(state, { type: "ATTACK_UNIT", playerId: "player-1", unitId: "warrior-1", targetId: "warrior-2" });
    const next = applyAction(state, { type: "BREAK_PEACE", playerId: "player-1", otherPlayerId: "player-2" });
    expect(next.units[0].actionPhase).toBe("complete"); expect(next.treaties).toEqual([]);
  });
  it("disabled Giant rules reject the reward without consuming the choice", () => {
    const state = fixture(); state.cities[0] = { ...state.cities[0], townHallLevel: 5, population: 14, rewardPending: true };
    state.rules = { ...fullRuleset, enabledUnitTypes: ["warrior"] };
    reject(state, { type: "CHOOSE_CITY_REWARD", playerId: "player-1", cityId: "city-1", reward: "giant" });
  });
});
