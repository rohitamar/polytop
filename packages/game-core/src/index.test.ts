import { describe, expect, it } from "vitest";
import {
  applyAction,
  warriorStats,
  createGame,
  getReachableTiles,
  getTile,
  type GameAction,
  type GameState,
  type Terrain,
} from "./index";

function fixture(): GameState {
  return {
    seed: "test",
    width: 5,
    height: 5,
    revision: 0,
    activePlayerId: "p1",
    players: [
      { id: "p1", name: "One" },
      { id: "p2", name: "Two" },
    ],
    turnNumber: 1,
    tiles: Array.from({ length: 25 }, (_, i) => ({
      x: i % 5,
      y: Math.floor(i / 5),
      terrain: "grass",
    })),
    units: [
      {
        ...warriorStats,
        hp: 10,
        hasAttacked: false,
        id: "u1",
        ownerId: "p1",
        x: 2,
        y: 2,
        movement: 2,
        maxMovement: 2,
      },
    ],
  };
}

const action = (
  x: number,
  y: number,
): Extract<GameAction, { type: "move" }> => ({
  type: "move",
  playerId: "p1",
  unitId: "u1",
  to: { x, y },
});

describe("seeded world", () => {
  it("reproduces the same complete state from a seed", () => {
    expect(createGame("island")).toEqual(createGame("island"));
    expect(createGame("island").tiles).not.toEqual(createGame("other").tiles);
    expect(createGame()).toMatchObject({ width: 20, height: 20 });
    expect(createGame().tiles).toHaveLength(400);
  });
  it("always gives the warrior a playable start", () => {
    for (let i = 0; i < 50; i++) {
      const state = createGame(String(i));
      expect(getTile(state, 4, 5)?.terrain).toBe("grass");
      expect(getReachableTiles(state, "warrior-1").length).toBeGreaterThan(5);
    }
  });
});

describe("weighted movement", () => {
  it("finds all and only positions within two orthogonal grass steps", () => {
    const state = fixture();
    const reachable = getReachableTiles(state, "u1");
    expect(reachable).toHaveLength(12);
    for (const tile of reachable) {
      expect(tile.cost).toBe(Math.abs(tile.x - 2) + Math.abs(tile.y - 2));
      expect(tile.path).toHaveLength(tile.cost);
    }
  });
  it("charges two for forest and cannot continue beyond it", () => {
    const state = fixture();
    getTile(state, 3, 2)!.terrain = "forest";
    const reachable = getReachableTiles(state, "u1");
    expect(reachable.find((tile) => tile.x === 3 && tile.y === 2)?.cost).toBe(
      2,
    );
    expect(
      reachable.find((tile) => tile.x === 4 && tile.y === 2),
    ).toBeUndefined();
    expect(applyAction(state, action(3, 2)).units[0].movement).toBe(0);
  });
  it("uses the cheaper route when another route crosses forest", () => {
    const state = fixture();
    getTile(state, 3, 2)!.terrain = "forest";
    const tile = getReachableTiles(state, "u1").find(
      (tile) => tile.x === 3 && tile.y === 3,
    )!;
    expect(tile.cost).toBe(2);
    expect(tile.path).toEqual([
      { x: 2, y: 3 },
      { x: 3, y: 3 },
    ]);
  });
  it.each<Terrain>(["water", "mountain"])(
    "blocks %s and paths through it",
    (terrain) => {
      const state = fixture();
      getTile(state, 3, 2)!.terrain = terrain;
      expect(() => applyAction(state, action(3, 2))).toThrow("Unreachable");
      expect(() => applyAction(state, action(4, 2))).toThrow("Unreachable");
    },
  );
  it("blocks occupied destinations and passage through occupied tiles", () => {
    const state = fixture();
    state.units.push({
      ...warriorStats,
      hp: 10,
      hasAttacked: false,
      id: "u2",
      ownerId: "p1",
      x: 3,
      y: 2,
      movement: 2,
      maxMovement: 2,
    });
    expect(() => applyAction(state, action(3, 2))).toThrow("Unreachable");
    expect(() => applyAction(state, action(4, 2))).toThrow("Unreachable");
  });
  it("never leaves the map from a corner", () => {
    const state = fixture();
    state.units[0].x = 0;
    state.units[0].y = 0;
    expect(getReachableTiles(state, "u1")).toHaveLength(5);
    expect(() => applyAction(state, action(-1, 0))).toThrow("Unreachable");
  });
  it("applies an immutable deterministic transition and spends movement", () => {
    const state = fixture();
    const before = structuredClone(state);
    Object.freeze(state.units[0]);
    Object.freeze(state.units);
    Object.freeze(state);
    const next = applyAction(state, action(3, 2));
    expect(state).toEqual(before);
    expect(next.units[0]).toMatchObject({ x: 3, y: 2, movement: 1 });
    expect(next.revision).toBe(1);
    expect(applyAction(state, action(3, 2))).toEqual(next);
    const exhausted = applyAction(next, action(4, 2));
    expect(getReachableTiles(exhausted, "u1")).toEqual([]);
    expect(() => applyAction(exhausted, action(3, 2))).toThrow("Unreachable");
  });
  it.each([
    [2, 2],
    [0, 0],
    [5, 2],
    [2, -1],
    [2.5, 2],
    [NaN, 2],
  ])("rejects invalid target %s, %s", (x, y) => {
    expect(() => applyAction(fixture(), action(x, y))).toThrow("Unreachable");
  });
  it("rejects unknown units, incorrect ownership and inactive players", () => {
    const state = fixture();
    expect(() =>
      applyAction(state, { ...action(3, 2), unitId: "missing" }),
    ).toThrow("Unknown unit");
    expect(() =>
      applyAction(state, { ...action(3, 2), playerId: "p2" }),
    ).toThrow("Not your");
    state.activePlayerId = "p2";
    expect(() => applyAction(state, action(3, 2))).toThrow("Not your");
    expect(getReachableTiles(state, "missing")).toEqual([]);
  });
});
