import { describe, expect, it } from "vitest";
import { applyAction, canRecruitUnit, createGame, getAttackTargets, getPlayerPopulation, getReachableTiles, getRecruitmentReason, getTile, getUnitDefinition, unitDefinitions, type GameAction, type GameState } from "./index";

const recruit: GameAction = { type: "RECRUIT_UNIT", playerId: "player-1", cityId: "city-1", unitType: "warrior" };
const end = (state: GameState) => applyAction(state, { type: "END_TURN", playerId: state.activePlayerId });
function fixture() {
  const state = createGame("fern-104", 2, { scenario: "demo" });
  state.units[0].x = 3;
  getTile(state, 4, 4)!.terrain = "water";
  state.players[0].resources.gold = 10;
  state.players[0].technologies = ["archery", "smithery", "riding", "sailing", "strategy", "mathematics"];
  return state;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

describe("recruitment", () => {
  it.each(unitDefinitions.filter(definition => definition.domain === "land" && definition.recruitable))("recruits $name atomically from centralized definitions", definition => {
    const state = freeze(fixture());
    const before = structuredClone(state);
    const next = applyAction(state, { ...recruit, unitType: definition.id });
    expect(next.revision).toBe(state.revision + 1);
    expect(next.players[0].resources.gold).toBe(10 - definition.goldCost!);
    expect(next.units.at(-1)).toMatchObject({ unitType: definition.id, x: 4, y: 5, homeCityId: "city-1", ownerId: "player-1", populationCost: definition.populationCost, hp: definition.maxHp, maxMovement: definition.maxMovement, attack: definition.attack, defense: definition.defense, range: definition.range, movement: 0, hasAttacked: true });
    expect(getPlayerPopulation(next, "player-1")).toMatchObject({ used: 1 + definition.populationCost, capacity: 2, available: 1 - definition.populationCost });
    expect(state).toEqual(before);
    expect(next.players[1]).toEqual(state.players[1]);
    expect(next.cities).toEqual(state.cities);
    expect(applyAction(state, { ...recruit, unitType: definition.id })).toEqual(next);
  });

  it.each([
    ["inactive player", (s: GameState) => { s.activePlayerId = "player-2"; }, "Not your turn"],
    ["foreign city", (s: GameState) => { s.cities[0].ownerId = "player-2"; }, "Not your city"],
    ["neutral city", (s: GameState) => { s.cities[0].ownerId = null; }, "Not your city"],
    ["unknown city", (s: GameState) => { s.cities[0].id = "other"; }, "Not your city"],
    ["gold", (s: GameState) => { s.players[0].resources.gold = 1; }, "Not enough Gold"],
    ["population", (s: GameState) => { s.units.push({ ...s.units[0], id: "second" }); }, "City unit capacity reached"],
    ["occupied city", (s: GameState) => { s.units[0].x = 4; }, "City spawn tile"],
    ["water", (s: GameState) => { getTile(s, 4, 5)!.terrain = "water"; }, "City spawn tile"],
    ["mountain", (s: GameState) => { getTile(s, 4, 5)!.terrain = "mountain"; }, "City spawn tile"],
    ["missing tile", (s: GameState) => { s.tiles = s.tiles.filter(t => t.x !== 4 || t.y !== 5); }, "City spawn tile"],
  ] as const)("rejects %s without any mutation", (_, mutate, reason) => {
    const state = fixture();
    mutate(state);
    const before = structuredClone(state);
    freeze(state);
    expect(canRecruitUnit(state, "player-1", "city-1", "warrior")).toBe(false);
    expect(() => applyAction(state, recruit)).toThrow(reason);
    expect(state).toEqual(before);
  });

  it("enforces technology and rejects unknown types at the rule boundary", () => {
    const state = fixture();
    state.players[0].technologies = [];
    for (const unitType of ["archer", "swordsman", "rider"] as const) {
      const before = structuredClone(state);
      expect(() => applyAction(state, { ...recruit, unitType })).toThrow("Requires");
      expect(state).toEqual(before);
    }
    expect(canRecruitUnit(state, "player-1", "city-1", "warrior")).toBe(true);
    expect(getRecruitmentReason(state, "player-1", "city-1", "dragon")).toBe("Unknown unit type");
    expect(getUnitDefinition("dragon")).toBeUndefined();
    expect(() => applyAction(state, { ...recruit, unitType: "dragon" } as unknown as GameAction)).toThrow("Unknown unit type");
  });

  it("blocks recruited movement and combat until the next owner turn", () => {
    let state = applyAction(fixture(), { ...recruit, unitType: "archer" });
    const id = state.units.at(-1)!.id;
    state.units[1] = { ...state.units[1], x: 6, y: 5 };
    expect(getReachableTiles(state, id)).toEqual([]);
    expect(getAttackTargets(state, id)).toEqual([]);
    expect(() => applyAction(state, { type: "move", playerId: "player-1", unitId: id, to: { x: 4, y: 6 } })).toThrow("finished acting");
    expect(() => applyAction(state, { type: "ATTACK_UNIT", playerId: "player-1", unitId: id, targetId: "warrior-2" })).toThrow("finished acting");
    state = end(state);
    expect(state.units.find(u => u.id === id)).toMatchObject({ movement: 0, hasAttacked: true });
    state = end(state);
    expect(state.units.find(u => u.id === id)).toMatchObject({ movement: 1, hasAttacked: false });
    expect(getReachableTiles(state, id).length).toBeGreaterThan(0);
    const next = applyAction(state, { type: "ATTACK_UNIT", playerId: "player-1", unitId: id, targetId: "warrior-2" });
    expect(next.units.find(u => u.id === "warrior-2")!.hp).toBeLessThan(10);
    expect(next.units.find(u => u.id === id)!.hp).toBe(10);
  });

  it("uses existing death accounting for recruited military population", () => {
    let state = applyAction(fixture(), { ...recruit, unitType: "swordsman" });
    const id = state.units.at(-1)!.id;
    state.units[1] = { ...state.units[1], x: 5, y: 5, attack: 100 };
    state = end(state);
    state = applyAction(state, { type: "ATTACK_UNIT", playerId: "player-2", unitId: "warrior-2", targetId: id });
    expect(state.units.some(u => u.id === id)).toBe(false);
    expect(getPlayerPopulation(state, "player-1")).toMatchObject({ used: 0, capacity: 0, available: 0 });
  });
});
