import { describe, expect, it } from "vitest";
import {
  applyAction,
  createGame as generateGame,
  getAttackTargets,
  getReachableTiles,
  getTile,
  previewCombat,
  type GameAction,
  type GameState,
} from "./index";

function fixture() {
  const state = createGame("fern-104");
  state.units[1] = { ...state.units[1], x: 5, y: 5 };
  return state;
}
const attack: GameAction = {
  type: "ATTACK_UNIT",
  playerId: "player-1",
  unitId: "warrior-1",
  targetId: "warrior-2",
};
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const end = (state: GameState) =>
  applyAction(state, { type: "END_TURN", playerId: state.activePlayerId });

const createGame = (seed = "fern-104", count = 2) => generateGame(seed, count, count === 2 ? { scenario: "demo" } : {});

describe("warrior combat", () => {
  it("stores the warrior stats in the rules state", () => {
    expect(fixture().units[0]).toMatchObject({
      hp: 10,
      maxHp: 10,
      attack: 2,
      defense: 2,
      range: 1,
      hasAttacked: false,
    });
  });
  it("previews and applies the same deterministic damage without mutation", () => {
    const state = freeze(fixture());
    const before = structuredClone(state);
    const preview = previewCombat(state, "warrior-1", "warrior-2");
    expect(preview).toMatchObject({
      damage: 5,
      retaliation: 3,
      attackerHp: 7,
      defenderHp: 5,
      advance: null,
    });
    const next = applyAction(state, attack);
    expect(next.units.map((unit) => unit.hp)).toEqual([
      preview.attackerHp,
      preview.defenderHp,
    ]);
    expect(next.revision).toBe(1);
    expect(state).toEqual(before);
    expect(applyAction(state, attack)).toEqual(next);
  });
  it("allows moving then attacking even with no movement remaining", () => {
    const state = fixture();
    state.units[1].x = 6;
    const moved = applyAction(state, {
      type: "move",
      playerId: "player-1",
      unitId: "warrior-1",
      to: { x: 5, y: 5 },
    });
    expect(moved.units[0].movement).toBe(0);
    expect(applyAction(moved, attack).units[0].hasAttacked).toBe(true);
  });
  it("scales offense by current health and reduces damage with defense", () => {
    const state = fixture();
    state.units[0].hp = 4;
    expect(previewCombat(state, "warrior-1", "warrior-2").damage).toBe(2);
    state.units[1].defense = 4;
    expect(previewCombat(state, "warrior-1", "warrior-2").damage).toBe(1);
  });
  it("does not retaliate outside the defender's range", () => {
    const state = fixture();
    state.units[1].range = 0;
    expect(previewCombat(state, "warrior-1", "warrior-2").retaliation).toBe(0);
  });
  it("removes a killed defender, prevents retaliation and advances without movement points", () => {
    const state = fixture();
    state.units[0].movement = 0;
    state.units[1].hp = 5;
    const preview = previewCombat(state, "warrior-1", "warrior-2");
    expect(preview).toMatchObject({
      damage: 5,
      retaliation: 0,
      attackerHp: 10,
      defenderHp: 0,
      advance: { x: 5, y: 5 },
    });
    const next = applyAction(freeze(state), attack);
    expect(next.units).toHaveLength(1);
    expect(next.units[0]).toMatchObject({
      hp: 10,
      x: 5,
      y: 5,
      movement: 0,
      hasAttacked: true,
    });
  });
  it.each(["water", "mountain"] as const)(
    "does not advance onto %s",
    (terrain) => {
      const state = fixture();
      state.units[1].hp = 1;
      getTile(state, 5, 5)!.terrain = terrain;
      expect(previewCombat(state, "warrior-1", "warrior-2").advance).toBeNull();
      expect(applyAction(state, attack).units[0]).toMatchObject({ x: 4, y: 5 });
    },
  );
  it("removes an attacker killed by retaliation without advancing", () => {
    const state = fixture();
    state.units[0].hp = 1;
    const preview = previewCombat(state, "warrior-1", "warrior-2");
    expect(preview.attackerHp).toBe(0);
    expect(applyAction(state, attack).units.map((unit) => unit.id)).toEqual([
      "warrior-2",
    ]);
  });
  it("blocks all further actions until the owner's next turn", () => {
    const spent = applyAction(fixture(), attack);
    expect(getAttackTargets(spent, "warrior-1")).toEqual([]);
    expect(getReachableTiles(spent, "warrior-1")).toEqual([]);
    expect(() => applyAction(spent, attack)).toThrow("finished acting");
    expect(() =>
      applyAction(spent, {
        type: "move",
        playerId: "player-1",
        unitId: "warrior-1",
        to: { x: 4, y: 6 },
      }),
    ).toThrow("finished acting");
    const second = end(spent);
    expect(second.units[0].hasAttacked).toBe(true);
    expect(getAttackTargets(second, "warrior-1")).toEqual([]);
    const returned = end(second);
    expect(returned.units[0]).toMatchObject({
      movement: 1,
      hasAttacked: false,
      hp: 7,
    });
    expect(getAttackTargets(returned, "warrior-1")).toHaveLength(1);
  });
  it.each([
    "inactive",
    "wrong owner",
    "friendly",
    "distant",
    "diagonal",
    "missing attacker",
    "missing target",
    "spent",
  ])("rejects %s attacks without mutation", (kind) => {
    const state = fixture();
    let action = { ...attack } as Extract<GameAction, { type: "ATTACK_UNIT" }>;
    if (kind === "inactive") action.playerId = "player-2";
    if (kind === "wrong owner")
      action = { ...action, unitId: "warrior-2", targetId: "warrior-1" };
    if (kind === "friendly") state.units[1].ownerId = "player-1";
    if (kind === "distant") state.units[1].x = 6;
    if (kind === "diagonal") state.units[1].y = 6;
    if (kind === "missing attacker") action.unitId = "missing";
    if (kind === "missing target") action.targetId = "missing";
    if (kind === "spent") state.units[0].hasAttacked = true;
    const before = structuredClone(state);
    expect(() => applyAction(freeze(state), action)).toThrow();
    expect(state).toEqual(before);
  });
});
