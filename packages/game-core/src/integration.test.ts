import { describe, expect, it } from "vitest";
import { applyAction, createGame, getMovementCost, getReachableTiles, getRoadBuildingReason, getTechnologyCost, getTile, getUnitDefinition, getPlayerPopulation, type GameState } from "./index";

function fixture(): GameState {
  const state = createGame("fern-104", 2, { scenario: "demo" });
  state.width = 10;
  state.height = 5;
  state.tiles = Array.from({ length: 50 }, (_, i) => ({ x: i % 10, y: Math.floor(i / 10), terrain: "grass" }));
  state.cities = [{ id: "home", x: 0, y: 2, ownerId: "player-1", townHallLevel: 2 }, { id: "enemy", x: 9, y: 2, ownerId: "player-2", townHallLevel: 1 }];
  state.units = [{ ...state.units[0], x: 0, y: 2, homeCityId: "home", unitType: "rider", maxMovement: 2, movement: 2 }];
  state.players[0].resources.gold = 50;
  state.players[0].technologies = ["roads", "riding", "fishing"];
  state.units.push(...[3, 4, 8].map(x => ({ ...state.units[0], id: `observer-${x}`, x, y: 1, movement: 0, populationCost: 0 })));
  return state;
}
const road = (state: GameState, x: number, y = 2) => applyAction(state, { type: "BUILD_ROAD", playerId: "player-1", to: { x, y } });
const end = (state: GameState) => applyAction(state, { type: "END_TURN", playerId: state.activePlayerId });

describe("playtest integration baseline", () => {
  it.each([
    ["warrior", 2, 1, 10, 2, 2, 1, 1, null],
    ["archer", 3, 1, 10, 2, 1, 1, 2, "archery"],
    ["rider", 3, 1, 10, 2, 1, 2, 1, "riding"],
    ["swordsman", 5, 2, 15, 3, 3, 1, 1, "smithery"],
    ["sailor", 5, 1, 10, 2, 1, 3, 2, "sailing"],
  ] as const)("defines %s stats and unlock centrally", (id, goldCost, populationCost, maxHp, attack, defense, maxMovement, range, requiredTechnology) => {
    expect(getUnitDefinition(id)).toMatchObject({ goldCost, populationCost, maxHp, attack, defense, maxMovement, range, requiredTechnology });
  });

  it.each([1, 2, 3])("prices every tier for %i owned Town Halls", count => {
    const state = fixture();
    state.cities = Array.from({ length: count }, (_, i) => ({ ...state.cities[0], id: `owned-${i}`, x: i }));
    for (const [technology, tier] of [["climbing", 1], ["riding", 1], ["archery", 2], ["mining", 2], ["roads", 2], ["sailing", 2], ["smithery", 3]] as const) {
      expect(getTechnologyCost(state, "player-1", technology)).toBe(4 + tier * count);
    }
  });

  it("recalculates price after ownership gains and losses and rejects insufficient funds atomically", () => {
    const state = fixture();
    expect(getTechnologyCost(state, "player-1", "archery")).toBe(6);
    state.cities[1].ownerId = "player-1";
    expect(getTechnologyCost(state, "player-1", "archery")).toBe(8);
    state.players[0].resources.gold = 6;
    const before = structuredClone(state);
    expect(() => applyAction(state, { type: "UNLOCK_TECHNOLOGY", playerId: "player-1", technologyId: "archery" })).toThrow("Not enough Gold");
    expect(state).toEqual(before);
    state.cities[1].ownerId = "player-2";
    const next = applyAction(state, { type: "UNLOCK_TECHNOLOGY", playerId: "player-1", technologyId: "archery" });
    expect(next.players[0].resources.gold).toBe(0);
  });

  it("builds friendly and neutral roads without claiming territory and rejects duplicate spending", () => {
    const state = fixture();
    const friendly = road(state, 1);
    const neutral = road(friendly, 4);
    expect(neutral.players[0].resources.gold).toBe(44);
    expect(neutral.cities).toEqual(state.cities);
    expect(getTile(neutral, 1, 2)?.road).toBe(true);
    expect(getTile(neutral, 4, 2)?.road).toBe(true);
    const before = structuredClone(neutral);
    expect(() => road(neutral, 4)).toThrow("Already road-connected");
    expect(neutral).toEqual(before);
    expect(getTile(state, 1, 2)?.road).toBeUndefined();
  });

  it.each([
    ["locked", (s: GameState) => { s.players[0].technologies = []; }, 1, 2, "Requires Roads"],
    ["turn", (s: GameState) => { s.activePlayerId = "player-2"; }, 1, 2, "Not your turn"],
    ["enemy", (_: GameState) => {}, 8, 2, "Enemy-controlled"],
    ["mountain", (s: GameState) => { getTile(s, 1, 2)!.terrain = "mountain"; s.players[0].technologies.push("climbing"); }, 1, 2, "traversable land"],
    ["water", (s: GameState) => { getTile(s, 1, 2)!.terrain = "water"; }, 1, 2, "traversable land"],
    ["gold", (s: GameState) => { s.players[0].resources.gold = 2; }, 1, 2, "Not enough Gold"],
    ["city", (_: GameState) => {}, 0, 2, "Already road-connected"],
    ["outside", (_: GameState) => {}, 10, 2, "Invalid tile"],
    ["fraction", (_: GameState) => {}, 1.5, 2, "Invalid tile"],
    ["missing", (s: GameState) => { s.tiles = s.tiles.filter(tile => tile.x !== 1 || tile.y !== 2); }, 1, 2, "Invalid tile"],
  ] as const)("rejects %s roads without mutation", (_, mutate, x, y, reason) => {
    const state = fixture();
    mutate(state);
    const before = structuredClone(state);
    expect(getRoadBuildingReason(state, "player-1", { x, y })).toContain(reason);
    expect(() => road(state, x, y)).toThrow(reason);
    expect(state).toEqual(before);
  });

  it("spends exactly half-points on connected roads including Town Hall endpoints", () => {
    let state = fixture();
    for (let x = 1; x <= 4; x++) state = road(state, x);
    const reachable = getReachableTiles(state, "warrior-1");
    expect(reachable.find(tile => tile.x === 4 && tile.y === 2)).toMatchObject({ cost: 2 });
    expect(reachable.some(tile => tile.x === 5 && tile.y === 2)).toBe(false);
    state = applyAction(state, { type: "move", playerId: "player-1", unitId: "warrior-1", to: { x: 1, y: 2 } });
    expect(state.units[0].movement).toBe(1.5);
    state = applyAction(state, { type: "move", playerId: "player-1", unitId: "warrior-1", to: { x: 4, y: 2 } });
    expect(state.units[0].movement).toBe(0);
    expect(getReachableTiles(state, "warrior-1")).toEqual([]);
    state = end(end(state));
    expect(state.units[0].movement).toBe(2);
    state.cities.push({ id: "endpoint", x: 5, y: 2, ownerId: "player-1", townHallLevel: 1 });
    expect(getMovementCost(state, state.units[0], { x: 4, y: 2 }, getTile(state, 5, 2)!)).toBe(0.5);
  });

  it("uses default costs for disconnected roads and shared roads for either owner", () => {
    const state = road(fixture(), 4);
    const tile = getTile(state, 4, 2)!;
    expect(getMovementCost(state, state.units[0], { x: 3, y: 2 }, tile)).toBe(1);
    expect(getReachableTiles(fixture(), "warrior-1").find(tile => tile.x === 2 && tile.y === 2)?.cost).toBe(2);
    getTile(state, 3, 2)!.road = true;
    state.units[0].ownerId = "player-2";
    state.units[0].x = 3;
    state.activePlayerId = "player-2";
    expect(getReachableTiles(state, "warrior-1").find(tile => tile.x === 4 && tile.y === 2)?.cost).toBe(0.5);
  });

  it("embarks an existing unit, traverses enemy water and collects Fish once", () => {
    let state = fixture();
    state.units = state.units.filter(unit => !unit.id.startsWith("observer-"));
    state.cities[0].x = 6;
    state.units[0].x = 6;
    for (let x = 6; x <= 9; x++) getTile(state, x, 1)!.terrain = "water";
    getTile(state, 9, 1)!.resource = "fishery";
    state = applyAction(state, { type: "BUILD_PORT", playerId: "player-1", to: { x: 6, y: 1 } });
    expect(state.players[0].resources.gold).toBe(43);
    state = applyAction(state, { type: "move", playerId: "player-1", unitId: "warrior-1", to: { x: 6, y: 1 } });
    expect(state.units[0]).toMatchObject({ unitType: "rider", embarked: true, movement: 0, maxMovement: 2 });
    expect(getPlayerPopulation(state, "player-1").used).toBe(1);
    state = end(end(state));
    state = applyAction(state, { type: "move", playerId: "player-1", unitId: "warrior-1", to: { x: 8, y: 1 } });
    state = end(end(state));
    const gold = state.players[0].resources.gold;
    state = applyAction(state, { type: "move", playerId: "player-1", unitId: "warrior-1", to: { x: 9, y: 1 } });
    expect(state.players[0].resources.gold).toBe(gold + 2);
    expect(getTile(state, 9, 1)?.resource).toBeUndefined();
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});
