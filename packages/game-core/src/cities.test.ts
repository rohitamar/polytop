import { describe, expect, it } from "vitest";
import {
  applyAction,
  createGame,
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
) => applyAction(state, { type: "UPGRADE_CITY", playerId, cityId });
const move = (state: GameState, x = 5, y = 5) =>
  applyAction(state, {
    type: "move",
    playerId: state.activePlayerId,
    unitId: "warrior-1",
    to: { x, y },
  });

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
        expect(getIncome(state, player.id)).toBe(2);
        expect(player.stars).toBe(player.id === state.activePlayerId ? 2 : 0);
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
    expect(getIncome(captured, "player-1")).toBe(4);
    expect(captured.players[0].stars).toBe(2);
    expect(end(captured).players.map((player) => player.stars)).toEqual([2, 2]);
    expect(end(end(captured)).players.map((player) => player.stars)).toEqual([
      6, 2,
    ]);
    expect(initial).toEqual(snapshot);
  });

  it("transfers enemy income and retains the captured city's level", () => {
    const initial = createGame();
    initial.cities[1] = {
      ...initial.cities[1],
      x: 5,
      y: 5,
      level: 3,
      income: 6,
    };
    initial.cities = initial.cities.filter((city) => city.id !== "neutral-1");
    const captured = move(initial);
    expect(captured.cities[1]).toMatchObject({
      ownerId: "player-1",
      level: 3,
      income: 6,
    });
    expect(getIncome(captured, "player-2")).toBe(0);
    expect(end(captured).players[1].stars).toBe(0);
    expect(end(end(captured)).players[0].stars).toBe(10);
  });

  it("captures every city entered along an accepted movement path", () => {
    const state = move(createGame(), 6, 5);
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
    expect(initial.players[0].stars).toBe(4);
    expect(next.players[0].stars).toBe(0);
    expect(next.cities[0]).toMatchObject({ level: 2, income: 4 });
    expect(getUpgradeCost(next.cities[0])).toBe(8);
    const funded = end(end(end(end(next))));
    const max = upgrade(funded);
    expect(max.players[0].stars).toBe(0);
    expect(max.cities[0]).toMatchObject({ level: 3, income: 6 });
    expect(getUpgradeCost(max.cities[0])).toBeNull();
    expect(() => upgrade(max)).toThrow("maximum");
    expect(next.revision).toBe(initial.revision + 1);
  });

  it.each(["poor", "enemy", "neutral", "missing", "inactive"])(
    "rejects %s upgrades without mutation",
    (scenario) => {
      const state = createGame();
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
        expect(player.stars).toBe(
          before.players.find((p) => p.id === player.id)!.stars +
            (player.id === state.activePlayerId ? 2 : 0),
        );
    }
    expect(state.activePlayerId).toBe("player-1");
    expect(state.players[0].stars).toBe(4);
  });
});
