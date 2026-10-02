import { describe, expect, it } from "vitest";
import { applyAction, createGame, economy, getCityPopulation, getProduction, getWorkableTiles, positionKey, type GameAction, type GameState, type Opportunity } from "./index";

const end = (state: GameState) => applyAction(state, { type: "END_TURN", playerId: state.activePlayerId });
const cycle = (state: GameState) => end(end(state));
const cityAction = (state: GameState, type: "GROW_POPULATION" | "UPGRADE_TOWN_HALL") => applyAction(state, { type, playerId: state.activePlayerId, cityId: "city-1" });
const assign = (state: GameState, tile = getWorkableTiles(state, "city-1")[0], type: "ASSIGN_WORKER" | "UNASSIGN_WORKER" = "ASSIGN_WORKER") => applyAction(state, { type, playerId: state.activePlayerId, cityId: "city-1", tile });
const invariant = (state: GameState) => {
  for (const city of state.cities) {
    const population = getCityPopulation(state, city);
    expect(population.civilian + population.military).toBe(population.total);
    expect(population.available).toBeGreaterThanOrEqual(0);
    expect(population.total).toBeLessThanOrEqual(population.cap);
  }
};

describe("population economy", () => {
  it.each([1, 2, 3])("level %i defines cap and turn Gold", level => {
    const state = createGame();
    state.cities[0].townHallLevel = level;
    expect(getCityPopulation(state, state.cities[0]).cap).toBe(economy.populationCaps[level - 1]);
    expect(cycle(state).players[0].resources.gold - state.players[0].resources.gold).toBe(economy.goldIncome[level - 1]);
  });
  it("counts starting Warriors against their home cities", () => {
    const state = createGame();
    expect(state.units[0]).toMatchObject({ homeCityId: "city-1", populationCost: 1 });
    expect(getCityPopulation(state, state.cities[0])).toMatchObject({ total: 3, civilian: 2, military: 1, available: 2 });
    invariant(state);
  });
  it("supports different future unit population costs", () => {
    const state = createGame();
    state.units[0].populationCost = 2;
    expect(getCityPopulation(state, state.cities[0])).toMatchObject({ civilian: 1, military: 2 });
    invariant(state);
  });
  it("spends Food and creates one civilian without mutating input", () => {
    const state = createGame();
    state.cities[0].population = 4;
    state.players[0].resources.food = 6;
    const before = structuredClone(state);
    const next = cityAction(state, "GROW_POPULATION");
    expect(next.players[0].resources.food).toBe(2);
    expect(getCityPopulation(next, next.cities[0])).toMatchObject({ total: 5, civilian: 4, military: 1 });
    expect(next.revision).toBe(state.revision + 1);
    expect(state).toEqual(before);
    invariant(next);
  });
  it.each(["cap", "poor"])("rejects growth when %s without mutation", scenario => {
    const state = createGame();
    if (scenario === "cap") { state.cities[0].population = 5; state.players[0].resources.food = 10; }
    const before = structuredClone(state);
    expect(() => cityAction(state, "GROW_POPULATION")).toThrow(scenario === "cap" ? "cap" : "Food");
    expect(state).toEqual(before);
  });
  it("unworked tiles produce nothing", () => {
    const state = createGame();
    expect(getWorkableTiles(state, "city-1").length).toBeGreaterThan(0);
    expect(getProduction(state, "player-1")).toEqual({ gold: 2, food: 0, wood: 0, steel: 0 });
  });
  it.each<Opportunity>(["orchard", "wheat", "fishery", "forest", "mine"])("worked %s produces its centralized yield", opportunity => {
    const state = createGame();
    const tile = getWorkableTiles(state, "city-1")[0];
    tile.resource = opportunity;
    const worked = assign(state, tile);
    const yieldRule = economy.yields[opportunity];
    expect(getProduction(worked, "player-1")[yieldRule.resource]).toBe(yieldRule.amount);
    expect(end(worked).players[0].resources).toEqual(worked.players[0].resources);
    expect(cycle(worked).players[0].resources[yieldRule.resource]).toBe(yieldRule.amount);
    invariant(worked);
  });
  it("assigns one civilian per tile, prevents duplicates and overassignment, and removes workers", () => {
    const initial = createGame();
    const tiles = getWorkableTiles(initial, "city-1");
    const one = assign(initial, tiles[0]);
    expect(getCityPopulation(one, one.cities[0]).available).toBe(1);
    expect(initial.cities[0].workedTiles).toEqual([]);
    expect(() => assign(one, tiles[0])).toThrow("already");
    const two = assign(one, tiles[1]);
    const before = structuredClone(two);
    expect(() => assign(two, tiles[2])).toThrow("civilians");
    expect(two).toEqual(before);
    const removed = assign(two, tiles[0], "UNASSIGN_WORKER");
    expect(removed.cities[0].workedTiles).toEqual([positionKey(tiles[1])]);
    expect(getCityPopulation(removed, removed.cities[0]).available).toBe(1);
    expect(() => assign(removed, tiles[0], "UNASSIGN_WORKER")).toThrow("not worked");
    invariant(removed);
  });
  it.each(["GROW_POPULATION", "UPGRADE_TOWN_HALL", "ASSIGN_WORKER", "UNASSIGN_WORKER"] as const)("checks ownership and active turn for %s", type => {
    const state = createGame();
    for (const [playerId, cityId] of [["player-2", "city-2"], ["player-1", "city-2"], ["player-1", "neutral-1"], ["player-1", "missing"]]) {
      const before = structuredClone(state);
      expect(() => applyAction(state, { type, playerId, cityId, tile: { x: 4, y: 4 } } as GameAction)).toThrow();
      expect(state).toEqual(before);
    }
  });
  it("rejects city tiles, distant tiles, missing tiles and another city's resources", () => {
    const state = createGame();
    for (const tile of [{ x: 4, y: 5 }, { x: -1, y: 0 }, { x: 19, y: 19 }, getWorkableTiles(state, "city-2")[0]]) {
      expect(() => assign(state, tile as typeof state.tiles[number])).toThrow("workable");
    }
  });
  it("upgrades for Gold, increases cap and next-turn income", () => {
    const state = cycle(createGame());
    const next = cityAction(state, "UPGRADE_TOWN_HALL");
    expect(next.players[0].resources.gold).toBe(0);
    expect(state.players[0].resources.gold).toBe(4);
    expect(getCityPopulation(next, next.cities[0]).cap).toBe(8);
    expect(getProduction(next, "player-1").gold).toBe(3);
    expect(cycle(next).players[0].resources.gold).toBe(3);
    invariant(next);
  });
  it("military losses reduce total population without creating civilians", () => {
    const state = createGame();
    state.units[1] = { ...state.units[1], x: 5, y: 5, hp: 1 };
    const next = applyAction(state, { type: "ATTACK_UNIT", playerId: "player-1", unitId: "warrior-1", targetId: "warrior-2" });
    expect(getCityPopulation(next, next.cities[1])).toMatchObject({ total: 2, civilian: 2, military: 0 });
    invariant(next);
  });
  it.each([2, 3, 8])("deterministic production across multiple cities and %i players", count => {
    const run = () => {
      let state = createGame("fern-104", count);
      state.cities.find(city => city.id === "neutral-1")!.ownerId = "player-1";
      for (const city of state.cities.filter(city => city.ownerId)) {
        const tile = getWorkableTiles(state, city.id)[0];
        city.workedTiles = [positionKey(tile)];
      }
      const keys = state.cities.flatMap(city => getWorkableTiles(state, city.id).map(positionKey));
      expect(new Set(keys).size).toBe(keys.length);
      for (let i = 0; i < count * 2; i++) {
        const before = state;
        state = end(state);
        for (const player of state.players) {
          const production = getProduction(before, player.id);
          for (const resource of ["gold", "food", "wood", "steel"] as const) {
            expect(player.resources[resource]).toBe(before.players.find(p => p.id === player.id)!.resources[resource] + (player.id === state.activePlayerId ? production[resource] : 0));
          }
        }
        invariant(state);
      }
      expect(getProduction(state, "player-1").gold).toBe(4);
      return state;
    };
    expect(run()).toEqual(run());
  });
});
