import { describe, expect, it } from "vitest";
import { applyAction, createGame, getAttackTargets, getReachableTiles, getTile, getUnitStats, getUnitDefinition, previewCombat, fullRuleset, type GameState, type UnitType } from "./index";
const end = (state: GameState) => applyAction(state, { type: "END_TURN", playerId: state.activePlayerId });
function fixture(type: UnitType = "raft") {
  const state = createGame("fern-104", 2, { scenario: "demo" });
  state.cities = [{ ...state.cities[0], x: 4, y: 4 }];
  state.tiles.forEach(tile => { tile.terrain = "water"; delete tile.resource; });
  state.players[0].technologies = ["fishing", "sailing", "navigation", "ramming"];
  state.players[0].resources.gold = 50;
  state.units[0] = { ...state.units[0], ...getUnitStats(type), x: 4, y: 5, carriedUnitType: "defender", embarked: true, hp: 15, maxHp: 15, movement: getUnitStats(type).maxMovement };
  state.units[1] = { ...state.units[1], x: 5, y: 5, hp: 15, maxHp: 15 };
  return state;
}
describe("naval mechanics", () => {
  it.each([
    ["raft", null, 0, 1, 2, 0, "fishing", ["STIFF", "STATIC"]],
    ["scout", 5, 2, 1, 3, 2, "sailing", ["DASH", "STATIC"]],
    ["rammer", 5, 3, 3, 3, 1, "ramming", ["DASH", "STATIC"]],
    ["bomber", 15, 3, 2, 2, 3, "navigation", ["SPLASH", "STIFF", "STATIC"]],
    ["juggernaut", null, 4, 4, 2, 1, "fishing", ["STOMP", "STIFF", "STATIC"]],
  ] as const)("defines %s costs, stats, technology and abilities centrally", (type, goldCost, attack, defense, maxMovement, range, requiredTechnology, abilities) => {
    expect(getUnitDefinition(type)).toMatchObject({ domain: "naval", recruitable: false, goldCost, attack, defense, maxMovement, range, requiredTechnology, abilities });
  });
  it("disabled area abilities preserve ordinary attacks and movement without secondary damage", () => {
    const state = fixture("bomber"); state.units[1].x = 6;
    state.units.push({ ...state.units[1], id: "splash", x: 6, y: 4 }, { ...state.units[1], id: "observer", ownerId: "player-1", x: 6, y: 6 });
    state.rules = { ...fullRuleset, enabledUnitAbilities: fullRuleset.enabledUnitAbilities.filter(ability => ability !== "SPLASH" && ability !== "STOMP") };
    const attacked = applyAction(state, { type: "ATTACK_UNIT", playerId: "player-1", unitId: "warrior-1", targetId: "warrior-2" });
    expect(attacked.units.find(unit => unit.id === "splash")!.hp).toBe(15);
    state.units[0] = { ...state.units[0], ...getUnitStats("juggernaut") };
    const moved = applyAction(state, { type: "move", playerId: "player-1", unitId: "warrior-1", to: { x: 5, y: 4 } });
    expect(moved.units.find(unit => unit.id === "splash")!.hp).toBe(15);
  });
  it("disabled carried land types cannot be restored through landing", () => {
    const state = fixture(); getTile(state, 3, 5)!.terrain = "grass";
    state.rules = { ...fullRuleset, enabledUnitTypes: fullRuleset.enabledUnitTypes.filter(type => type !== "defender") };
    const before = structuredClone(state);
    expect(() => applyAction(state, { type: "move", playerId: "player-1", unitId: "warrior-1", to: { x: 3, y: 5 } })).toThrow();
    expect(state).toEqual(before);
  });
  it("unarmed Rafts cannot retaliate even when Stiff is disabled", () => {
    const state = fixture(); state.rules = { ...fullRuleset, enabledUnitAbilities: [] };
    expect(previewCombat(end(state), "warrior-2", "warrior-1").retaliation).toBe(0);
  });
  it.each(["scout", "rammer", "bomber"] as const)("upgrades a Raft into %s authoritatively without healing or replacing cargo", type => {
    const state = fixture(); state.units[0].hp = 8;
    const next = applyAction(state, { type: "UPGRADE_NAVAL", playerId: "player-1", unitId: "warrior-1", unitType: type });
    expect(next.units[0]).toMatchObject({ unitType: type, hp: 8, maxHp: 15, carriedUnitType: "defender", actionPhase: "complete" });
    expect(next.players[0].resources.gold).toBe(type === "bomber" ? 35 : 45);
    expect(() => applyAction(next, { type: "UPGRADE_NAVAL", playerId: "player-1", unitId: "warrior-1", unitType: type })).toThrow();
    expect(state.units[0].unitType).toBe("raft");
  });
  it.each(["technology", "gold", "foreign", "spent", "disabled", "wrong-type"])("rejects %s upgrade atomically", reason => {
    const state = fixture();
    if (reason === "technology") state.players[0].technologies = ["fishing"];
    if (reason === "gold") state.players[0].resources.gold = 0;
    if (reason === "foreign") state.cities[0].ownerId = "player-2";
    if (reason === "spent") state.units[0].actionPhase = "moved";
    if (reason === "disabled") state.rules = { ...fullRuleset, enabledUnitTypes: ["raft"] };
    const before = structuredClone(state);
    expect(() => applyAction(state, { type: "UPGRADE_NAVAL", playerId: "player-1", unitId: "warrior-1", unitType: reason === "wrong-type" ? "warrior" : "scout" })).toThrow();
    expect(state).toEqual(before);
  });
  it("deep ocean requires Sailing", () => {
    const state = fixture(); state.players[0].technologies = ["fishing"];
    getTile(state, 3, 5)!.terrain = "ocean";
    expect(getReachableTiles(state, "warrior-1").some(tile => tile.x === 3 && tile.y === 5)).toBe(false);
    state.players[0].technologies.push("sailing");
    expect(getReachableTiles(state, "warrior-1").some(tile => tile.x === 3 && tile.y === 5)).toBe(true);
  });
  it("disembarks into the original land unit with current health and loses the ship upgrade", () => {
    const state = fixture("scout"); getTile(state, 3, 5)!.terrain = "grass"; state.units[0].hp = 8;
    const next = applyAction(state, { type: "move", playerId: "player-1", unitId: "warrior-1", to: { x: 3, y: 5 } });
    expect(next.units[0]).toMatchObject({ unitType: "defender", embarked: false, hp: 8, maxHp: 15, attack: 1, defense: 3, movement: 0 });
  });
  it("Rafts cannot attack; Scouts fire at range two without melee retaliation", () => {
    const state = fixture(); expect(getAttackTargets(state, "warrior-1")).toEqual([]);
    state.units[0] = { ...state.units[0], ...getUnitStats("scout") }; state.units[1].x = 6;
    expect(previewCombat(state, "warrior-1", "warrior-2").retaliation).toBe(0);
    expect(previewCombat(state, "warrior-1", "warrior-2").advance).toBeNull();
  });
  it("Bombers splash visible adjacent enemies, spare allies, and cannot fire after moving", () => {
    const state = fixture("bomber"); state.units[1].x = 6;
    state.units.push({ ...state.units[1], id: "splash", x: 6, y: 4 }, { ...state.units[1], id: "ally", ownerId: "player-1", x: 6, y: 6 });
    const next = applyAction(state, { type: "ATTACK_UNIT", playerId: "player-1", unitId: "warrior-1", targetId: "warrior-2" });
    expect(next.units.find(unit => unit.id === "splash")!.hp).toBeLessThan(15);
    expect(next.units.find(unit => unit.id === "ally")!.hp).toBe(15);
    const moved = applyAction(state, { type: "move", playerId: "player-1", unitId: "warrior-1", to: { x: 3, y: 5 } });
    expect(getAttackTargets(moved, "warrior-1")).toEqual([]);
  });
  it("Juggernauts stomp after movement and never retaliate", () => {
    const state = fixture("juggernaut"); state.units[1].x = 4; state.units[1].y = 6;
    const next = applyAction(state, { type: "move", playerId: "player-1", unitId: "warrior-1", to: { x: 5, y: 6 } });
    expect(next.units[1].hp).toBe(11);
    const incoming = end(state);
    expect(previewCombat(incoming, "warrior-2", "warrior-1").retaliation).toBe(0);
  });
  it("harvests Starfish once with Navigation and a ready ship", () => {
    const state = fixture(); getTile(state, 4, 5)!.resource = "starfish";
    const next = applyAction(state, { type: "HARVEST_STARFISH", playerId: "player-1", unitId: "warrior-1" });
    expect(next.players[0].resources.gold).toBe(58);
    expect(getTile(next, 4, 5)!.resource).toBeUndefined();
    expect(() => applyAction(next, { type: "HARVEST_STARFISH", playerId: "player-1", unitId: "warrior-1" })).toThrow();
  });
});
