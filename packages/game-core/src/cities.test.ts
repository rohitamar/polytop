import { describe, expect, it } from "vitest";
import {
  applyAction,
  createGame as generateGame,
  getIncome,
  getUpgradeCost,
  type GameState,
} from "./index";

const end = (state: GameState) =>
  applyAction(state, { type: "END_TURN", playerId: state.activePlayerId });
const upgrade = (
  state: GameState,
  cityId = "city-1",
  playerId = state.activePlayerId,
) => applyAction(state, { type: "UPGRADE_TOWN_HALL", playerId, cityId });
const move = (state: GameState, x = 5, y = 5) =>
  applyAction(state, {
    type: "move",
    playerId: state.activePlayerId,
    unitId: "warrior-1",
    to: { x, y },
  });

const createGame = (seed = "fern-104", count = 2) => generateGame(seed, count, count === 2 ? { scenario: "demo" } : {});

describe("cities and economy", () => {
  it.each([2, 3, 8])(
    "creates deterministic owned and neutral cities for %i players",
    (count) => {
      const state = createGame("fern-104", count);
      expect(state).toEqual(createGame("fern-104", count));
      expect(new Set(state.cities.map((city) => city.id)).size).toBe(
        state.cities.length,
      );
      expect(
        new Set(state.cities.map((city) => `${city.x},${city.y}`)).size,
      ).toBe(state.cities.length);
      expect(state.cities.filter((city) => city.ownerId === null)).toHaveLength(
        4,
      );
      for (const player of state.players) {
        expect(
          state.cities.filter((city) => city.ownerId === player.id),
        ).toHaveLength(1);
        expect(getIncome(state, player.id)).toBeGreaterThanOrEqual(2);
        expect(player.resources.gold).toBe(player.id === state.activePlayerId ? getIncome(state, player.id) : 0);
      }
    },
  );

  it("captures neutral cities without immediate payment and preserves the input", () => {
    const initial = createGame();
    const snapshot = structuredClone(initial);
    const captured = move(initial);
    expect(
      captured.cities.find((city) => city.id === "neutral-1")?.ownerId,
    ).toBe("player-1");
    expect(getIncome(captured, "player-1")).toBeGreaterThan(getIncome(initial, "player-1"));
    expect(captured.players[0].resources.gold).toBe(initial.players[0].resources.gold);
    expect(end(captured).players[0].resources.gold).toBe(initial.players[0].resources.gold);
    expect(end(end(captured)).players[0].resources.gold).toBe(initial.players[0].resources.gold + getIncome(captured, "player-1"));
    expect(initial).toEqual(snapshot);
  });

  it("transfers enemy income and retains the captured city's level", () => {
    const initial = createGame();
    initial.cities[1] = {
      ...initial.cities[1],
      x: 5,
      y: 5,
      townHallLevel: 3,
    };
    initial.cities = initial.cities.filter((city) => city.id !== "neutral-1");
    const captured = move(initial);
    expect(captured.cities[1]).toMatchObject({
      ownerId: "player-1",
      townHallLevel: 3,
    });
    expect(getIncome(captured, "player-2")).toBe(0);
    expect(end(captured).players[1].resources.gold).toBe(0);
    expect(end(end(captured)).players[0].resources.gold).toBe(initial.players[0].resources.gold + getIncome(captured, "player-1"));
  });

  it("captures every city entered along an accepted movement path", () => {
    const initial = createGame();
    initial.units[0].movement = 2;
    const state = move(initial, 6, 5);
    expect(state.cities.find((city) => city.id === "neutral-1")?.ownerId).toBe(
      "player-1",
    );
  });

  it("captures after a lethal combat advance", () => {
    const state = createGame();
    state.units[1] = { ...state.units[1], x: 5, y: 5, hp: 1 };
    const next = applyAction(state, {
      type: "ATTACK_UNIT",
      playerId: "player-1",
      unitId: "warrior-1",
      targetId: "warrior-2",
    });
    expect(next.cities.find((city) => city.id === "neutral-1")?.ownerId).toBe(
      "player-1",
    );
  });

  it("charges centralized upgrade costs and pays the new income next turn", () => {
    const initial = end(end(createGame()));
    const next = upgrade(initial);
    expect(initial.players[0].resources.gold).toBe(getIncome(initial, "player-1") * 2);
    expect(next.players[0].resources.gold).toBe(initial.players[0].resources.gold - 4);
    expect(next.cities[0]).toMatchObject({ townHallLevel: 2 });
    expect(getUpgradeCost(next.cities[0])).toBe(8);
    const funded = end(end(end(end(end(end(next))))));
    const max = upgrade(funded);
    expect(max.players[0].resources.gold).toBe(funded.players[0].resources.gold - 8);
    expect(max.cities[0]).toMatchObject({ townHallLevel: 3 });
    expect(getUpgradeCost(max.cities[0])).toBeNull();
    expect(() => upgrade(max)).toThrow("maximum");
    expect(next.revision).toBe(initial.revision + 1);
  });

  it.each(["poor", "enemy", "neutral", "missing", "inactive"])(
    "rejects %s upgrades without mutation",
    (scenario) => {
      const state = createGame();
      if (scenario === "poor") state.players[0].resources.gold = 0;
      const before = structuredClone(state);
      const city =
        scenario === "enemy"
          ? "city-2"
          : scenario === "neutral"
            ? "neutral-1"
            : scenario === "missing"
              ? "missing"
              : "city-1";
      expect(() =>
        upgrade(state, city, scenario === "inactive" ? "player-2" : "player-1"),
      ).toThrow();
      expect(state).toEqual(before);
    },
  );

  it.each([3, 8])("pays only the incoming owner across %i players", (count) => {
    let state = createGame("fern-104", count);
    for (let i = 0; i < count; i++) {
      const before = state;
      state = end(state);
      for (const player of state.players)
        expect(player.resources.gold).toBe(
          before.players.find((p) => p.id === player.id)!.resources.gold +
            (player.id === state.activePlayerId ? getIncome(state, player.id) : 0),
        );
    }
    expect(state.activePlayerId).toBe("player-1");
    expect(state.players[0].resources.gold).toBe(getIncome(state, "player-1") * 2);
  });
});
