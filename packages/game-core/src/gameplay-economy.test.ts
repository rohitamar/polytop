import { describe, expect, it } from "vitest";
import { applyAction, canUnitEnterTerrain, createGame, economy, getPlayerPopulation, getReachableTiles, getRecruitSpawn, getTile, previewCombat, resourceDefinitions, unitDefinitions, type GameState, type Opportunity, type TechnologyId } from "./index";

function fixture() {
  const state = createGame("fern-104", 2, { scenario: "demo" });
  state.players[0].resources.gold = 30;
  state.tiles.forEach(tile => delete tile.resource);
  for (const [x, y] of [[4, 4], [5, 5], [4, 6], [3, 5]]) getTile(state, x, y)!.terrain = "grass";
  return state;
}
const move = (state: GameState, x = 5, y = 5) => applyAction(state, { type: "move", playerId: "player-1", unitId: "warrior-1", to: { x, y } });
const end = (state: GameState) => applyAction(state, { type: "END_TURN", playerId: state.activePlayerId });
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

describe("terrain, collection and naval economy", () => {
  it.each<Opportunity>(["orchard", "wheat", "forest"])("collects %s once at the destination and only credits its owner", resource => {
    const state = fixture();
    getTile(state, 5, 5)!.resource = resource;
    if (resource === "forest") getTile(state, 5, 5)!.terrain = "forest";
    const before = structuredClone(state);
    const next = move(freeze(state));
    expect(next.players[0].resources).toEqual({ gold: 30 + resourceDefinitions[resource].goldReward });
    expect(next.players[1]).toEqual(state.players[1]);
    expect(getTile(next, 5, 5)!.resource).toBeUndefined();
    expect(getTile(JSON.parse(JSON.stringify(next)), 5, 5)!.resource).toBeUndefined();
    expect(() => move(next)).toThrow("Unreachable");
    expect(state).toEqual(before);
    const returned = move(end(end(next)), 4, 5);
    expect(move(end(end(returned))).players[0].resources.gold).toBe(returned.players[0].resources.gold + economy.goldIncome[0] * 2);
  });

  it("collects the destination only, leaving resources crossed along the accepted path", () => {
    const state = fixture();
    getTile(state, 5, 5)!.resource = "wheat";
    getTile(state, 6, 5)!.terrain = "grass";
    getTile(state, 6, 5)!.resource = "orchard";
    state.units[0].movement = 2;
    const next = move(state, 6, 5);
    expect(getTile(next, 5, 5)!.resource).toBe("wheat");
    expect(getTile(next, 6, 5)!.resource).toBeUndefined();
    expect(next.players[0].resources.gold).toBe(32);
  });

  it.each(unitDefinitions.filter(unit => unit.domain === "land"))("centralizes mountain and Water access for $name", definition => {
    const state = fixture();
    const unit = { ...state.units[0], unitType: definition.id };
    expect(canUnitEnterTerrain(state, "player-1", unit, "grass")).toBe(true);
    expect(canUnitEnterTerrain(state, "player-1", unit, "mountain")).toBe(false);
    state.players[0].technologies = ["climbing", "sailing"];
    expect(canUnitEnterTerrain(state, "player-1", unit, "mountain")).toBe(true);
    expect(canUnitEnterTerrain(state, "player-1", unit, "water")).toBe(false);
    expect(canUnitEnterTerrain(state, "player-2", unit, "mountain")).toBe(false);
  });

  it.each<{ technologies: TechnologyId[]; enters: boolean; collects: boolean }>([
    { technologies: [], enters: false, collects: false },
    { technologies: ["climbing"], enters: true, collects: false },
    { technologies: ["climbing", "mining"], enters: true, collects: true },
  ])("separates mountain access from mineral exploitation: $technologies", ({ technologies, enters, collects }) => {
    const state = fixture();
    state.players[0].technologies = technologies;
    const tile = getTile(state, 5, 5)!;
    tile.terrain = "mountain"; tile.resource = "mine";
    const before = structuredClone(state);
    expect(getReachableTiles(state, "warrior-1").some(tile => tile.x === 5 && tile.y === 5)).toBe(enters);
    if (!enters) expect(() => move(freeze(state))).toThrow("Unreachable");
    else {
      const next = move(freeze(state));
      expect(next.players[0].resources).toEqual({ gold: 30 + (collects ? 3 : 0) });
      expect(getTile(next, 5, 5)!.resource).toBe(collects ? undefined : "mine");
    }
    expect(state).toEqual(before);
  });

  it("Mining requires Climbing and collects deposits under existing units when purchased", () => {
    let state = fixture();
    expect(() => applyAction(state, { type: "UNLOCK_TECHNOLOGY", playerId: "player-1", technologyId: "mining" })).toThrow("Requires Climbing");
    state.players[0].technologies = ["climbing"];
    getTile(state, 5, 5)!.terrain = "mountain";
    getTile(state, 5, 5)!.resource = "mine";
    state = move(state);
    const next = applyAction(freeze(state), { type: "UNLOCK_TECHNOLOGY", playerId: "player-1", technologyId: "mining" });
    expect(next.players[0].resources).toEqual({ gold: 25 });
    expect(next.players[0].technologies).toEqual(["climbing", "mining"]);
    expect(next.players[1].technologies).toEqual([]);
    expect(getTile(next, 5, 5)!.resource).toBeUndefined();
  });

  it("rejects land movement onto Water even after Sailing", () => {
    const state = fixture();
    state.players[0].technologies = ["sailing"];
    getTile(state, 5, 5)!.terrain = "water";
    getTile(state, 5, 5)!.resource = "fishery";
    const before = structuredClone(state);
    expect(() => move(freeze(state))).toThrow("Unreachable");
    expect(state).toEqual(before);
  });

  it("rejects direct Sailor recruitment in favor of Ports", () => {
    const state = fixture();
    state.players[0].technologies = ["sailing"];
    getTile(state, 4, 4)!.terrain = "water";
    expect(() => applyAction(state, { type: "RECRUIT_UNIT", playerId: "player-1", cityId: "city-1", unitType: "sailor" })).toThrow("Build a Port");
  });

  it.each(["noncoastal", "occupied", "gold", "population", "foreign", "inactive"])("rejects invalid Sailor recruitment: %s", reason => {
    const state = fixture();
    state.players[0].technologies = ["sailing"];
    if (reason !== "noncoastal") getTile(state, 4, 4)!.terrain = "water";
    if (reason === "occupied") state.units[0] = { ...state.units[0], x: 4, y: 4 };
    if (reason === "gold") state.players[0].resources.gold = 0;
    if (reason === "population") state.units[0].populationCost = 3;
    if (reason === "foreign") state.cities[0].ownerId = "player-2";
    if (reason === "inactive") state.activePlayerId = "player-2";
    const before = structuredClone(state);
    expect(() => applyAction(freeze(state), { type: "RECRUIT_UNIT", playerId: "player-1", cityId: "city-1", unitType: "sailor" })).toThrow();
    expect(state).toEqual(before);
  });

  it("chooses available adjacent Water deterministically and never arbitrary Water", () => {
    const state = fixture();
    state.players[0].technologies = ["sailing"];
    getTile(state, 4, 4)!.terrain = "water";
    getTile(state, 5, 5)!.terrain = "water";
    state.units[0] = { ...state.units[0], x: 4, y: 4 };
    expect(getRecruitSpawn(state, "city-1", "sailor")).toEqual({ x: 5, y: 5 });
    state.units[1] = { ...state.units[1], x: 5, y: 5 };
    getTile(state, 7, 5)!.terrain = "water";
    expect(getRecruitSpawn(state, "city-1", "sailor")).toBeNull();
  });

  it("Sailors use existing combat, retaliation, death, advance and collection", () => {
    const state = fixture();
    state.units[0] = { ...state.units[0], unitType: "sailor", x: 4, y: 4 };
    state.units[1] = { ...state.units[1], unitType: "sailor", x: 5, y: 4, hp: 1 };
    getTile(state, 4, 4)!.terrain = "water";
    getTile(state, 5, 4)!.terrain = "water";
    getTile(state, 5, 4)!.resource = "fishery";
    expect(previewCombat(state, "warrior-1", "warrior-2").advance).toEqual({ x: 5, y: 4 });
    const next = applyAction(freeze(state), { type: "ATTACK_UNIT", playerId: "player-1", unitId: "warrior-1", targetId: "warrior-2" });
    expect(next.units).toHaveLength(1);
    expect(next.units[0]).toMatchObject({ x: 5, y: 4, movement: 0, hasAttacked: true });
    expect(next.players[0].resources.gold).toBe(32);
    expect(getTile(next, 5, 4)!.resource).toBeUndefined();
    expect(getPlayerPopulation(next, "player-2").used).toBe(0);
  });

  it("combat cannot advance land units into Water or Sailors onto land", () => {
    const state = fixture();
    state.units[1] = { ...state.units[1], x: 5, y: 5, hp: 1 };
    getTile(state, 5, 5)!.terrain = "water";
    expect(previewCombat(state, "warrior-1", "warrior-2").advance).toBeNull();
    state.units[0].unitType = "sailor";
    getTile(state, 5, 5)!.terrain = "grass";
    expect(previewCombat(state, "warrior-1", "warrior-2").advance).toBeNull();
  });
  it("Sailors use normal damage and retaliation without a separate naval combat system", () => {
    const state = fixture();
    state.units[0] = { ...state.units[0], unitType: "sailor", x: 4, y: 4 };
    state.units[1] = { ...state.units[1], unitType: "sailor", x: 5, y: 4 };
    getTile(state, 4, 4)!.terrain = "water";
    getTile(state, 5, 4)!.terrain = "water";
    const next = applyAction(state, { type: "ATTACK_UNIT", playerId: "player-1", unitId: "warrior-1", targetId: "warrior-2" });
    expect(next.units[0]).toMatchObject({ hp: 7, movement: 0, hasAttacked: true, x: 4, y: 4 });
    expect(next.units[1]).toMatchObject({ hp: 5, x: 5, y: 4 });
  });

});
