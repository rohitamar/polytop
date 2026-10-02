import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { getTerritory, positionKey, type GameState, type Position } from "@reach/game-core";

export const opportunityNames = { orchard: "Orchard", wheat: "Wheat", fishery: "Fish", forest: "Forest", mine: "Metal deposit" } as const;
export const developedNames = { orchard: "Orchard", wheat: "Farm", fishery: "Fishery", forest: "Lumber camp", mine: "Mine" } as const;
type Batch = { positions: number[]; indices: number[] };
type Palette = Record<"wood" | "leaf" | "fruit" | "crop" | "soil" | "stone" | "dark" | "ivory", StandardMaterial>;

export function createResourceLayer(scene: Scene, palette: Palette, point: (position: Position) => Vector3, attach: (mesh: Mesh, mat: StandardMaterial, cast: boolean) => void) {
  let signature = "", selectionSignature = "";
  let meshes: Mesh[] = [], hints: Mesh[] = [];
  let builds = 0, opportunities = 0, developed = 0;
  let selectedTile: string | null = null;
  const batches = () => {
    const data = new Map<StandardMaterial, Batch>();
    const triangle = (mat: StandardMaterial, vertices: number[]) => {
      const batch = data.get(mat) ?? { positions: [], indices: [] };
      data.set(mat, batch);
      const offset = batch.positions.length / 3;
      batch.positions.push(...vertices);
      batch.indices.push(offset, offset + 1, offset + 2);
    };
    const box = (mat: StandardMaterial, x: number, y: number, z: number, width: number, height: number, depth: number) => {
      const v = [[-1,-1,-1], [1,-1,-1], [1,1,-1], [-1,1,-1], [-1,-1,1], [1,-1,1], [1,1,1], [-1,1,1]].map(([dx, dy, dz]) => [x + dx * width / 2, y + dy * height / 2, z + dz * depth / 2]);
      for (const [a, b, c, d] of [[0,3,2,1], [4,5,6,7], [0,1,5,4], [3,7,6,2], [0,4,7,3], [1,2,6,5]]) {
        triangle(mat, [...v[a], ...v[b], ...v[c]]);
        triangle(mat, [...v[a], ...v[c], ...v[d]]);
      }
    };
    const roof = (mat: StandardMaterial, x: number, y: number, z: number, width: number, height: number) => {
      const v = [[x - width / 2, y, z - width / 2], [x + width / 2, y, z - width / 2], [x + width / 2, y, z + width / 2], [x - width / 2, y, z + width / 2], [x, y + height, z]];
      for (const [a, b, c] of [[0,4,1], [1,4,2], [2,4,3], [3,4,0], [0,1,2], [0,2,3]]) triangle(mat, [...v[a], ...v[b], ...v[c]]);
    };
    const finish = (cast: boolean) => [...data].map(([mat, batch]) => {
      const mesh = new Mesh(cast ? "resource opportunities" : "resource selection", scene);
      const vertices = new VertexData();
      vertices.positions = batch.positions;
      vertices.indices = batch.indices;
      vertices.normals = [];
      VertexData.ComputeNormals(batch.positions, batch.indices, vertices.normals);
      vertices.applyToMesh(mesh);
      attach(mesh, mat, cast);
      mesh.freezeWorldMatrix();
      return mesh;
    });
    return { box, roof, finish };
  };
  const update = (state: GameState) => {
    const next = JSON.stringify([state.width, state.height, state.tiles.map(tile => [tile.x, tile.y, tile.terrain, tile.resource]), state.cities.map(city => [city.id, city.workedTiles])]);
    if (next === signature) return;
    signature = next;
    if (import.meta.env.DEV) builds++;
    meshes.forEach(mesh => mesh.dispose());
    const worked = new Set(state.cities.flatMap(city => city.workedTiles));
    opportunities = 0;
    developed = 0;
    const { box, roof, finish } = batches();
    for (const tile of state.tiles) {
      if (!tile.resource) continue;
      opportunities++;
      const active = worked.has(positionKey(tile));
      if (active) developed++;
      const p = point(tile);
      const variation = ((tile.x * 73 + tile.y * 151) % 97) / 97;
      if (!active) {
        p.x += (variation - 0.5) * 0.3;
        p.z += (((tile.x * 137 + tile.y * 47) % 89) / 89 - 0.5) * 0.3;
      }
      const b = (mat: StandardMaterial, x: number, y: number, z: number, w: number, h: number, d: number) => box(mat, p.x + x, p.y + y, p.z + z, w, h, d);
      const r = (mat: StandardMaterial, x: number, y: number, z: number, w: number, h: number) => roof(mat, p.x + x, p.y + y, p.z + z, w, h);
      if (tile.resource === "orchard") {
        for (const x of active ? [-0.19, 0.19] : [0]) {
          b(palette.wood, x, 0.14, 0, 0.055, 0.25, 0.055);
          r(palette.leaf, x, 0.17, 0, active ? 0.30 : 0.26, 0.22);
          b(palette.fruit, x - 0.07, 0.23, -0.1, 0.065, 0.065, 0.065);
          b(palette.fruit, x + 0.07, 0.29, 0.02, 0.06, 0.06, 0.06);
        }
        if (active) b(palette.wood, 0, 0.07, 0.28, 0.6, 0.055, 0.04);
      } else if (tile.resource === "wheat") {
        for (const z of active ? [-0.22, 0, 0.22] : [0]) {
          if (active) b(palette.soil, 0, 0.02, z, 0.67, 0.025, 0.13);
          for (const x of active ? [-0.18, 0, 0.18] : [-0.11, 0.08, 0.17]) b(palette.crop, x, active ? 0.11 : 0.07 + variation * 0.05 + x * 0.08, z + (active ? 0 : x * 0.5), 0.045, active ? 0.20 : 0.10, 0.045);
        }
      } else if (tile.resource === "fishery") {
        if (!active) {
          b(palette.ivory, 0, 0.032, 0, 0.22, 0.025, 0.075);
          b(palette.ivory, -0.14, 0.032, 0, 0.065, 0.025, 0.11);
        } else {
          for (const z of [-0.2, -0.08, 0.04]) b(palette.wood, -0.15, 0.10, z, 0.42, 0.035, 0.10);
          b(palette.wood, -0.3, 0.07, -0.2, 0.04, 0.16, 0.04);
          b(palette.dark, 0.22, 0.065, 0.17, 0.15, 0.065, 0.34);
          b(palette.wood, 0.22, 0.2, 0.17, 0.025, 0.29, 0.025);
          b(palette.ivory, 0.26, 0.25, 0.17, 0.13, 0.16, 0.018);
        }
      } else if (tile.resource === "forest" && active) {
        b(palette.wood, 0, 0.12, 0, 0.22, 0.18, 0.23);
        r(palette.crop, 0, 0.21, 0, 0.36, 0.19);
        b(palette.wood, -0.15, 0.08, 0.29, 0.4, 0.075, 0.06);
        b(palette.wood, -0.15, 0.16, 0.29, 0.3, 0.075, 0.06);
      } else if (tile.resource === "mine") {
        for (const [x, z] of [[-0.15, 0.10], [0.14, 0.15]]) {
          r(palette.stone, x, 0.01, z, 0.22, 0.17);
          b(palette.crop, x, 0.08, z - 0.1, 0.08, 0.055, 0.045);
        }
        if (active) {
          b(palette.dark, 0, 0.18, -0.15, 0.28, 0.28, 0.12);
          b(palette.wood, -0.18, 0.18, -0.23, 0.06, 0.34, 0.075);
          b(palette.wood, 0.18, 0.18, -0.23, 0.06, 0.34, 0.075);
          b(palette.wood, 0, 0.35, -0.23, 0.42, 0.075, 0.075);
        }
      }
    }
    meshes = finish(true);
  };
  const select = (state: GameState, cityId: string | null, tile: Position | null) => {
    selectedTile = tile ? positionKey(tile) : null;
    const next = JSON.stringify([signature, cityId, selectedTile, state.cities.map(city => [city.id, city.x, city.y])]);
    if (next === selectionSignature) return;
    selectionSignature = next;
    hints.forEach(mesh => mesh.dispose());
    const claims = new Map(getTerritory(state).map(tile => [positionKey(tile), tile.cityId]));
    const { box, finish } = batches();
    for (const resource of state.tiles) {
      const focused = positionKey(resource) === selectedTile;
      if (!resource.resource || !focused && (!cityId || claims.get(positionKey(resource)) !== cityId)) continue;
      const p = point(resource);
      for (const [dx, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) box(palette.crop, p.x + dx * 0.34, p.y + 0.07, p.z + dz * 0.34, focused ? 0.15 : 0.08, 0.022, focused ? 0.15 : 0.08);
    }
    hints = finish(false);
  };
  return { update, select, stats: () => ({ builds, meshes: meshes.length + hints.length, opportunities, developed, selectedTile }), dispose: () => { meshes.forEach(mesh => mesh.dispose()); hints.forEach(mesh => mesh.dispose()); } };
}
