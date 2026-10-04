import { placeResources } from "./world";
import { describe, expect, it } from "vitest";
import { createGame, getTile, getTileTerritory, getCityResourceTiles } from "./index";

describe("resource opportunities", () => {
  it.each([2, 4, 6, 8])("generates reproducible compatible resources for %i players", count => {
    for (const seed of ["fern-104", "coast", "orchard", "ridge"]) {
      const state = createGame(seed, count);
      expect(state.tiles).toEqual(createGame(seed, count).tiles);
      expect(state.tiles).not.toEqual(createGame(seed + "-other", count).tiles);
      expect(new Set(state.tiles.map(tile => tile.resource).filter(Boolean))).toEqual(new Set(["orchard", "wheat", "fishery", "forest", "mine"]));
      for (const tile of state.tiles) {
        if (tile.resource === "orchard" || tile.resource === "wheat") expect(tile.terrain).toBe("grass");
        if (tile.resource === "forest") expect(tile.terrain).toBe("forest");
        const near = [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dx, dy]) => getTile(state, tile.x + dx, tile.y + dy));
        if (tile.resource === "fishery") { expect(tile.terrain).toBe("water"); expect(near.some(tile => tile && tile.terrain !== "water")).toBe(true); }
        if (tile.resource === "mine") expect(tile.terrain).toBe("mountain");
        if (tile.terrain === "mountain") expect(tile.resource).toBe("mine");
      }
      for (const city of state.cities) expect(getTile(state, city.x, city.y)?.resource).toBeUndefined();
      for (const city of state.cities.filter(city => city.ownerId)) {
        const resources = getCityResourceTiles(state, city.id);
        expect(resources.length).toBeGreaterThanOrEqual(3);
        expect(resources.some(tile => tile.resource === "wheat" || tile.resource === "orchard")).toBe(true);
        for (const tile of resources) expect(getTileTerritory(state, tile.x, tile.y)?.cityId).toBe(city.id);
      }
    }
  });
  it("leaves open ground and scatters food opportunities", () => {
    const state = createGame("fern-104", 8);
    const fields = state.tiles.filter(tile => tile.resource === "orchard" || tile.resource === "wheat");
    expect(state.tiles.filter(tile => tile.terrain === "grass" && !tile.resource).length).toBeGreaterThan(30);
    const grouped = fields.filter(tile => [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => getTile(state, tile.x + dx, tile.y + dy)?.resource === tile.resource));
    expect(grouped.length / fields.length).toBeLessThan(0.7);
  });
  it("uses independent 40-percent grass resource rolls with an equal food split", () => {
    const tiles = Array.from({ length: 10000 }, (_, i) => ({ x: i % 100, y: Math.floor(i / 100), terrain: "grass" as const, resource: undefined as import("./index").Opportunity | undefined }));
    placeResources("probabilities", tiles, 100, 100);
    const wheat = tiles.filter(tile => tile.resource === "wheat").length;
    const fruit = tiles.filter(tile => tile.resource === "orchard").length;
    expect((wheat + fruit) / tiles.length).toBeGreaterThan(0.38);
    expect((wheat + fruit) / tiles.length).toBeLessThan(0.42);
    expect(wheat / (wheat + fruit)).toBeGreaterThan(0.47);
    expect(wheat / (wheat + fruit)).toBeLessThan(0.53);
    const copy = structuredClone(tiles);
    placeResources("probabilities", copy, 100, 100);
    expect(copy).toEqual(tiles);
  });
  it("supports rectangular resource placement", () => {
    const config = { width: 34, height: 16 };
    const state = createGame("fern-104", 8, config);
    expect(state.tiles).toHaveLength(544);
    expect(state).toEqual(createGame("fern-104", 8, config));
    expect(state.tiles.some(tile => tile.resource === "mine")).toBe(true);
  });
});
