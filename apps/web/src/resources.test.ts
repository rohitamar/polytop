import { describe, expect, it } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { createGame, getCityResourceTiles, type Opportunity } from "@reach/game-core";
import { createResourceLayer } from "./resources";

describe("batched resource nodes", () => {
  it("renders every resource type and reuses shared non-pickable batches", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const palette = Object.fromEntries(["wood", "leaf", "fruit", "crop", "soil", "stone", "dark", "ivory"].map(name => [name, new StandardMaterial(name, scene)])) as Parameters<typeof createResourceLayer>[1];
    const layer = createResourceLayer(scene, palette, tile => new Vector3(tile.x, 0, tile.y), (mesh, material) => { mesh.material = material; mesh.isPickable = false; });
    try {
      const state = createGame("fern-104", 8);
      const tiles = getCityResourceTiles(state, "city-1");
      const opportunities: Opportunity[] = ["orchard", "wheat", "fishery", "forest", "mine"];
      for (let i = 0; i < opportunities.length; i++) tiles[i].resource = opportunities[i];
      const owner = state.cities[0].ownerId;
      state.cities[0].ownerId = null;
      layer.update(state);
      const previous = scene.meshes.reduce((total, mesh) => total + mesh.getTotalVertices(), 0);
      const materials = scene.materials.length;
      state.cities[0].ownerId = owner;
      layer.update(state);
      expect(layer.stats().developed).toBe(0);
      expect(scene.meshes.reduce((total, mesh) => total + mesh.getTotalVertices(), 0)).toBe(previous);
      layer.select(state, "city-1", tiles[0]);
      expect(layer.stats().meshes).toBeLessThanOrEqual(9);
      expect(scene.materials.length).toBe(materials);
      expect(scene.meshes.every(mesh => !mesh.isPickable && mesh.isWorldMatrixFrozen)).toBe(true);
      const meshes = [...scene.meshes];
      layer.update(structuredClone(state));
      layer.select(state, "city-1", tiles[0]);
      expect(scene.meshes).toEqual(meshes);
      state.cities.forEach(city => city.ownerId = null);
      layer.update(state);
      expect(layer.stats().developed).toBe(0);
      expect(scene.materials.length).toBe(materials);
    } finally { layer.dispose(); scene.dispose(); engine.dispose(); }
  });
});
