import { describe, expect, it } from "vitest";
import { getTechnologyCost, getTechnology, applyAction, canUnlockTechnology, createGame, getReachableTiles, getTechnologyUnlockReason, hasTechnology, technologies, type GameAction, type GameState } from "./index";

const unlock = (state: GameState, technologyId: string, playerId = state.activePlayerId) =>
  applyAction(state, { type: "UNLOCK_TECHNOLOGY", playerId, technologyId } as GameAction);
const end = (state: GameState) => applyAction(state, { type: "END_TURN", playerId: state.activePlayerId });

describe("technologies", () => {
  it("defines unique stable IDs and positive Gold costs", () => {
    expect(new Set(technologies.map(technology => technology.id)).size).toBe(technologies.length);
    for (const technology of technologies) expect(getTechnologyCost(createGame(), "player-1", technology.id)).toBeGreaterThan(0);
  });

  it.each(technologies.filter(technology => technology.implemented))("unlocks $name for only the acting player using only Gold, immutably", technology => {
    const state = createGame();
    state.players[0].resources.gold = getTechnologyCost(createGame(), "player-1", technology.id) + 2;
    state.players[0].technologies = [...technology.prerequisites];
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
      ["player-1", "fishing", "Not enough Gold"],
      ["player-1", "missing", "Unknown technology"],
      ["player-2", "fishing", "Not your turn"],
      ["missing", "fishing", "Not your turn"],
    ]) {
      expect(canUnlockTechnology(state, playerId, technologyId)).toBe(false);
      expect(getTechnologyUnlockReason(state, playerId, technologyId)).toContain(reason);
      expect(() => unlock(state, technologyId, playerId)).toThrow(reason);
      expect(state).toEqual(before);
    }
  });

  it("rejects duplicate purchases and preserves distinct unlocks through movement and income", () => {
    let state = end(end(createGame("fern-104", 2, { scenario: "demo" })));
    state.players[0].resources.gold = 20;
    state = unlock(state, "hunting");
    state = unlock(state, "archery");
    const before = structuredClone(state);
    expect(canUnlockTechnology(state, "player-1", "archery")).toBe(false);
    expect(() => unlock(state, "archery")).toThrow("Already researched");
    expect(state).toEqual(before);
    const to = getReachableTiles(state, "warrior-1")[0];
    state = applyAction(state, { type: "move", playerId: "player-1", unitId: "warrior-1", to });
    state = end(state);
    state.players[1].resources.gold = 15;
    state = unlock(state, "riding");
    state = unlock(state, "roads");
    state = end(state);
    expect(state.players.map(player => player.technologies)).toEqual([["hunting", "archery"], ["riding", "roads"]]);
    expect(state.units[0].movement).toBe(state.units[0].maxMovement);
    expect(hasTechnology(JSON.parse(JSON.stringify(state)), "player-1", "archery")).toBe(true);
  });

  it.each(technologies.filter(technology => technology.implemented && technology.prerequisites.length > 0))("requires every prerequisite of $name", technology => {
    const state = createGame();
    state.players[0].resources.gold = 100;
    for (const missing of technology.prerequisites) {
      state.players[0].technologies = technology.prerequisites.filter(id => id !== missing);
      const before = structuredClone(state);
      expect(() => unlock(state, technology.id)).toThrow(`Requires ${getTechnology(missing)!.name}`);
      expect(state).toEqual(before);
    }
  });

  it.each(technologies.filter(technology => !technology.implemented))("rejects unimplemented $name even with prerequisites and Gold", technology => {
    const state = createGame();
    state.players[0].technologies = [...technology.prerequisites];
    state.players[0].resources.gold = 100;
    const before = structuredClone(state);
    expect(() => unlock(state, technology.id)).toThrow("not implemented");
    expect(state).toEqual(before);
  });

  it("defines an acyclic tree with existing prerequisite IDs and preserves all research through JSON", () => {
    const visit = (id: string, ancestors: string[] = []) => {
      expect(ancestors).not.toContain(id);
      const technology = getTechnology(id);
      expect(technology).toBeDefined();
      for (const prerequisite of technology!.prerequisites) visit(prerequisite, [...ancestors, id]);
    };
    for (const technology of technologies) visit(technology.id);
    let state = createGame();
    state.players[0].resources.gold = 100;
    for (const technology of technologies.filter(technology => technology.implemented)) state = unlock(state, technology.id);
    const restored = JSON.parse(JSON.stringify(state)) as GameState;
    expect(restored).toEqual(state);
    for (const id of state.players[0].technologies) expect(hasTechnology(restored, "player-1", id)).toBe(true);
  });
});
