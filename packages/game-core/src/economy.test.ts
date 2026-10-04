import { describe, expect, it } from "vitest";
import { applyAction, createGame, getCityGrowth, getCityPopulation, getIncome, getPlayerPopulation, getRecruitmentReason, getTile, type GameState } from "./index";
const end = (state: GameState) => applyAction(state, { type: "END_TURN", playerId: state.activePlayerId });
const fixture = () => createGame("fern-104", 2, { scenario: "demo" });
describe("population economy", () => {
  it("starts every player with five Gold and pays income only after their initial turn", () => {
    const state = fixture();
    expect(state.players.map(player => player.resources.gold)).toEqual([5, 5]);
    const second = end(state);
    expect(second.players.map(player => player.resources.gold)).toEqual([5, 5]);
    const next = end(second);
    expect(next.players.map(player => player.resources.gold)).toEqual([7, 5]);
    expect(state.players.map(player => player.resources.gold)).toEqual([5, 5]);
  });
  it.each([1, 2, 3, 5, 10])("derives level %i income and support independently from population growth", level => {
    const state = fixture();
    state.cities[0].townHallLevel = level;
    state.cities[0].population = level * (level + 1) / 2 - 1;
    expect(getIncome(state, "player-1")).toBe(level + 1);
    expect(getCityPopulation(state, state.cities[0])).toEqual({ used: 1, capacity: level + 1, available: level });
    state.cities[0].workshop = true; state.cities[0].parks = 2;
    expect(getIncome(state, "player-1")).toBe(level + 4);
  });
  it("resource tiles provide neither automatic population nor passive Gold", () => {
    const state = fixture();
    getTile(state, 5, 5)!.resource = "orchard";
    const next = applyAction(state, { type: "move", playerId: "player-1", unitId: "warrior-1", to: { x: 5, y: 5 } });
    expect(next.players).toEqual(state.players);
    expect(getTile(next, 5, 5)!.resource).toBe("orchard");
    expect(getCityGrowth(next, next.cities[0]).total).toBe(1);
    expect(next.cities[0].population).toBe(0);
  });
  it("recruitment uses the selected city's slots rather than global capacity or unit price", () => {
    const state = fixture(); state.players[0].resources.gold = 50;
    state.units[0].x = 3;
    state.units.push({ ...state.units[0], id: "supported" });
    expect(getRecruitmentReason(state, "player-1", "city-1", "warrior")).toBe("City unit capacity reached");
    state.cities[2].ownerId = "player-1";
    expect(getRecruitmentReason(state, "player-1", state.cities[2].id, "warrior")).toBeNull();
    expect(getPlayerPopulation(state, "player-1").capacity).toBe(4);
  });
  it("sieged cities stop producing Gold", () => {
    const state = fixture(); state.units[1] = { ...state.units[1], x: state.cities[0].x, y: state.cities[0].y };
    expect(getIncome(state, "player-1")).toBe(0);
  });
  it.each([2, 3, 8])("pays one incoming player once with %i players and preserves immutable state", count => {
    let state = createGame("economy", count);
    for (let i = 0; i < count * 2; i++) {
      const before = structuredClone(state);
      const next = end(state);
      for (const player of next.players) expect(player.resources.gold).toBe(before.players.find(other => other.id === player.id)!.resources.gold + (player.id === next.activePlayerId && before.players.find(other => other.id === player.id)!.hasStartedTurn ? getIncome(before, player.id) : 0));
      expect(state).toEqual(before); expect(next.turnNumber).toBe(before.turnNumber + 1);
      state = next;
    }
  });
});
