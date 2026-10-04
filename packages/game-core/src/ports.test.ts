import { describe, expect, it } from "vitest";
import { applyAction, createGame, getAttackTargets, previewCombat, getPlayerPopulation, getReachableTiles, getTile, type GameState } from "./index";

function fixture() {
  const state = createGame("fern-104", 2, { scenario: "demo" });
  state.tiles.forEach(tile => { tile.terrain = "grass"; delete tile.resource; });
  state.cities = [state.cities[0]];
  state.players[0].resources.gold = 30;
  state.players[0].technologies = ["fishing"];
  for (const [x, y] of [[5, 5], [6, 5], [6, 6], [7, 6], [7, 5]]) getTile(state, x, y)!.terrain = "water";
  state.units[0].hp = 7;
  return state;
}
const build = (state: GameState) => applyAction(state, { type: "BUILD_PORT", playerId: "player-1", to: { x: 5, y: 5 } });
const move = (state: GameState, x: number, y: number) => applyAction(state, { type: "move", playerId: "player-1", unitId: "warrior-1", to: { x, y } });
const round = (state: GameState) => {
  for (let i = 0; i < 2; i++) state = applyAction(state, { type: "END_TURN", playerId: state.activePlayerId });
  return state;
};

describe("Ports and Rafts", () => {
  it("builds within inland city territory without requiring water beside its center", () => {
    const state = fixture();
    state.cities[0].expanded = true;
    getTile(state, 5, 5)!.terrain = "grass";
    getTile(state, 6, 5)!.terrain = "water";
    const before = structuredClone(state);
    const next = applyAction(state, { type: "BUILD_PORT", playerId: "player-1", to: { x: 6, y: 5 } });
    expect(getTile(next, 6, 5)?.port).toBe(true);
    expect(next.players[0].resources.gold).toBe(23);
    expect(next.revision).toBe(1);
    expect(state).toEqual(before);
  });

  it.each(["technology", "turn", "land", "territory", "occupied", "gold", "existing", "coordinate", "coast"])("rejects invalid construction atomically: %s", reason => {
    const state = fixture();
    if (reason === "technology") state.players[0].technologies = [];
    if (reason === "turn") state.activePlayerId = "player-2";
    if (reason === "land") getTile(state, 5, 5)!.terrain = "grass";
    if (reason === "territory") state.cities[0].ownerId = "player-2";
    if (reason === "occupied") state.units[0].x = 5;
    if (reason === "gold") state.players[0].resources.gold = 6;
    if (reason === "existing") getTile(state, 5, 5)!.port = true;
    if (reason === "coast") for (const [x, y] of [[5, 4], [6, 5], [5, 6], [4, 5]]) getTile(state, x, y)!.terrain = "water";
    const before = structuredClone(state);
    expect(() => applyAction(state, { type: "BUILD_PORT", playerId: "player-1", to: { x: reason === "coordinate" ? 5.5 : 5, y: 5 } })).toThrow();
    expect(state).toEqual(before);
  });

  it("embarks, sails diagonally for two tiles, lands and restores the same wounded unit", () => {
    let state = build(fixture());
    state.units[0].movement = 3;
    expect(getReachableTiles(state, "warrior-1").some(tile => tile.x === 6 && tile.y === 5)).toBe(false);
    state = move(state, 5, 5);
    expect(state.units[0]).toMatchObject({ id: "warrior-1", unitType: "raft", carriedUnitType: "warrior", embarked: true, hp: 7, maxHp: 10, movement: 0, maxMovement: 2, attack: 0, defense: 1 });
    expect(getReachableTiles(state, "warrior-1")).toEqual([]);
    state = round(state);
    expect(getAttackTargets(state, "warrior-1")).toEqual([]);
    state = move(state, 7, 6);
    expect(state.units[0].movement).toBe(0);
    state = round(state);
    state = move(state, 8, 6);
    expect(state.units[0]).toMatchObject({ id: "warrior-1", unitType: "warrior", embarked: false, hp: 7, maxHp: 10, maxMovement: 1, attack: 2, defense: 2, range: 1, movement: 0, hasAttacked: true, homeCityId: "city-1" });
    expect(getPlayerPopulation(state, "player-1").used).toBe(1);
    expect(getReachableTiles(state, "warrior-1")).toEqual([]);
    expect(getAttackTargets(state, "warrior-1")).toEqual([]);
    expect(round(state).units[0].movement).toBe(1);
  });

  it("does not route through landing tiles or embark through enemy Ports", () => {
    let state = build(fixture());
    state.cities[0].ownerId = "player-2";
    expect(() => move(state, 5, 5)).toThrow("Unreachable");
    state.cities[0].ownerId = "player-1";
    state = round(move(state, 5, 5));
    expect(getReachableTiles(state, "warrior-1").some(tile => tile.path.length > 1 && tile.path.slice(0, -1).some(position => getTile(state, position.x, position.y)?.terrain !== "water"))).toBe(false);
  });
  it("finishes sailing after one move even when the destination is only one tile away", () => {
    let state = round(move(build(fixture()), 5, 5));
    state = move(state, 6, 5);
    expect(state.units[0].movement).toBe(0);
    expect(getReachableTiles(state, "warrior-1")).toEqual([]);
  });

  it("Rafts take damage without retaliation and a killing land unit embarks at a Port", () => {
    let state = fixture();
    state.units[1] = { ...state.units[1], x: 5, y: 5, embarked: true, attack: 0, defense: 1, range: 0, hp: 1 };
    getTile(state, 5, 5)!.port = true;
    const preview = previewCombat(state, "warrior-1", state.units[1].id);
    expect(preview.retaliation).toBe(0);
    expect(preview.advance).toEqual({ x: 5, y: 5 });
    state = applyAction(state, { type: "ATTACK_UNIT", playerId: "player-1", unitId: "warrior-1", targetId: state.units[1].id });
    expect(state.units).toHaveLength(1);
    expect(state.units[0]).toMatchObject({ embarked: true, hp: 7, movement: 0, hasAttacked: true });
  });

});
