import { describe, expect, it } from "vitest";
import {
  applyAction,
  warriorStats,
  createGame,
  getReachableTiles,
  getTile,
  type GameAction,
  type GameState,
} from "./index";

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}

const endTurn = (state: GameState) =>
  applyAction(state, { type: "END_TURN", playerId: state.activePlayerId });
const move = (
  playerId = "player-1",
  unitId = "warrior-1",
  x = 5,
  y = 5,
): GameAction => ({ type: "move", playerId, unitId, to: { x, y } });

describe("player turns", () => {
  it("initializes two distinct owners, turn one, and only the first player's movement", () => {
    const state = createGame();
    expect(state.players.map((player) => player.id)).toEqual([
      "player-1",
      "player-2",
    ]);
    expect(state.activePlayerId).toBe("player-1");
    expect(state.turnNumber).toBe(1);
    expect(
      state.units.map((unit) => [
        unit.ownerId,
        unit.movement,
        unit.maxMovement,
      ]),
    ).toEqual([
      ["player-1", 2, 2],
      ["player-2", 0, 2],
    ]);
    expect(getReachableTiles(state, "warrior-2")).toEqual([]);
    expect(new Set(state.units.map((unit) => `${unit.x},${unit.y}`)).size).toBe(
      2,
    );
    for (const unit of state.units)
      expect(getTile(state, unit.x, unit.y)?.terrain).toBe("grass");
  });

  it("lets the active owner move, consume points, and exhaust their allowance", () => {
    const initial = freeze(createGame());
    const moved = applyAction(initial, move());
    expect(moved.units[0]).toMatchObject({ x: 5, y: 5, movement: 1 });
    expect(moved.turnNumber).toBe(1);
    expect(moved.revision).toBe(1);
    const exhausted = freeze(
      applyAction(moved, move("player-1", "warrior-1", 6, 5)),
    );
    const before = structuredClone(exhausted);
    expect(() => applyAction(exhausted, move())).toThrow("Unreachable");
    expect(exhausted).toEqual(before);
    expect(getReachableTiles(exhausted, "warrior-1")).toEqual([]);
  });

  it.each([
    move("player-2", "warrior-2", 7, 4),
    move("player-1", "warrior-2", 7, 4),
    move("stranger"),
    move("player-1", "missing"),
    move("player-1", "warrior-1", -1, 5),
    { type: "END_TURN", playerId: "player-2" },
    { type: "END_TURN", playerId: "stranger" },
    { type: "unsupported", playerId: "player-1" } as unknown as GameAction,
  ] satisfies GameAction[])(
    "rejects invalid actions without any mutation: %j",
    (action) => {
      const state = freeze(createGame());
      const before = structuredClone(state);
      expect(() => applyAction(state, action)).toThrow();
      expect(state).toEqual(before);
    },
  );

  it("hands off and restores only the incoming owner's units to their own budgets", () => {
    const state = createGame();
    state.units.push({
      ...warriorStats,
      hp: 10,
      hasAttacked: false,
      id: "extra",
      ownerId: "player-2",
      x: 8,
      y: 3,
      movement: 0,
      maxMovement: 3,
    });
    const spent = freeze(applyAction(state, move()));
    const before = structuredClone(spent);
    const next = endTurn(spent);
    expect(next.activePlayerId).toBe("player-2");
    expect(next.turnNumber).toBe(2);
    expect(next.revision).toBe(2);
    expect(next.units.map((unit) => unit.movement)).toEqual([1, 2, 3]);
    expect(next.units[0]).toEqual(spent.units[0]);
    expect(spent).toEqual(before);
    expect(getReachableTiles(next, "warrior-1")).toEqual([]);
    expect(() => applyAction(next, move())).toThrow("Not your");
    expect(() => applyAction(next, move("player-2", "warrior-1"))).toThrow(
      "Not your",
    );
    const returned = endTurn(next);
    expect(returned.activePlayerId).toBe("player-1");
    expect(returned.units.map((unit) => unit.movement)).toEqual([2, 2, 3]);
    expect(returned.units[0]).toMatchObject({ x: 5, y: 5 });
  });

  it("restores exhausted movement on the next owned turn and allows another move", () => {
    const state = applyAction(
      createGame(),
      move("player-1", "warrior-1", 6, 5),
    );
    const second = endTurn(state);
    expect(second.units[0].movement).toBe(0);
    const movedSecond = applyAction(
      second,
      move("player-2", "warrior-2", 7, 4),
    );
    expect(movedSecond.units[1]).toMatchObject({ x: 7, y: 4, movement: 1 });
    const third = endTurn(movedSecond);
    expect(third.units.map((unit) => unit.movement)).toEqual([2, 1]);
    expect(applyAction(third, move()).units[0].movement).toBe(1);
  });

  it.each([1, 2, 3, 8])(
    "cycles a roster of %i players in order without requiring units",
    (count) => {
      let state = createGame();
      state.players = Array.from({ length: count }, (_, i) => ({
        id: `player-${i + 1}`,
        name: `Player ${i + 1}`,
        stars: 0,
      }));
      for (let i = 0; i < count * 3; i++) {
        expect(state.activePlayerId).toBe(state.players[i % count].id);
        expect(state.turnNumber).toBe(i + 1);
        state = endTurn(freeze(state));
      }
      expect(state.activePlayerId).toBe("player-1");
    },
  );

  it("replays moves and consecutive turns deterministically", () => {
    const actions: GameAction[] = [
      move(),
      { type: "END_TURN", playerId: "player-1" },
      move("player-2", "warrior-2", 7, 4),
      { type: "END_TURN", playerId: "player-2" },
      move("player-1", "warrior-1", 6, 5),
    ];
    const replay = () =>
      actions.reduce(
        (state, action) => applyAction(freeze(state), action),
        createGame("turn-replay"),
      );
    expect(replay()).toEqual(replay());
    expect(replay()).toMatchObject({
      revision: 5,
      turnNumber: 3,
      activePlayerId: "player-1",
    });
  });
});
