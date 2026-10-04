import { describe, expect, it } from "vitest";
import { applyAction, createGame, computeVisibleTiles, getAttackTargets, getPlayerAction, getPlayerView, getReachableTiles, getTileVisibility, gridDistance, isTileExplored, isTileVisible, positionKey, tilesInRange, TileVisibility, updatePlayerExploration, warriorStats, type GameState } from "./index";

function fixture(): GameState {
  return updatePlayerExploration({
    seed: "secret", width: 9, height: 5, revision: 0, turnNumber: 1, activePlayerId: "p1",
    players: ["p1", "p2"].map(id => ({ id, name: id, resources: { gold: 20 }, technologies: [] })),
    tiles: Array.from({ length: 45 }, (_, i) => ({ x: i % 9, y: Math.floor(i / 9), terrain: "grass" })),
    cities: [],
    units: [
      { ...warriorStats, id: "u1", ownerId: "p1", x: 1, y: 2, movement: 2, maxMovement: 2, hp: 10, hasAttacked: false },
      { ...warriorStats, id: "u2", ownerId: "p2", x: 7, y: 2, movement: 2, maxMovement: 2, hp: 10, hasAttacked: false },
    ],
  });
}

describe("fog of war", () => {
  it("reveals starting units and the radius-two city using Manhattan distance", () => {
    const state = createGame();
    for (const player of state.players) {
      const city = state.cities.find(city => city.ownerId === player.id)!;
      const visible = computeVisibleTiles(state, player.id);
      for (const tile of state.tiles) expect(visible.has(positionKey(tile))).toBe(gridDistance(city, tile) <= 2);
    }
    expect(computeVisibleTiles(fixture(), "p1").size).toBe(5);
  });

  it("reveals movement paths, retains explored tiles and never mutates the input", () => {
    const before = fixture();
    const saved = structuredClone(before);
    const after = applyAction(before, { type: "move", playerId: "p1", unitId: "u1", to: { x: 3, y: 2 } });
    expect(before).toEqual(saved);
    expect(isTileVisible(after, "p1", "4,2")).toBe(true);
    expect(getTileVisibility(after, "p1", "0,2")).toBe(TileVisibility.Explored);
    expect(getTileVisibility(after, "p1", "2,1")).toBe(TileVisibility.Explored);
    expect(getTileVisibility(after, "p1", "8,0")).toBe(TileVisibility.Unexplored);
    const ended = applyAction(after, { type: "END_TURN", playerId: "p1" });
    for (const key of after.exploration!.p1.exploredTiles) expect(isTileExplored(ended, "p1", key)).toBe(true);
    expect(() => applyAction(before, { type: "move", playerId: "p1", unitId: "u1", to: { x: 8, y: 4 } })).toThrow();
    expect(before).toEqual(saved);
  });

  it("keeps exploration independent and removes hidden enemies from every view field", () => {
    const state = fixture();
    const view = getPlayerView(state, "p1");
    expect(view.units.map(unit => unit.id)).toEqual(["u1"]);
    expect(view.seed).toBe("");
    expect(Object.keys(view.exploration!)).toEqual(["p1"]);
    expect(view.players[1]).toMatchObject({ resources: { gold: 0 }, technologies: [] });
    expect(view.tiles.every(tile => gridDistance(tile, state.units[0]) <= 1)).toBe(true);
    expect(isTileExplored(state, "p2", "1,2")).toBe(false);
    expect(() => getPlayerView(view, "p2")).toThrow();
    expect(() => applyAction(view, { type: "END_TURN", playerId: "p1" })).toThrow();
  });

  it("shows enemies entering vision, hides departures and newly recruited hidden units", () => {
    const state = fixture();
    const entered = updatePlayerExploration({ ...state, units: state.units.map(unit => unit.id === "u2" ? { ...unit, x: 2 } : unit) });
    expect(getPlayerView(entered, "p1").units.map(unit => unit.id)).toEqual(["u1", "u2"]);
    const left = updatePlayerExploration({ ...entered, units: [...state.units, { ...state.units[1], id: "recruit" }] });
    expect(getPlayerView(left, "p1").units.map(unit => unit.id)).toEqual(["u1"]);
  });

  it("recalculates city capture and unit death while retaining historical city and terrain snapshots", () => {
    const initial = fixture();
    const discovered = updatePlayerExploration({ ...initial, cities: [{ id: "city", ownerId: "p1", x: 4, y: 2, townHallLevel: 1 }] });
    expect(isTileVisible(discovered, "p1", "6,2")).toBe(true);
    const captured = updatePlayerExploration({ ...discovered, cities: [{ ...discovered.cities[0], ownerId: "p2", townHallLevel: 3 }], units: discovered.units.filter(unit => unit.ownerId !== "p1"), tiles: discovered.tiles.map(tile => tile.x === 4 && tile.y === 2 ? { ...tile, road: true } : tile) });
    expect(getTileVisibility(captured, "p1", "6,2")).toBe(TileVisibility.Explored);
    expect(isTileVisible(captured, "p2", "4,0")).toBe(true);
    const view = getPlayerView(captured, "p1");
    expect(view.cities[0]).toMatchObject({ ownerId: "p1", townHallLevel: 1 });
    expect(view.tiles.find(tile => positionKey(tile) === "4,2")!.road).toBeUndefined();
    expect(view.units).toEqual([]);
  });

  it("updates vision after recruitment and capture through applyAction", () => {
    let state = fixture();
    state = updatePlayerExploration({ ...state, cities: [{ id: "city", ownerId: "p1", x: 4, y: 2, townHallLevel: 1 }, { id: "neutral", ownerId: null, x: 3, y: 2, townHallLevel: 1 }] });
    const recruited = applyAction(state, { type: "RECRUIT_UNIT", playerId: "p1", cityId: "city", unitType: "warrior" });
    expect(recruited.units).toHaveLength(3);
    expect(isTileVisible(recruited, "p1", "4,3")).toBe(true);
    const captured = applyAction(state, { type: "move", playerId: "p1", unitId: "u1", to: { x: 3, y: 2 } });
    expect(captured.cities[1].ownerId).toBe("p1");
    expect(isTileVisible(captured, "p1", "3,0")).toBe(true);
  });

  it("rejects ranged attacks on unseen targets and gives information-safe movement highlights", () => {
    const state = fixture();
    state.units[0] = { ...state.units[0], unitType: "archer", range: 2 };
    state.units[1] = { ...state.units[1], x: 3 };
    expect(getAttackTargets(state, "u1")).toEqual([]);
    expect(() => applyAction(state, { type: "ATTACK_UNIT", playerId: "p1", unitId: "u1", targetId: "u2" })).toThrow();
    const view = getPlayerView(state, "p1");
    expect(getReachableTiles(view, "u1").some(tile => tile.x === 3 && tile.y === 2)).toBe(true);
    expect(() => applyAction(state, { type: "move", playerId: "p1", unitId: "u1", to: { x: 3, y: 2 } })).toThrow();
    expect(getPlayerAction("p1", { type: "move", playerId: "p2", unitId: "u2", to: { x: 4, y: 2 } })).toBeNull();
  });

  it("retains all exploration through JSON serialization and subsequent turn changes", () => {
    const moved = applyAction(fixture(), { type: "move", playerId: "p1", unitId: "u1", to: { x: 3, y: 2 } });
    const restored: GameState = JSON.parse(JSON.stringify(moved));
    expect(getPlayerView(restored, "p1")).toEqual(getPlayerView(moved, "p1"));
    expect(applyAction(restored, { type: "END_TURN", playerId: "p1" }).exploration!.p1.exploredTiles).toEqual(moved.exploration!.p1.exploredTiles);
  });

  it("removes a dead unit's vision at the combat transition boundary", () => {
    const state = fixture();
    state.units[0] = { ...state.units[0], hp: 1 };
    state.units[1] = { ...state.units[1], x: 2 };
    const next = applyAction(state, { type: "ATTACK_UNIT", playerId: "p1", unitId: "u1", targetId: "u2" });
    expect(next.units.some(unit => unit.id === "u1")).toBe(false);
    expect(computeVisibleTiles(next, "p1").size).toBe(0);
    expect(getTileVisibility(next, "p1", "1,2")).toBe(TileVisibility.Explored);
    expect(getPlayerView(next, "p1").units).toEqual([]);
  });

  it("rejects building on fogged tiles before revealing their terrain or occupancy", () => {
    const state = fixture();
    state.players[0].technologies = ["roads", "fishing"];
    for (const type of ["BUILD_ROAD", "BUILD_PORT"] as const) {
      expect(() => applyAction(state, { type, playerId: "p1", to: { x: 7, y: 2 } })).toThrow("Explore this tile first");
    }
  });

  it("clips vision to every corner and excludes diagonals at radius one", () => {
    for (const center of [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 0, y: 4 }, { x: 8, y: 4 }]) {
      const tiles = tilesInRange(fixture(), center, 2);
      expect(tiles).toHaveLength(6);
      expect(tiles.every(tile => tile.x >= 0 && tile.x < 9 && tile.y >= 0 && tile.y < 5)).toBe(true);
      expect(tilesInRange(fixture(), center, 1)).toHaveLength(3);
    }
  });
});
