import { describe, expect, it } from "vitest";
import { applyAction, calculateGoldPerTurn, createGame, economy, getCityProduction, getCityResourceTiles, getPlayerPopulation, getProduction, getRecruitmentReason, getTileTerritory, type GameAction, type GameState, type Opportunity } from "./index";

const end = (state: GameState) => applyAction(state, { type: "END_TURN", playerId: state.activePlayerId });
const fixture = () => createGame("fern-104", 2, { scenario: "demo" });

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

describe("Gold economy", () => {
  it("awards complete income for turn one and keeps balances independent", () => {
    const state = fixture();
    expect(state.players.map(player => player.resources)).toEqual([{ gold: calculateGoldPerTurn(state, "player-1") }, { gold: 0 }]);
    expect(getProduction(state, "player-1")).toEqual({ gold: calculateGoldPerTurn(state, "player-1") });
    expect(Object.keys(state.players[0].resources)).toEqual(["gold"]);
  });

  it.each([1, 2, 3])("Town Hall level %i supplies configurable income and capacity", level => {
    const state = fixture();
    state.tiles.forEach(tile => delete tile.resource);
    state.cities[0].townHallLevel = level;
    expect(calculateGoldPerTurn(state, "player-1")).toBe(economy.goldIncome[level - 1]);
    expect(getPlayerPopulation(state, "player-1")).toEqual({ used: 1, capacity: economy.populationCaps[level - 1], available: economy.populationCaps[level - 1] - 1 });
  });

  it.each<Opportunity>(["orchard", "wheat", "fishery", "forest", "mine"])("%s never contributes passive income", resource => {
    const state = fixture();
    const tile = getCityResourceTiles(state, "city-1")[0];
    state.tiles.forEach(tile => delete tile.resource);
    tile.resource = resource;
    expect(calculateGoldPerTurn(state, "player-1")).toBe(economy.goldIncome[0]);
    expect(getPlayerPopulation(state, "player-1")).toEqual({ used: 1, capacity: 3, available: 2 });
  });

  it("sums multiple tiles and cities while excluding neutral and unclaimed resources", () => {
    const state = fixture();
    state.cities[1].ownerId = "player-1";
    const first = getCityResourceTiles(state, "city-1").slice(0, 2);
    const second = getCityResourceTiles(state, "city-2").slice(0, 2);
    const neutral = state.tiles.find(tile => tile.resource && getTileTerritory(state, tile.x, tile.y)?.playerId === null)!;
    state.tiles.forEach(tile => delete tile.resource);
    first[0].resource = "wheat"; first[1].resource = "forest";
    second[0].resource = "fishery"; second[1].resource = "mine";
    neutral.resource = "mine";
    expect(getCityProduction(state, "city-1")).toEqual({ gold: 2 });
    expect(getCityProduction(state, "city-2")).toEqual({ gold: 2 });
    expect(calculateGoldPerTurn(state, "player-1")).toBe(4);
    expect(getProduction(state, "player-2")).toEqual({ gold: 0 });
  });

  it.each([2, 3, 8])("pays only the incoming player once per handoff for %i players", count => {
    let state = createGame("fern-104", count);
    for (let i = 0; i < count * 2; i++) {
      const before = structuredClone(state);
      const next = end(freeze(state));
      for (const player of next.players) {
        expect(player.resources.gold).toBe(before.players.find(other => other.id === player.id)!.resources.gold + (player.id === next.activePlayerId ? calculateGoldPerTurn(before, player.id) : 0));
      }
      expect(state).toEqual(before);
      expect(next.turnNumber).toBe(before.turnNumber + 1);
      expect(() => applyAction(next, { type: "END_TURN", playerId: before.activePlayerId })).toThrow("turn");
      expect(JSON.parse(JSON.stringify(next))).toEqual(next);
      expect(end(before)).toEqual(next);
      state = next;
    }
  });

  it("capture transfers resource income and capacity without immediate payment or changing deployed unit ownership", () => {
    const state = fixture();
    const city = state.cities.find(city => city.id === "neutral-1")!;
    city.ownerId = "player-2";
    city.townHallLevel = 2;
    const previousA = calculateGoldPerTurn(state, "player-1");
    const previousB = calculateGoldPerTurn(state, "player-2");
    const transferred = getCityProduction(state, city.id).gold;
    const next = applyAction(freeze(state), { type: "move", playerId: "player-1", unitId: "warrior-1", to: { x: 5, y: 5 } });
    expect(calculateGoldPerTurn(next, "player-1")).toBe(previousA + transferred);
    expect(calculateGoldPerTurn(next, "player-2")).toBe(previousB - transferred);
    expect(next.players).toEqual(state.players);
    expect(getPlayerPopulation(next, "player-1")).toEqual({ used: 1, capacity: 9, available: 8 });
    expect(getPlayerPopulation(next, "player-2")).toEqual({ used: 1, capacity: 3, available: 2 });
    expect(end(next).players[1].resources.gold).toBe(previousB - transferred);
    expect(end(end(next)).players[0].resources.gold).toBe(state.players[0].resources.gold + previousA + transferred);
  });

  it("capacity loss preserves surviving units and moves support to the new owner", () => {
    const state = fixture();
    state.cities[0].ownerId = "player-2";
    expect(getPlayerPopulation(state, "player-1")).toEqual({ used: 1, capacity: 0, available: -1 });
    expect(getPlayerPopulation(state, "player-2")).toEqual({ used: 1, capacity: 6, available: 5 });
    expect(calculateGoldPerTurn(state, "player-1")).toBe(0);
  });

  it("blocks recruitment after losing support even when an owned spawn and Gold remain available", () => {
    const state = fixture();
    const captured = state.cities.find(city => city.id === "neutral-1")!;
    captured.ownerId = "player-2";
    state.cities[0].ownerId = "player-2";
    const retained = state.cities.find(city => city.id === "neutral-2")!;
    retained.ownerId = "player-1";
    state.units[0].populationCost = economy.populationCaps[0] + 1;
    state.players[0].resources.gold = 100;
    expect(getPlayerPopulation(state, "player-1")).toEqual({ used: 4, capacity: 3, available: -1 });
    const before = structuredClone(state);
    expect(getRecruitmentReason(state, "player-1", retained.id, "warrior")).toBe("Insufficient population");
    expect(() => applyAction(freeze(state), { type: "RECRUIT_UNIT", playerId: "player-1", cityId: retained.id, unitType: "warrior" })).toThrow("Insufficient population");
    expect(state).toEqual(before);
  });

  it("military casualties free committed population without changing Town Hall capacity", () => {
    const state = fixture();
    state.units[1] = { ...state.units[1], x: 5, y: 5, hp: 1 };
    const next = applyAction(state, { type: "ATTACK_UNIT", playerId: "player-1", unitId: "warrior-1", targetId: "warrior-2" });
    expect(getPlayerPopulation(next, "player-2")).toEqual({ used: 0, capacity: 3, available: 3 });
  });

  it.each(["ASSIGN_WORKER", "UNASSIGN_WORKER", "GROW_POPULATION"])("rejects obsolete %s actions without mutation", type => {
    const state = fixture();
    const before = structuredClone(state);
    expect(() => applyAction(freeze(state), { type, playerId: "player-1", cityId: "city-1", tile: { x: 4, y: 3 } } as unknown as GameAction)).toThrow("Unknown action");
    expect(state).toEqual(before);
  });
});
