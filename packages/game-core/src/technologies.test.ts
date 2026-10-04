import { describe, expect, it } from "vitest";
import { getTechnologyCost, applyAction, canUnlockTechnology, createGame, getReachableTiles, getTechnologyUnlockReason, hasTechnology, technologies, technologyPrerequisites, type GameAction, type GameState } from "./index";

const unlock = (state: GameState, technologyId: string, playerId = state.activePlayerId) =>
  applyAction(state, { type: "UNLOCK_TECHNOLOGY", playerId, technologyId } as GameAction);
const end = (state: GameState) => applyAction(state, { type: "END_TURN", playerId: state.activePlayerId });

describe("technologies", () => {
  it("defines unique stable IDs and positive Gold costs", () => {
    expect(new Set(technologies.map(technology => technology.id)).size).toBe(technologies.length);
    for (const technology of technologies) expect(getTechnologyCost(createGame(), "player-1", technology.id)).toBeGreaterThan(0);
  });

  it.each(technologies)("unlocks $name for only the acting player using only Gold, immutably", technology => {
    const state = createGame();
    state.players[0].resources.gold = getTechnologyCost(createGame(), "player-1", technology.id) + 2;
    state.players[0].technologies = [...(technologyPrerequisites[technology.id] ?? [])];
    const before = structuredClone(state);
    expect(canUnlockTechnology(state, "player-1", technology.id)).toBe(true);
    const next = unlock(state, technology.id);
    expect(next.players[0].resources).toEqual({ ...state.players[0].resources, gold: 2 });
    expect(next.players[0].technologies).toEqual([...state.players[0].technologies, technology.id]);
    expect(hasTechnology(next, "player-1", technology.id)).toBe(true);
    expect(hasTechnology(next, "player-2", technology.id)).toBe(false);
    expect(next.players[1]).toEqual(state.players[1]);
    expect(next.revision).toBe(1);
    expect(state).toEqual(before);
  });

  it("rejects insufficient Gold, unknown technologies, missing players and inactive players without mutation", () => {
    const state = createGame();
    state.players[0].resources.gold = 0;
    const before = structuredClone(state);
    for (const [playerId, technologyId, reason] of [
      ["player-1", "archery", "Not enough Gold"],
      ["player-1", "missing", "Unknown technology"],
      ["player-2", "farming", "Not your turn"],
      ["missing", "farming", "Not your turn"],
    ]) {
      expect(canUnlockTechnology(state, playerId, technologyId)).toBe(false);
      expect(getTechnologyUnlockReason(state, playerId, technologyId)).toContain(reason);
      expect(() => unlock(state, technologyId, playerId)).toThrow(reason);
      expect(state).toEqual(before);
    }
  });

  it("rejects duplicate purchases and preserves distinct unlocks through movement and income", () => {
    let state = end(end(createGame("fern-104", 2, { scenario: "demo" })));
    state.players[0].resources.gold = 10;
    state = unlock(state, "archery");
    const before = structuredClone(state);
    expect(canUnlockTechnology(state, "player-1", "archery")).toBe(false);
    expect(() => unlock(state, "archery")).toThrow("Already unlocked");
    expect(state).toEqual(before);
    const to = getReachableTiles(state, "warrior-1")[0];
    state = applyAction(state, { type: "move", playerId: "player-1", unitId: "warrior-1", to });
    state = end(state);
    state.players[1].resources.gold = 10;
    state = unlock(state, "roads");
    state = end(state);
    expect(state.players.map(player => player.technologies)).toEqual([["archery"], ["roads"]]);
    expect(state.units[0].movement).toBe(state.units[0].maxMovement);
    expect(hasTechnology(JSON.parse(JSON.stringify(state)), "player-1", "archery")).toBe(true);
  });
});
