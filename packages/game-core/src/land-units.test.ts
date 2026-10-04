import { describe, expect, it } from "vitest";
import { applyAction, createGame, fullRuleset, getAttackTargets, getDefenseBonus, getGiantRewardReason, getPlayerView, getReachableTiles, getRecruitmentReason, getUnitDefinition, type GameAction, type GameState, type UnitType } from "./index";
import { getUnitStats } from "./units";

const roster = [
  ["warrior", 2, 10, 2, 2, 1, 1, null, ["DASH", "FORTIFY"]],
  ["rider", 3, 10, 2, 1, 2, 1, "riding", ["DASH", "ESCAPE", "FORTIFY"]],
  ["archer", 3, 10, 2, 1, 1, 2, "archery", ["DASH", "FORTIFY"]],
  ["defender", 3, 15, 1, 3, 1, 1, "strategy", ["FORTIFY"]],
  ["swordsman", 5, 15, 3, 3, 1, 1, "smithery", ["DASH"]],
  ["catapult", 8, 10, 4, 0, 1, 3, "mathematics", ["STIFF"]],
  ["giant", null, 40, 5, 4, 1, 1, null, ["STATIC"]],
] as const;
function fixture(type: UnitType = "rider") {
  const state = createGame("fern-104", 2, { scenario: "demo" });
  state.tiles = state.tiles.map(tile => ({ x: tile.x, y: tile.y, terrain: "grass" }));
  state.units[0] = { ...state.units[0], ...getUnitStats(type), x: 4, y: 5, movement: getUnitDefinition(type)!.maxMovement, hp: getUnitDefinition(type)!.maxHp };
  state.units[1] = { ...state.units[1], x: 7, y: 5 };
  state.players[0].resources.gold = 100;
  return state;
}
const move = (state: GameState, x: number, y = 5) => applyAction(state, { type: "move", playerId: "player-1", unitId: "warrior-1", to: { x, y } });
const attack: GameAction = { type: "ATTACK_UNIT", playerId: "player-1", unitId: "warrior-1", targetId: "warrior-2" };
const end = (state: GameState) => applyAction(state, { type: "END_TURN", playerId: state.activePlayerId });

describe("core land roster", () => {
  it.each(roster)("defines %s centrally", (id, goldCost, maxHp, attack, defense, maxMovement, range, requiredTechnology, abilities) => {
    expect(getUnitDefinition(id)).toMatchObject({ goldCost, maxHp, attack, defense, maxMovement, range, requiredTechnology, abilities, recruitable: id !== "giant", domain: "land" });
  });
  it.each(roster)("gates %s recruitment authoritatively", (id, cost, hp, atk, def, movement, range, technology) => {
    const state = fixture();
    state.units[0].x = 3;
    const action: GameAction = { type: "RECRUIT_UNIT", playerId: "player-1", cityId: "city-1", unitType: id };
    if (id === "giant") {
      expect(() => applyAction(state, action)).toThrow("reward");
      return;
    }
    if (technology) {
      const before = structuredClone(state);
      expect(() => applyAction(state, action)).toThrow("Requires");
      expect(state).toEqual(before);
      state.players[0].technologies.push(technology);
    }
    const next = applyAction(state, action);
    expect(next.players[0].resources.gold).toBe(100 - cost!);
    expect(next.units.at(-1)).toMatchObject({ unitType: id, hp, attack: atk, defense: def, maxMovement: movement, range, actionPhase: "complete" });
  });
  it.each(roster)("applies Dash for %s", (id, cost, hp, atk, def, movement, range, tech, abilities) => {
    const state = fixture(id);
    state.units[1].x = 6;
    const moved = move(state, 5);
    if ((abilities as readonly string[]).includes("DASH")) expect(applyAction(moved, attack).units[0].hasAttacked).toBe(true);
    else {
      const before = structuredClone(moved);
      expect(getAttackTargets(moved, "warrior-1")).toEqual([]);
      expect(() => applyAction(moved, attack)).toThrow();
      expect(moved).toEqual(before);
    }
  });
  it("supports move attack Escape exactly once and resets on handoff", () => {
    const moved = move(fixture(), 6);
    expect(moved.units[0].movement).toBe(0);
    const fought = applyAction(moved, attack);
    expect(fought.units[0]).toMatchObject({ movement: 2, hasAttacked: true, actionPhase: "escape" });
    expect(getAttackTargets(fought, "warrior-1")).toEqual([]);
    expect(() => applyAction(fought, attack)).toThrow();
    const escaped = move(fought, 4);
    expect(escaped.units[0]).toMatchObject({ movement: 0, actionPhase: "complete" });
    expect(() => move(escaped, 5)).toThrow();
    expect(() => applyAction(escaped, attack)).toThrow();
    const reset = end(end(escaped));
    expect(reset.units[0]).toMatchObject({ movement: 2, hasAttacked: false, actionPhase: "ready" });
    expect(end(end(fought)).units[0].actionPhase).toBe("ready");
    const shortEscape = move(fought, 5);
    expect(() => move(shortEscape, 4)).toThrow();
  });
  it("preserves Escape across serialized player views without granting authority", () => {
    const fought = applyAction(move(fixture(), 6), attack);
    const view = JSON.parse(JSON.stringify(getPlayerView(fought, "player-1"))) as GameState;
    expect(view.units[0].actionPhase).toBe("escape");
    expect(getReachableTiles(view, "warrior-1")).toContainEqual(expect.objectContaining({ x: 4, y: 5 }));
    expect(() => move(view, 4)).toThrow("authoritative");
  });
  it("checks roads, terrain, bounds and occupancy during Escape", () => {
    const fought = applyAction(move(fixture(), 6), attack);
    fought.tiles.find(tile => tile.x === 5 && tile.y === 5)!.terrain = "water";
    expect(() => move(fought, 4)).toThrow();
    expect(() => move(fought, 7)).toThrow();
    expect(() => move(fought, -1)).toThrow();
    expect(() => move(fought, 6, 8)).toThrow();
    fought.tiles.find(tile => tile.x === 5 && tile.y === 5)!.terrain = "mountain";
    expect(() => move(fought, 5)).toThrow();
    fought.tiles = fought.tiles.map(tile => ({ ...tile, terrain: "grass", road: true }));
    expect(move(fought, 2).units[0].x).toBe(2);
  });
  it("does not grant Escape without the enabled ability", () => {
    const state = fixture();
    state.rules = { ...fullRuleset, enabledUnitAbilities: ["DASH"] };
    const spent = applyAction(move(state, 6), attack);
    expect(getReachableTiles(spent, "warrior-1")).toEqual([]);
    expect(() => move(spent, 4)).toThrow();
    const warrior = fixture("warrior");
    warrior.units[1].x = 5;
    expect(() => move(applyAction(warrior, attack), 3)).toThrow();
  });
  it("grants Escape after a kill advance but removes a killed attacker", () => {
    const state = fixture();
    state.units[1].hp = 1;
    const advanced = applyAction(move(state, 6), attack);
    expect(advanced.units[0]).toMatchObject({ x: 7, movement: 2, actionPhase: "escape" });
    expect(move(advanced, 5).units[0].x).toBe(5);
    state.units[1].hp = 10;
    state.units[0].hp = 1;
    expect(applyAction(move(state, 6), attack).units.some(unit => unit.id === "warrior-1")).toBe(false);
  });
  it("prevents Stiff retaliation and respects ability toggles", () => {
    const state = fixture("defender");
    state.units[1] = { ...state.units[1], ...getUnitStats("catapult"), x: 5, hp: 10 };
    const next = applyAction(state, attack);
    expect(next.units[0].hp).toBe(15);
    state.rules = { ...fullRuleset, enabledUnitAbilities: [] };
    expect(applyAction(state, attack).units[0].hp).toBeLessThan(15);
  });
  it.each(roster)("applies friendly city Fortify only for %s", (id, cost, hp, atk, def, movement, range, tech, abilities) => {
    const state = fixture(id);
    expect(getDefenseBonus(state, state.units[0])).toBe((abilities as readonly string[]).includes("FORTIFY") ? 1.5 : 1);
    state.rules = { ...fullRuleset, enabledUnitAbilities: [] };
    expect(getDefenseBonus(state, state.units[0])).toBe(1);
    state.rules = fullRuleset;
    state.cities[0].ownerId = "player-2";
    expect(getDefenseBonus(state, state.units[0])).toBe(1);
  });
  it.each(["archer", "catapult"] as const)("uses %s range and visible targets only", type => {
    const state = fixture(type);
    const range = getUnitDefinition(type)!.range;
    state.units[1].x = 4 + range;
    state.cities[0].x = 5;
    const next = applyAction(state, attack);
    expect(next.units[0].hp).toBe(state.units[0].hp);
    state.cities = [];
    expect(getAttackTargets(state, "warrior-1")).toEqual([]);
    state.cities = [{ id: "spotter", ownerId: "player-1", x: 5, y: 5, townHallLevel: 1 }];
    state.units[1].x = 5 + range;
    expect(() => applyAction(state, attack)).toThrow();
  });
  it("disables unit actions and recruitment in simulation rules", () => {
    const state = fixture();
    state.rules = { ...fullRuleset, enabledUnitTypes: ["warrior"] };
    expect(getRecruitmentReason(state, "player-1", "city-1", "rider")).toContain("disabled");
    expect(getReachableTiles(state, "warrior-1")).toEqual([]);
    expect(getAttackTargets(state, "warrior-1")).toEqual([]);
    expect(() => move(state, 5)).toThrow("disabled");
    state.units[0].unitType = "warrior";
    state.rules.enabledUnitAbilities = [];
    state.units[1].x = 6;
    expect(() => applyAction(move(state, 5), attack)).toThrow();
  });
  it("grants a single Giant at the maximum city upgrade without displacement or Gold recruitment", () => {
    let state = fixture();
    const upgrade: GameAction = { type: "UPGRADE_TOWN_HALL", playerId: "player-1", cityId: "city-1" };
    state = applyAction(applyAction(state, upgrade), upgrade);
    expect(state.cities[0].giantReward).toBe("available");
    const claim: GameAction = { type: "CLAIM_GIANT", playerId: "player-1", cityId: "city-1" };
    expect(() => applyAction(state, claim)).toThrow("empty");
    state.units[0].x = 3;
    const before = structuredClone(state);
    const next = applyAction(state, claim);
    expect(next.players).toEqual(before.players);
    expect(next.cities[0]).toMatchObject({ ownerId: "player-1", giantReward: "claimed" });
    expect(next.units.at(-1)).toMatchObject({ unitType: "giant", hp: 40, x: 4, y: 5, actionPhase: "complete" });
    expect(() => applyAction(next, claim)).toThrow("No super-unit");
    expect(state).toEqual(before);
    state.rules = { ...fullRuleset, enabledUnitTypes: ["warrior"] };
    expect(getGiantRewardReason(state, "player-1", "city-1")).toContain("disabled");
  });
});
