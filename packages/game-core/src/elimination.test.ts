import { describe, expect, it } from "vitest";
import { applyAction, createGame, getPlayerView, getReachableTiles, getAttackTargets, getUnitStats, type GameState } from "./index";

function fixture(count = 2): GameState {
  const state = createGame("elimination", count);
  return { ...state, width: 8, height: 3, exploration: undefined,
    tiles: Array.from({ length: 24 }, (_, i) => ({ x: i % 8, y: Math.floor(i / 8), terrain: "grass" })),
    cities: state.players.map((player, i) => ({ id: `city-${i}`, ownerId: player.id, x: i * 2, y: 1, townHallLevel: 1 })),
    units: state.players.map((player, i) => ({ ...getUnitStats("warrior"), id: `unit-${i}`, ownerId: player.id, homeCityId: `city-${i}`, x: i * 2, y: 0, hp: 10, movement: 1, hasAttacked: false, actionPhase: "ready" })) };
}

const capture = (state: GameState) => applyAction({ ...state, units: state.units.map(unit => unit.id === "unit-0" ? { ...unit, x: 1, y: 1 } : unit) }, { type: "move", playerId: "player-1", unitId: "unit-0", to: { x: 2, y: 1 } });

describe("elimination and victory", () => {
  it("eliminates a civilization on last-city capture, removes its units and declares a winner", () => {
    const state = fixture();
    const before = structuredClone(state);
    const next = capture(state);
    expect(state).toEqual(before);
    expect(next.outcome).toEqual({ eliminatedPlayerIds: ["player-2"], winnerId: "player-1" });
    expect(next.units.map(unit => unit.ownerId)).toEqual(["player-1"]);
    expect(next.cities.find(city => city.id === "city-1")?.ownerId).toBe("player-1");
  });

  it("does not eliminate a player who still owns another city", () => {
    const state = fixture();
    state.cities.push({ id: "backup", ownerId: "player-2", x: 7, y: 2, townHallLevel: 1 });
    expect(capture(state).outcome).toEqual({ eliminatedPlayerIds: [], winnerId: null });
  });

  it("allows a player with no units to keep taking turns and recruit", () => {
    const state = fixture();
    state.units = state.units.filter(unit => unit.ownerId !== "player-2");
    const next = applyAction(state, { type: "END_TURN", playerId: "player-1" });
    expect(next.outcome?.eliminatedPlayerIds).toEqual([]);
    expect(applyAction(next, { type: "RECRUIT_UNIT", playerId: "player-2", cityId: "city-1", unitType: "warrior" }).units.some(unit => unit.ownerId === "player-2")).toBe(true);
  });

  it("skips eliminated players and refreshes only the incoming survivor", () => {
    const next = capture(fixture(3));
    expect(next.outcome?.winnerId).toBeNull();
    const handedOff = applyAction(next, { type: "END_TURN", playerId: "player-1" });
    expect(handedOff.activePlayerId).toBe("player-3");
    expect(handedOff.turnNumber).toBe(2);
    expect(handedOff.units.find(unit => unit.ownerId === "player-3")?.movement).toBe(1);
    expect(applyAction(handedOff, { type: "END_TURN", playerId: "player-3" }).activePlayerId).toBe("player-1");
  });

  it("rejects eliminated players and all actions after victory without mutation", () => {
    const next = capture(fixture(3));
    const before = structuredClone(next);
    expect(() => applyAction(next, { type: "END_TURN", playerId: "player-2" })).toThrow("eliminated");
    expect(next).toEqual(before);
    const ended = capture(fixture());
    expect(() => applyAction(ended, { type: "END_TURN", playerId: "player-1" })).toThrow("ended");
    expect(getReachableTiles(ended, "unit-0")).toEqual([]);
    expect(getAttackTargets(ended, "unit-0")).toEqual([]);
  });

  it("synchronizes outcomes without exposing hidden cities and copies outcome data", () => {
    const ended = capture(fixture(3));
    const view = getPlayerView(ended, "player-2");
    expect(view.outcome).toEqual(ended.outcome);
    expect(view.units).toEqual([]);
    expect(view.exploration?.["player-2"].visibleTiles).toEqual([]);
    view.outcome!.eliminatedPlayerIds.push("player-3");
    expect(ended.outcome?.eliminatedPlayerIds).toEqual(["player-2"]);
  });

  it("clears treaties and offers involving eliminated players", () => {
    const state = fixture(3);
    state.treaties = [{ a: "player-2", b: "player-3" }];
    state.peaceOffers = [{ from: "player-2", to: "player-1" }];
    const next = capture(state);
    expect(next.treaties).toEqual([]);
    expect(next.peaceOffers).toEqual([]);
  });

  it("single-player simulations do not immediately end", () => {
    const state = fixture();
    state.players = state.players.slice(0, 1);
    state.cities = state.cities.slice(0, 1);
    state.units = state.units.slice(0, 1);
    expect(applyAction(state, { type: "END_TURN", playerId: "player-1" }).outcome?.winnerId).toBeNull();
  });
});
