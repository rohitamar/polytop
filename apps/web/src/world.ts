import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import "@babylonjs/core/Meshes/instancedMesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Shaders/default.vertex";
import "@babylonjs/core/Shaders/default.fragment";
import "@babylonjs/core/Shaders/shadowMap.vertex";
import "@babylonjs/core/Shaders/shadowMap.fragment";
import "@babylonjs/core/Shaders/kernelBlur.vertex";
import "@babylonjs/core/Shaders/kernelBlur.fragment";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import "@babylonjs/core/Culling/ray";
import {
  isRoadConnected,
  getTileVisibility,
  TileVisibility,
  getPortBuildingReason,
  getTerritory,
  getTile,
  getReachableTiles,
  getAttackTargets,
  type CombatPreview,
  positionKey,
  type GameState,
  type Position,
  type Tile,
  type Unit,
} from "@reach/game-core";
import { createResourceLayer } from "./resources";
import { playerStyle } from "./player-style";

export type World = ReturnType<typeof createWorld>;

export function createWorld(
  canvas: HTMLCanvasElement,
  onClick: (position: Position) => void,
  onHover: (tile: Tile | null) => void,
) {
  const engine = new Engine(canvas, true, {
    stencil: true,
    preserveDrawingBuffer: true,
  });
  const scene = new Scene(engine);
  scene.pointerMovePredicate = (mesh) => mesh.isPickable && mesh.isEnabled() && mesh.isVisible;
  scene.pointerDownPredicate = scene.pointerMovePredicate;
  scene.pointerUpPredicate = scene.pointerMovePredicate;
  const profile = { frames: [] as { cpu: number; interval: number; draws: number; active: number }[], picks: [] as number[], builds: 0, updates: 0 };
  let lastFrame = performance.now();
  if (import.meta.env.DEV) {
    const pick = scene.pick.bind(scene);
    scene.pick = (...args: Parameters<Scene["pick"]>) => {
      const start = performance.now();
      const result = pick(...args);
      profile.picks.push(performance.now() - start);
      if (profile.picks.length > 2000) profile.picks.shift();
      return result;
    };
  }
  scene.clearColor = Color4.FromHexString("#b6d6d9ff");
  scene.ambientColor = Color3.FromHexString("#a4b7ae");
  const camera = new ArcRotateCamera(
    "camera",
    -Math.PI / 4,
    0.83,
    22,
    new Vector3(0, 0, 0),
    scene,
  );
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.minZ = 0.1;
  camera.maxZ = 100;
  camera.attachControl(canvas, true);
  camera.inputs.removeByType("ArcRotateCameraMouseWheelInput");
  camera.lowerBetaLimit = 0.6;
  camera.upperBetaLimit = 1.1;
  camera.panningSensibility = 0;
  camera.angularSensibilityX = 650;
  camera.angularSensibilityY = 650;
  const pointerInput = camera.inputs.attached.pointers as unknown as {
    buttons: number[];
  };
  pointerInput.buttons = [2];
  let defaultZoom = 8.1;
  let zoom = defaultZoom;
  const resize = () => {
    engine.resize();
    const ratio = canvas.clientWidth / canvas.clientHeight;
    const span = zoom * Math.max(1, 1.25 / ratio);
    camera.orthoTop = span;
    camera.orthoBottom = -span;
    camera.orthoLeft = -span * ratio;
    camera.orthoRight = span * ratio;
  };
  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    zoom = Math.max(
      5.8,
      Math.min(defaultZoom * 1.4, zoom + event.deltaY * 0.012),
    );
    resize();
  };
  const contextMenu = (event: Event) => event.preventDefault();
  canvas.addEventListener("wheel", wheel, { passive: false });
  canvas.addEventListener("contextmenu", contextMenu);
  window.addEventListener("resize", resize);
  const fill = new HemisphericLight("sky", new Vector3(0, 1, 0), scene);
  fill.intensity = 0.65;
  fill.groundColor = Color3.FromHexString("#617b72");
  const sun = new DirectionalLight("sun", new Vector3(-0.5, -1, 0.4), scene);
  sun.position = new Vector3(8, 18, -8);
  sun.intensity = 0.85;
  const shadows = new ShadowGenerator(2048, sun);
  shadows.useBlurExponentialShadowMap = true;
  shadows.blurKernel = 24;
  shadows.setDarkness(0.25);
  const shadowMap = shadows.getShadowMap()!;
  shadowMap.refreshRate = 0;
  let shadowDirty = true;
  let shadowCamera = "";
  const material = (name: string, color: string, alpha = 1) => {
    const result = new StandardMaterial(name, scene);
    result.diffuseColor = Color3.FromHexString(color);
    result.specularColor = Color3.Black();
    result.alpha = alpha;
    return result;
  };
  const shadedMaterials = new Map<StandardMaterial, StandardMaterial>();
  const shaded = (mat: StandardMaterial) => {
    if (mat.name.endsWith(" remembered")) return mat;
    let result = shadedMaterials.get(mat);
    if (!result) {
      result = mat.clone(`${mat.name} remembered`);
      const gray = (mat.diffuseColor.r + mat.diffuseColor.g + mat.diffuseColor.b) / 3;
      result.diffuseColor = mat.diffuseColor.scale(0.58).add(new Color3(gray, gray, gray).scale(0.12));
      result.emissiveColor = mat.emissiveColor.scale(0.7);
      shadedMaterials.set(mat, result);
    }
    return result;
  };
  let rememberedModel = false;
  const unitMaterials = new WeakMap<AbstractMesh, StandardMaterial>();
  const fogMaterial = (mat: StandardMaterial, state: GameState, tile: Position) =>
    getTileVisibility(state, state.perspectiveId!, tile) === TileVisibility.Explored ? shaded(mat) : mat;
  const grass = [
    material("meadow", "#9caf70"),
    material("sage", "#aab97b"),
    material("moss", "#91a76c"),
  ];
  const water = material("lagoon", "#60a6ae");
  const earth = material("earth", "#657b68");
  const bark = material("cedar", "#796348");
  const leaves = [
    material("pine", "#376d57"),
    material("pine light", "#51866a"),
  ];
  const rock = material("slate", "#89968e");
  const snow = material("chalk", "#e5e9d5");
  const gold = material("brass", "#d9ab58");
  const accents = Array.from({ length: 8 }, (_, i) => i).map((index) =>
    material(`player-${index}`, playerStyle(index).accent),
  );
  const ringMaterials = Array.from({ length: 8 }, (_, i) => i).map((index) =>
    material(`ring-${index}`, playerStyle(index).ring),
  );
  const territoryMaterials = Array.from({ length: 8 }, (_, index) => {
    const border = material(`territory-${index}`, playerStyle(index).accent);
    border.diffuseColor = border.diffuseColor.scale(0.55);
    border.emissiveColor = border.diffuseColor;
    border.disableLighting = true;
    return border;
  });
  const armor = material("ivory", "#ece5c9");
  const dark = material("ink", "#344f50");
  const face = material("skin", "#dca778");
  const foam = material("ripples", "#a7dbd7", 0.6);
  const moveMaterial = material("reachable", "#f5e5a6", 0.46);
  moveMaterial.emissiveColor = Color3.FromHexString("#645a24");
  const attackMaterial = material("attack target", "#d96956", 0.8);
  attackMaterial.emissiveColor = Color3.FromHexString("#7a3025");
  const hoverMaterial = material("hover", "#ffffff", 0.23);
  hoverMaterial.emissiveColor = Color3.FromHexString("#698b7b");
  const selectionMaterial = material("selection", "#ffe29b");
  selectionMaterial.emissiveColor = Color3.FromHexString("#a87c32");
  const root = new TransformNode("map", scene);
  let decorations: AbstractMesh[] = [];
  let markers: AbstractMesh[] = [];
  let buildingTerrain = false;
  const terrainSources = new Map<string, Mesh>();
  const repeated = (key: string, create: () => Mesh) => {
    if (!buildingTerrain) return create();
    const source = terrainSources.get(key);
    if (source) {
      const instance = source.createInstance(source.name);
      instance.parent = root;
      instance.isPickable = false;
      shadows.addShadowCaster(instance);
      decorations.push(instance);
      return instance;
    }
    const mesh = create();
    terrainSources.set(key, mesh);
    return mesh;
  };
  let currentState: GameState;
  let selected: string | null = null;
  const cityModels = new Map<
    string,
    { node: TransformNode; signature: string }
  >();
  const neutral = material("neutral city", "#89968e");
  const warriors = new Map<string, TransformNode>();
  const healthLabels = new Map<string, DynamicTexture>();
  const healthValues = new Map<string, string>();
  let combatAnimating = false;
  const ownerRings = new Map<string, Mesh>();
  const tileHeight = (tile?: Tile) =>
    tile?.terrain === "water" ? -0.12 : 0.13;
  const tilePoint = (p: Position, surface = false) =>
    new Vector3(
      p.x - (currentState.width - 1) / 2,
      tileHeight(getTile(currentState, p.x, p.y)) + (surface && getTile(currentState, p.x, p.y)?.terrain === "mountain" ? 1.05 : 0),
      p.y - (currentState.height - 1) / 2,
    );
  const solid = (
    mesh: Mesh,
    mat: StandardMaterial,
    parent: TransformNode = root,
    cast = true,
  ) => {
    mesh.material = rememberedModel ? shaded(mat) : mat;
    mesh.parent = parent;
    mesh.isPickable = false;
    if (buildingTerrain) decorations.push(mesh);
    if (cast) shadows.addShadowCaster(mesh);
    return mesh;
  };
  const box = (
    name: string,
    width: number,
    height: number,
    depth: number,
    mat: StandardMaterial,
    parent?: TransformNode,
  ) => {
    mat = rememberedModel ? shaded(mat) : mat;
    return mat.alpha < 1
    ? solid(CreateBox(name, { width, height, depth }, scene), mat, parent)
    : repeated(`box:${width}:${height}:${depth}:${mat.name}`, () => solid(CreateBox(name, { width, height, depth }, scene), mat, parent));
  };
  const cone = (
    name: string,
    height: number,
    bottom: number,
    mat: StandardMaterial,
    parent?: TransformNode,
    top = 0,
  ) => {
    mat = rememberedModel ? shaded(mat) : mat;
    return repeated(`cone:${height}:${bottom}:${top}:${mat.name}`, () => {
      const mesh = CreateCylinder(
        name,
        { height, diameterBottom: bottom, diameterTop: top, tessellation: 5 },
        scene,
      );
      mesh.convertToFlatShadedMesh();
      return solid(mesh, mat, parent);
    });
  };
  const resourceLayer = createResourceLayer(scene, {
    wood: bark, leaf: leaves[1], fruit: material("fruit", "#d8794e"), crop: gold, soil: earth, stone: rock, dark, ivory: armor,
  }, tilePoint, (mesh, mat, cast) => {
    solid(mesh, mat, root, cast);
    if (cast) mesh.onDisposeObservable.add(() => shadows.removeShadowCaster(mesh));
    shadowDirty = true;
  }, fogMaterial);
  let selectedResource: Position | null = null;
  const base = box("floating island", 1, 0.62, 1, earth);
  base.position.y = -0.45;
  const bottom = box("island foundation", 1, 0.22, 1, dark);
  bottom.position.y = -0.84;
  const floor = solid(
    CreateGround("background", { width: 200, height: 200 }, scene),
    material("mist", "#94b5b6"),
    root,
    false,
  );
  floor.position.y = -1.15;
  floor.receiveShadows = true;
  const createWarrior = (unit: Unit, playerIndex: number) => {
    const warrior = new TransformNode(unit.id, scene);
    const cloak = accents[playerIndex % accents.length];
    for (const x of [-0.12, 0.12]) {
      const boot = box("boot", 0.16, 0.17, 0.23, dark, warrior);
      boot.position.set(x, 0.12, -0.02);
    }
    const body = cone("tunic", 0.43, 0.43, armor, warrior, 0.33);
    body.position.y = 0.4;
    const cape = box("cape", 0.39, 0.47, 0.1, cloak, warrior);
    cape.position.set(0, 0.42, 0.17);
    cape.rotation.x = -0.2;
    const head = solid(
      CreateSphere("head", { diameter: 0.3, segments: 4 }, scene),
      face,
      warrior,
    );
    head.position.y = 0.78;
    const helmet = cone("helmet", 0.23, 0.39, armor, warrior, 0.22);
    helmet.position.y = 0.9;
    const plume = box("plume", 0.08, 0.24, 0.22, cloak, warrior);
    plume.position.y = 1.09;
    const visor = box("visor", 0.24, 0.055, 0.07, dark, warrior);
    visor.position.set(0, 0.8, -0.145);
    const shield = cone("shield", 0.1, 0.43, gold, warrior, 0.43);
    shield.rotation.x = Math.PI / 2;
    shield.position.set(-0.29, 0.44, -0.11);
    const emblem = box("shield emblem", 0.05, 0.22, 0.12, armor, warrior);
    emblem.position.set(-0.29, 0.44, -0.15);
    const blade = box("blade", 0.075, 0.53, 0.065, snow, warrior);
    blade.position.set(0.3, 0.58, -0.05);
    blade.rotation.z = -0.15;
    const guard = box("guard", 0.23, 0.065, 0.08, gold, warrior);
    guard.position.set(0.26, 0.34, -0.05);
    if (unit.unitType === "archer") {
      shield.setEnabled(false);
      emblem.setEnabled(false);
      blade.setEnabled(false);
      guard.setEnabled(false);
      const bow = solid(CreateTorus("bow", { diameter: 0.48, thickness: 0.025, tessellation: 12 }, scene), bark, warrior);
      bow.rotation.x = Math.PI / 2;
      bow.position.set(0.3, 0.58, -0.05);
      const string = box("bow string", 0.015, 0.48, 0.015, snow, warrior);
      string.position.copyFrom(bow.position);
    } else if (unit.unitType === "rider") {
      const mount = box("mount", 0.42, 0.3, 0.72, bark, warrior);
      mount.position.set(0, 0.3, 0.05);
      const head = box("mount head", 0.19, 0.3, 0.26, bark, warrior);
      head.position.set(0, 0.42, -0.36);
    } else if (unit.unitType === "sailor") {
      shield.setEnabled(false);
      emblem.setEnabled(false);
      blade.setEnabled(false);
      guard.setEnabled(false);
      const hull = box("sailor hull", 0.65, 0.23, 0.90, bark, warrior);
      hull.position.y = 0.08;
      const mast = box("sailor mast", 0.035, 1.2, 0.035, bark, warrior);
      mast.position.set(0, 0.68, 0.27);
      const sail = box("sailor sail", 0.50, 0.52, 0.025, cloak, warrior);
      sail.position.set(0.20, 0.96, 0.27);
    } else if (unit.unitType === "swordsman") {
      blade.scaling.set(1.7, 1.3, 1.7);
      shield.scaling.set(1.2, 1.2, 1.2);
    }
    const raft = box(`raft-${unit.id}`, 0.78, 0.18, 0.95, bark, warrior);
    raft.position.y = 0.06;
    raft.setEnabled(!!unit.embarked);
    for (const mesh of warrior.getChildMeshes()) {
      mesh.isPickable = true;
      mesh.metadata = { unitId: unit.id };
    }
    const ring = solid(
      CreateTorus(
        `owner-${unit.id}`,
        { diameter: 0.66, thickness: 0.035, tessellation: 32 },
        scene,
      ),
      ringMaterials[playerIndex % ringMaterials.length],
      warrior,
      false,
    );
    ring.position.y = 0.024;
    ownerRings.set(unit.id, ring);
    const labelTexture = new DynamicTexture(
      `hp-${unit.id}`,
      { width: 256, height: 96 },
      scene,
      false,
    );
    labelTexture.hasAlpha = true;
    const labelMaterial = material(`hp-material-${unit.id}`, "#ffffff");
    labelMaterial.diffuseTexture = labelTexture;
    labelMaterial.emissiveColor = Color3.White();
    labelMaterial.disableLighting = true;
    const label = solid(
      CreatePlane(`health-${unit.id}`, { width: 0.9, height: 0.34 }, scene),
      labelMaterial,
      warrior,
      false,
    );
    label.position.y = 1.45;
    label.billboardMode = Mesh.BILLBOARDMODE_ALL;
    healthLabels.set(unit.id, labelTexture);
    warriors.set(unit.id, warrior);
    warrior.position.copyFrom(tilePoint(unit, true));
    shadowDirty = true;
  };
  const halo = solid(
    CreateTorus(
      "selected unit",
      { diameter: 0.79, thickness: 0.045, tessellation: 48 },
      scene,
    ),
    selectionMaterial,
    root,
    false,
  );
  const hover = box("hover", 0.95, 0.014, 0.95, hoverMaterial);
  hover.setEnabled(false);
  let animation: {
    unitId: string;
    path: Vector3[];
    started: number;
    done: () => void;
  } | null = null;
  let hoveredKey = "";
  let press: { x: number; y: number; pointerId: number; dragged: boolean } | null = null;
  scene.onPointerObservable.add((info) => {
    const event = info.event as PointerEvent;
    if (info.type === PointerEventTypes.POINTERDOWN) {
      press = event.button === 0 ? { x: event.clientX, y: event.clientY, pointerId: event.pointerId, dragged: false } : null;
      return;
    }
    if (press && event.pointerId === press.pointerId &&
      (Math.abs(event.clientX - press.x) > 10 || Math.abs(event.clientY - press.y) > 10)) press.dragged = true;
    if (info.type === PointerEventTypes.POINTERUP) {
      const clicked = event.button === 0 && press?.pointerId === event.pointerId && !press.dragged;
      press = null;
      if (!clicked) return;
    }
    const pick = info.pickInfo;
    const metadata = pick?.pickedMesh?.metadata;
    const pickedUnit = currentState?.units.find(
      (unit) => unit.id === metadata?.unitId,
    );
    const tile = pickedUnit
      ? currentState?.tiles.find(
          (t) => t.x === pickedUnit.x && t.y === pickedUnit.y,
        )
      : metadata?.tile ? getTile(currentState, metadata.tile.x, metadata.tile.y) : metadata?.fog && pick?.pickedPoint ? {
          x: Math.floor(pick.pickedPoint.x + currentState.width / 2),
          y: Math.floor(pick.pickedPoint.z + currentState.height / 2),
        } : undefined;
    if (info.type === PointerEventTypes.POINTERMOVE) {
      const key = tile ? positionKey(tile) : "";
      if (key !== hoveredKey) {
        hoveredKey = key;
        onHover(tile && getTileVisibility(currentState, currentState.perspectiveId!, tile) === TileVisibility.Visible ? getTile(currentState, tile.x, tile.y) ?? null : null);
      }
      hover.setEnabled(!!tile);
      if (tile)
        hover.position.copyFrom(tilePoint(tile, true).add(new Vector3(0, 0.027, 0)));
      canvas.style.cursor =
        pickedUnit &&
        pickedUnit.ownerId !== currentState.activePlayerId &&
        (!selected ||
          !getAttackTargets(currentState, selected).some(
            (unit) => unit.id === pickedUnit.id,
          ))
          ? "not-allowed"
          : tile
            ? "pointer"
            : "grab";
    } else if (tile && (info.event as PointerEvent).button === 0) onClick(tile);
  }, PointerEventTypes.POINTERMOVE | PointerEventTypes.POINTERDOWN | PointerEventTypes.POINTERUP);
  let terrainSignature = "";
  const rebuild = (state: GameState, terrainOnly = false) => {
    terrainSignature = JSON.stringify([state.width, state.height, state.perspectiveId, state.tiles.map(tile => [tile.x, tile.y, tile.terrain, getTileVisibility(state, state.perspectiveId!, tile)])]);
    shadowDirty = true;
    if (import.meta.env.DEV) profile.builds++;
    for (const mesh of decorations) mesh.dispose();
    decorations = [];
    terrainSources.clear();
    for (const city of cityModels.values()) city.node.dispose();
    cityModels.clear();
    currentState = state;
    base.scaling.set(state.width + 0.15, 1, state.height + 0.15);
    bottom.scaling.set(state.width - 0.2, 1, state.height - 0.2);
    if (!terrainOnly) {
    defaultZoom = Math.max(state.width, state.height) * 0.81;
    zoom = defaultZoom;
    camera.radius = Math.max(state.width, state.height) * 2.2;
    camera.maxZ = Math.max(state.width, state.height) * 5;
    resize();
    }
    buildingTerrain = true;
    const ripples: Mesh[] = [];
    for (const tile of state.tiles) {
      rememberedModel = getTileVisibility(state, state.perspectiveId!, tile) === TileVisibility.Explored;
      const point = tilePoint(tile);
      const terrain = box(
        `tile-${tile.x}-${tile.y}`,
        0.975,
        tile.terrain === "water" ? 0.15 : 0.4,
        0.975,
        tile.terrain === "water" ? water : grass[(tile.x * 3 + tile.y * 7) % 3],
      );
      terrain.position.set(
        point.x,
        point.y - (tile.terrain === "water" ? 0.075 : 0.2),
        point.z,
      );
      terrain.isPickable = true;
      terrain.metadata = { tile };
      terrain.receiveShadows = true;
      if (tile.terrain === "forest") {
        for (const [dx, dz, scale] of [
          [-0.19, 0.12, 0.85],
          [0.2, -0.14, 1.1],
          [-0.2, -0.23, 0.65],
        ]) {
          const trunk = cone("trunk", 0.4 * scale, 0.1, bark);
          trunk.position.set(point.x + dx, point.y + 0.2 * scale, point.z + dz);
          for (let level = 0; level < 2; level++) {
            const leaf = cone(
              "cedar canopy",
              0.63 * scale,
              (0.48 - level * 0.13) * scale,
              leaves[(tile.x + level) % 2],
            );
            leaf.position.set(
              point.x + dx,
              point.y + (0.5 + level * 0.23) * scale,
              point.z + dz,
            );
          }
        }
      }
      if (tile.terrain === "mountain") {
        const peak = cone("mountain", 1.08, 0.91, rock);
        peak.position.set(point.x, point.y + 0.54, point.z);
        peak.rotation.y = tile.x;
        peak.isPickable = true;
        peak.metadata = { tile };
        const cap = cone("snowcap", 0.33, 0.28, snow);
        cap.position.set(point.x, point.y + 0.93, point.z);
        cap.rotation.y = tile.x;
        cap.isPickable = true;
        cap.metadata = { tile };
      }
      if (tile.terrain === "water" && !rememberedModel) {
        for (let i = 0; i < 2; i++) {
          const ripple = box("ripple", 0.18 + i * 0.12, 0.007, 0.018, foam);
          ripples.push(ripple as Mesh);
          ripple.position.set(
            point.x - 0.1 + i * 0.23,
            point.y + 0.01,
            point.z - 0.19 + i * 0.35,
          );
        }
      }
    }
    rememberedModel = false;
    if (ripples.length) {
      const rippleSet = new Set<AbstractMesh>(ripples);
      for (const ripple of ripples) shadows.removeShadowCaster(ripple);
      const merged = Mesh.MergeMeshes(ripples, true, true);
      if (!merged) throw new Error("Could not batch water ripples");
      merged.name = "water ripples";
      merged.alphaIndex = 0;
      solid(merged, foam);
      decorations = decorations.filter(mesh => !rippleSet.has(mesh));
    }
    buildingTerrain = false;
    for (const mesh of decorations) mesh.freezeWorldMatrix();
    if (!terrainOnly) {
    for (const warrior of warriors.values()) warrior.dispose();
    warriors.clear();
    ownerRings.clear();
    for (const texture of healthLabels.values()) texture.dispose();
    healthLabels.clear();
    healthValues.clear();
    for (const unit of state.units)
      createWarrior(
        unit,
        state.players.findIndex((player) => player.id === unit.ownerId),
      );
    }
    hover.setEnabled(false);
    hoveredKey = "";
    onHover(null);
  };
  let selectedCity: string | null = null;
  let territorySignature = "";
  let territoryBuilds = 0;
  let territoryMeshes: Mesh[] = [];
  const updateTerritory = (state: GameState, cityId: string | null) => {
    const signature = JSON.stringify([state.width, state.height, state.tiles, state.exploration?.[state.perspectiveId!]?.visibleTiles, state.cities.map(city => [city.id, city.x, city.y, city.ownerId]), cityId]);
    if (signature === territorySignature) return;
    territorySignature = signature;
    if (import.meta.env.DEV) territoryBuilds++;
    territoryMeshes.forEach(mesh => mesh.dispose());
    territoryMeshes = [];
    const claims = getTerritory(state);
    const byPosition = new Map(claims.map(tile => [positionKey(tile), tile]));
    const batches = new Map<StandardMaterial, { positions: number[]; indices: number[] }>();
    const quad = (mat: StandardMaterial, x: number, y: number, z: number, width: number, depth: number) => {
      const batch = batches.get(mat) ?? { positions: [], indices: [] };
      batches.set(mat, batch);
      const offset = batch.positions.length / 3;
      batch.positions.push(x - width / 2, y, z - depth / 2, x + width / 2, y, z - depth / 2, x + width / 2, y, z + depth / 2, x - width / 2, y, z + depth / 2);
      batch.indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
    };
    for (const tile of claims) {
      if (!tile.cityId || !tile.playerId) continue;
      const point = tilePoint(tile);
      const index = state.players.findIndex(player => player.id === tile.playerId);
      if (index < 0) continue;
      const mat = fogMaterial(territoryMaterials[index], state, tile);
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const neighbor = byPosition.get(positionKey({ x: tile.x + dx, y: tile.y + dy }));
        if (neighbor?.cityId && neighbor.playerId === tile.playerId) continue;
        quad(mat, point.x + dx * 0.465, point.y + 0.035, point.z + dy * 0.465, dx ? 0.085 : 0.97, dy ? 0.085 : 0.97);
      }
      if (tile.cityId === cityId) quad(moveMaterial, point.x, point.y + 0.022, point.z, 0.91, 0.91);
    }
    for (const [mat, batch] of batches) {
      const mesh = new Mesh("territory", scene);
      const data = new VertexData();
      data.positions = batch.positions;
      data.indices = batch.indices;
      data.normals = [];
      VertexData.ComputeNormals(batch.positions, batch.indices, data.normals);
      data.applyToMesh(mesh);
      solid(mesh, mat, root, false);
      mesh.freezeWorldMatrix();
      territoryMeshes.push(mesh);
    }
  };
  const roadMeshes = new Map<string, { node: TransformNode; signature: string }>();
  const updateRoads = (state: GameState) => {
    for (const [key, model] of roadMeshes) {
      if (!state.tiles.some(tile => positionKey(tile) === key && tile.road)) { model.node.dispose(); roadMeshes.delete(key); }
    }
    const connected = (x: number, y: number) => isRoadConnected(state, { x, y });
    for (const tile of state.tiles.filter(tile => tile.road)) {
      const edges = [[0, -1], [1, 0], [0, 1], [-1, 0]].filter(([dx, dy]) => connected(tile.x + dx, tile.y + dy));
      const key = positionKey(tile);
      const signature = `${getTileVisibility(state, state.perspectiveId!, tile)}:${state.width}:${state.height}:${edges.map(edge => edge.join(",")).join(";")}`;
      if (roadMeshes.get(key)?.signature === signature) continue;
      roadMeshes.get(key)?.node.dispose();
      rememberedModel = getTileVisibility(state, state.perspectiveId!, tile) === TileVisibility.Explored;
      const node = new TransformNode(`road-${key}`, scene);
      node.position.copyFrom(tilePoint(tile));
      box("road center", 0.28, 0.035, 0.28, snow, node).position.y = 0.045;
      for (const [dx, dy] of edges) {
        const edge = box("road segment", dx ? 0.5 : 0.22, 0.035, dy ? 0.5 : 0.22, snow, node);
        edge.position.set(dx * 0.25, 0.045, dy * 0.25);
      }
      for (const mesh of node.getChildMeshes()) mesh.isPickable = false;
      roadMeshes.set(key, { node, signature });
      rememberedModel = false;
    }
  };
  const portMeshes = new Map<string, TransformNode>();
  let portSignature = "";
  const updatePorts = (state: GameState) => {
    const signature = JSON.stringify(state.tiles.filter(tile => tile.port).map(tile => [positionKey(tile), getTileVisibility(state, state.perspectiveId!, tile)]));
    if (signature !== portSignature) { portMeshes.forEach(node => node.dispose()); portMeshes.clear(); portSignature = signature; }
    for (const [key, node] of portMeshes) if (!state.tiles.some(tile => tile.port && positionKey(tile) === key)) { node.dispose(); portMeshes.delete(key); }
    for (const tile of state.tiles.filter(tile => tile.port)) {
      const key = positionKey(tile);
      if (portMeshes.has(key)) continue;
      rememberedModel = getTileVisibility(state, state.perspectiveId!, tile) === TileVisibility.Explored;
      const node = new TransformNode(`port-${key}`, scene);
      node.position.copyFrom(tilePoint(tile));
      box("port dock", 0.8, 0.12, 0.7, bark, node).position.y = 0.08;
      for (const x of [-0.32, 0.32]) for (const z of [-0.26, 0.26]) box("port piling", 0.08, 0.4, 0.08, bark, node).position.set(x, 0.16, z);
      for (const mesh of node.getChildMeshes()) mesh.isPickable = false;
      portMeshes.set(key, node);
      rememberedModel = false;
    }
  };
  const portHighlightMaterial = material("port site", "#ffbf36");
  portHighlightMaterial.disableLighting = true;
  portHighlightMaterial.emissiveColor = Color3.FromHexString("#ffbf36");
  let portPlacementPlayer: string | null = null;
  let portMarkers: AbstractMesh[] = [];
  const updatePortHighlights = (state: GameState) => {
    portMarkers.forEach(mesh => mesh.dispose());
    portMarkers = [];
    if (!portPlacementPlayer) return;
    for (const tile of state.tiles) {
      if (getPortBuildingReason(state, portPlacementPlayer, tile) !== null) continue;
      const marker = solid(CreateTorus("legal port", { diameter: 0.8, thickness: 0.065, tessellation: 24 }, scene), portHighlightMaterial, root, false);
      marker.position.copyFrom(tilePoint(tile));
      marker.position.y += 0.065;
      marker.isPickable = false;
      portMarkers.push(marker);
    }
  };
  const setPortPlacement = (playerId: string | null) => { portPlacementPlayer = playerId; updatePortHighlights(currentState); };
  const selectCity = (cityId: string | null) => { selectedCity = cityId; updateTerritory(currentState, cityId); resourceLayer.select(currentState, cityId, selectedResource); };
  const unexploredFog = material("unexplored fog", "#c9d6ff");
  unexploredFog.disableLighting = true;
  unexploredFog.emissiveColor = Color3.FromHexString("#c9d6ff");
  unexploredFog.backFaceCulling = false;
  const cloudFog = material("cloud fog", "#ffffff");
  cloudFog.disableLighting = true;
  cloudFog.emissiveColor = Color3.White();
  cloudFog.backFaceCulling = false;
  const cloudVariation = (x: number, y: number) => {
    const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return value - Math.floor(value);
  };
  let fogMeshes: Mesh[] = [];
  let fogSignature = "";
  const updateFog = (state: GameState) => {
    const memory = state.exploration?.[state.perspectiveId!];
    const signature = JSON.stringify([state.width, state.height, state.perspectiveId, memory?.exploredTiles]);
    if (signature === fogSignature) return;
    fogSignature = signature;
    fogMeshes.forEach(mesh => mesh.dispose());
    fogMeshes = [];
    const explored = new Set(memory?.exploredTiles ?? []);
    const unknown = (x: number, y: number) => x >= 0 && y >= 0 && x < state.width && y < state.height && !explored.has(positionKey({ x, y }));
    const positions: number[] = [], indices: number[] = [], normals: number[] = [], colors: number[] = [];
    const pickPositions: number[] = [], pickIndices: number[] = [];
    const light = new Vector3(-0.5, 1, -0.7).normalize();
    const facet = (a: Vector3, b: Vector3, c: Vector3, wall = false) => {
      const normal = Vector3.Cross(b.subtract(a), c.subtract(a)).normalize();
      if (!wall && normal.y < 0) normal.scaleInPlace(-1);
      const brightness = Math.max(0, Vector3.Dot(normal, light));
      const color = wall
        ? new Color3(0.65 + brightness * 0.22, 0.73 + brightness * 0.2, 0.98)
        : new Color3(0.64 + brightness * 0.36, 0.73 + brightness * 0.27, 1);
      const offset = positions.length / 3;
      for (const point of [a, b, c]) {
        positions.push(point.x, point.y, point.z);
        normals.push(normal.x, normal.y, normal.z);
        colors.push(color.r, color.g, color.b, 1);
      }
      indices.push(offset, offset + 1, offset + 2);
    };
    const corner = (x: number, y: number) => new Vector3(
      x / 2 - state.width / 2,
      0.32 + cloudVariation(x, y) * 0.12,
      y / 2 - state.height / 2,
    );
    const wall = (a: Vector3, b: Vector3) => {
      const baseA = new Vector3(a.x, 0.15, a.z), baseB = new Vector3(b.x, 0.15, b.z);
      facet(a, baseA, b, true);
      facet(b, baseA, baseB, true);
    };
    for (let y = 0; y < state.height; y++) for (let x = 0; x < state.width; x++) {
      if (!unknown(x, y)) continue;
      const px = x - state.width / 2, pz = y - state.height / 2;
      const offset = pickPositions.length / 3;
      pickPositions.push(px, 0.15, pz, px + 1, 0.15, pz, px + 1, 0.15, pz + 1, px, 0.15, pz + 1);
      pickIndices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
      for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
        const cx = x * 2 + sx, cy = y * 2 + sy;
        const a = corner(cx, cy), b = corner(cx + 1, cy), c = corner(cx + 1, cy + 1), d = corner(cx, cy + 1);
        const peak = new Vector3(
          a.x + 0.2 + cloudVariation(cx + 0.3, cy) * 0.1,
          0.53 + cloudVariation(cx + 0.7, cy + 0.4) * 0.17,
          a.z + 0.2 + cloudVariation(cx, cy + 0.6) * 0.1,
        );
        facet(a, peak, b);
        facet(b, peak, c);
        facet(c, peak, d);
        facet(d, peak, a);
        if (sy === 0 && !unknown(x, y - 1)) wall(b, a);
        if (sx === 1 && !unknown(x + 1, y)) wall(c, b);
        if (sy === 1 && !unknown(x, y + 1)) wall(d, c);
        if (sx === 0 && !unknown(x - 1, y)) wall(a, d);
      }
    }
    if (!positions.length) return;
    const clouds = new Mesh("faceted fog clouds", scene);
    const cloudData = new VertexData();
    cloudData.positions = positions; cloudData.indices = indices; cloudData.normals = normals; cloudData.colors = colors;
    cloudData.applyToMesh(clouds);
    solid(clouds, cloudFog, root, false);
    clouds.isPickable = false;
    clouds.freezeWorldMatrix();
    fogMeshes.push(clouds);
    const surface = new Mesh("unexplored fog surface", scene);
    const pickData = new VertexData();
    pickData.positions = pickPositions; pickData.indices = pickIndices; pickData.normals = [];
    VertexData.ComputeNormals(pickPositions, pickIndices, pickData.normals);
    pickData.applyToMesh(surface);
    solid(surface, unexploredFog, root, false);
    surface.isPickable = true;
    surface.metadata = { fog: true };
    surface.freezeWorldMatrix();
    fogMeshes.push(surface);
  };
  const update = (state: GameState, selectedUnitId: string | null) => {
    const renderedUnits = [...state.units, ...(state.rememberedUnits ?? [])];
    const rememberedUnitIds = new Set(state.rememberedUnits?.map(unit => unit.id));
    const signature = JSON.stringify([state.width, state.height, state.perspectiveId, state.tiles.map(tile => [tile.x, tile.y, tile.terrain, getTileVisibility(state, state.perspectiveId!, tile)])]);
    if (signature !== terrainSignature) rebuild(state, true);
    updateFog(state);
    for (const [id, model] of cityModels) if (!state.cities.some(city => city.id === id)) { model.node.dispose(); cityModels.delete(id); }
    for (const [id, model] of warriors) if (!renderedUnits.some(unit => unit.id === id)) {
      model.dispose(); warriors.delete(id); ownerRings.delete(id);
      healthLabels.get(id)?.dispose(); healthLabels.delete(id); healthValues.delete(id);
    }
    shadowDirty = true;
    if (import.meta.env.DEV) profile.updates++;
    currentState = state;
    if (hoveredKey) {
      const [x, y] = hoveredKey.split(",").map(Number);
      onHover(getTileVisibility(state, state.perspectiveId!, { x, y }) === TileVisibility.Visible ? getTile(state, x, y) ?? null : null);
    }
    updateTerritory(state, selectedCity);
    updateRoads(state);
    updatePorts(state);
    updatePortHighlights(state);
    resourceLayer.update(state);
    resourceLayer.select(state, selectedCity, selectedResource);
    selected = selectedUnitId;
    for (const city of state.cities) {
      const signature = `${city.ownerId}:${city.townHallLevel}:${getTileVisibility(state, state.perspectiveId!, city)}`;
      if (cityModels.get(city.id)?.signature === signature) continue;
      cityModels.get(city.id)?.node.dispose();
      rememberedModel = getTileVisibility(state, state.perspectiveId!, city) === TileVisibility.Explored;
      const node = new TransformNode(city.id, scene);
      node.position.copyFrom(tilePoint(city));
      const index = state.players.findIndex(
        (player) => player.id === city.ownerId,
      );
      const roof = index < 0 ? neutral : accents[index];
      const plaza = box("city plaza", 0.88, 0.06, 0.88, snow, node);
      plaza.position.y = 0.03;
      const level = city.townHallLevel;
      const hallMaterial = level === 1 ? bark : armor;
      const hallWidth = level === 1 ? 0.42 : 0.5;
      const hallHeight = level === 1 ? 0.32 : level === 2 ? 0.5 : 0.62;
      const hall = box("town center hall", hallWidth, hallHeight, 0.4, hallMaterial, node);
      hall.position.set(0, 0.06 + hallHeight / 2, 0.2);
      const hallRoof = solid(CreateCylinder("town center roof", { height: 0.24, diameterBottom: hallWidth * 1.65, diameterTop: 0, tessellation: 4 }, scene), roof, node);
      hallRoof.rotation.y = Math.PI / 4;
      hallRoof.scaling.z = 0.85;
      hallRoof.position.set(0, hallHeight + 0.18, 0.2);
      const doorway = box("town center entrance", 0.12, 0.22, 0.025, dark, node);
      doorway.position.set(0, 0.17, -0.015);
      for (const x of [-0.15, 0.15]) {
        const window = box("town center window", 0.075, 0.09, 0.025, gold, node);
        window.position.set(x, hallHeight * 0.65 + 0.06, -0.015);
      }
      if (level === 1) {
        for (const x of [-0.24, 0.24]) box("timber porch post", 0.035, 0.3, 0.035, bark, node).position.set(x, 0.21, -0.13);
        box("timber porch roof", 0.54, 0.045, 0.19, roof, node).position.set(0, 0.38, -0.1);
      } else if (level === 2) {
        box("stone hall wing", 0.22, 0.3, 0.36, armor, node).position.set(-0.31, 0.21, 0.2);
        box("stone wing roof", 0.27, 0.07, 0.4, roof, node).position.set(-0.31, 0.4, 0.2);
        box("town bell tower", 0.17, 0.67, 0.2, armor, node).position.set(0.32, 0.395, 0.25);
        box("bell tower opening", 0.11, 0.14, 0.025, dark, node).position.set(0.32, 0.61, 0.135);
        cone("bell tower roof", 0.17, 0.29, roof, node).position.set(0.32, 0.81, 0.25);
      } else {
        for (const x of [-0.34, 0.34]) {
          box("fortified town tower", 0.19, 0.77, 0.21, armor, node).position.set(x, 0.445, 0.24);
          box("tower parapet", 0.24, 0.09, 0.26, roof, node).position.set(x, 0.875, 0.24);
          for (const z of [0.14, 0.34]) box("tower battlement", 0.08, 0.09, 0.065, armor, node).position.set(x, 0.965, z);
          box("tower window", 0.07, 0.17, 0.025, dark, node).position.set(x, 0.58, 0.12);
        }
        box("town center steps", 0.29, 0.08, 0.19, rock, node).position.set(0, 0.09, -0.13);
        box("fortified rear wall", 0.8, 0.22, 0.055, armor, node).position.set(0, 0.17, 0.4);
      }
      const poleHeight = level === 3 ? 1.12 : 0.75;
      const pole = box("town center flagpole", 0.025, poleHeight, 0.025, bark, node);
      pole.position.set(0.32, 0.06 + poleHeight / 2, -0.25);
      const flag = box("town center banner", 0.22, 0.16, 0.025, roof, node);
      flag.position.set(0.23, poleHeight - 0.01, -0.25);
      for (const mesh of node.getChildMeshes()) {
        mesh.isPickable = true;
        mesh.metadata = {
          tile: state.tiles.find(
            (tile) => tile.x === city.x && tile.y === city.y,
          ),
        };
      }
      cityModels.set(city.id, { node, signature });
      rememberedModel = false;
    }
    for (const unit of renderedUnits) {
      if (!warriors.has(unit.id)) createWarrior(unit, state.players.findIndex(player => player.id === unit.ownerId));
      const remembered = rememberedUnitIds.has(unit.id);
      for (const mesh of warriors.get(unit.id)!.getChildMeshes()) {
        if (mesh.name === `health-${unit.id}`) { mesh.setEnabled(!remembered); continue; }
        if (mesh.material instanceof StandardMaterial) {
          if (!unitMaterials.has(mesh)) unitMaterials.set(mesh, mesh.material);
          const original = unitMaterials.get(mesh)!;
          mesh.material = remembered ? shaded(original) : original;
        }
        mesh.isPickable = !remembered && !!mesh.metadata?.unitId;
      }
      warriors.get(unit.id)!.position.copyFrom(tilePoint(unit, true));
      scene.getMeshByName(`raft-${unit.id}`)?.setEnabled(!!unit.embarked);
      const texture = healthLabels.get(unit.id);
      const health = `${unit.hp}/${unit.maxHp}`;
      if (texture && healthValues.get(unit.id) !== health) {
        healthValues.set(unit.id, health);
        const context = texture.getContext();
        context.clearRect(0, 0, 256, 96);
        texture.drawText(
          health,
          null,
          68,
          "bold 60px sans-serif",
          "#ffffff",
          "#344f50",
          true,
        );
      }
      const ring = ownerRings.get(unit.id);
      if (ring)
        ring.visibility = unit.ownerId === state.activePlayerId ? 1 : 0.35;
    }
    markers.forEach((mesh) => mesh.dispose());
    markers = [];
    if (selected) {
      for (const target of getAttackTargets(state, selected)) {
        const marker = box("legal attack", 0.91, 0.024, 0.91, attackMaterial);
        marker.position.copyFrom(
          tilePoint(target, true).add(new Vector3(0, 0.02, 0)),
        );
        markers.push(marker);
        const ring = solid(
          CreateTorus(
            "attack ring",
            { diameter: 0.85, thickness: 0.06, tessellation: 32 },
            scene,
          ),
          attackMaterial,
          root,
          false,
        );
        ring.position.copyFrom(marker.position.add(new Vector3(0, 0.035, 0)));
        markers.push(ring);
      }
      for (const tile of getReachableTiles(state, selected)) {
        const marker = box("legal move", 0.85, 0.018, 0.85, moveMaterial);
        marker.position.copyFrom(tilePoint(tile, true).add(new Vector3(0, 0.015, 0)));
        markers.push(marker);
        const dot = solid(
          CreateCylinder(
            "move pip",
            { height: 0.012, diameter: 0.1, tessellation: 16 },
            scene,
          ),
          selectionMaterial,
          root,
          false,
        );
        dot.position.copyFrom(marker.position.add(new Vector3(0, 0.018, 0)));
        markers.push(dot);
      }
    }
  };
  const move = (unitId: string, path: Position[]) =>
    new Promise<void>((resolve) => {
      const warrior = warriors.get(unitId);
      if (!warrior) { resolve(); return; }
      animation = {
        unitId,
        path: [warrior.position.clone(), ...path.map(position => tilePoint(position, true))],
        started: performance.now(),
        done: resolve,
      };
    });
  const tween = (duration: number, frame: (t: number) => void) =>
    new Promise<void>((resolve) => {
      const started = performance.now();
      const observer = scene.onBeforeRenderObservable.add(() => {
        const t = Math.min(1, (performance.now() - started) / duration);
        frame(t);
        if (t === 1) {
          scene.onBeforeRenderObservable.remove(observer);
          resolve();
        }
      });
    });
  const combat = async (
    before: GameState,
    after: GameState,
    result: CombatPreview,
  ) => {
    combatAnimating = true;
    const attacker = warriors.get(result.attackerId)!;
    const defender = warriors.get(result.defenderId)!;
    const start = attacker.position.clone();
    const target = defender.position.clone();
    const direction = target.subtract(start).normalize();
    attacker.rotation.y = Math.atan2(direction.x, direction.z) + Math.PI;
    await tween(260, (t) => {
      attacker.position.copyFrom(
        start.add(direction.scale(Math.sin(t * Math.PI) * 0.42)),
      );
      defender.rotation.z = Math.sin(t * Math.PI) * 0.18;
    });
    if (result.retaliation) {
      await tween(230, (t) => {
        defender.position.copyFrom(
          target.subtract(direction.scale(Math.sin(t * Math.PI) * 0.32)),
        );
        attacker.rotation.z = -Math.sin(t * Math.PI) * 0.18;
      });
    }
    for (const unit of before.units.filter(
      (unit) => unit.id === result.attackerId && result.attackerHp === 0 || unit.id === result.defenderId && result.defenderHp === 0,
    )) {
      const model = warriors.get(unit.id)!;
      await tween(300, (t) => {
        model.scaling.setAll(1 - t);
        model.rotation.z = (t * Math.PI) / 2;
      });
      model.dispose();
      warriors.delete(unit.id);
      ownerRings.delete(unit.id);
      healthLabels.get(unit.id)?.dispose();
      healthLabels.delete(unit.id);
      healthValues.delete(unit.id);
    }
    if (result.advance) await move(result.attackerId, [result.advance]);
    for (const unit of after.units) {
      const model = warriors.get(unit.id);
      if (!model) continue;
      model.position.copyFrom(tilePoint(unit, true));
      model.rotation.z = 0;
    }
    combatAnimating = false;
  };
  const project = (position: Position, height = 0.04) => {
    scene.updateTransformMatrix(true);
    const point = Vector3.Project(
      tilePoint(position, true).add(new Vector3(0, height, 0)),
      Matrix.Identity(),
      scene.getTransformMatrix(),
      camera.viewport.toGlobal(
        engine.getRenderWidth(),
        engine.getRenderHeight(),
      ),
    );
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + (point.x * rect.width) / engine.getRenderWidth(),
      y: rect.top + (point.y * rect.height) / engine.getRenderHeight(),
    };
  };
  resize();
  engine.runRenderLoop(() => {
    const now = performance.now();
    const cameraKey = `${camera.alpha}:${camera.beta}:${zoom}:${canvas.width}:${canvas.height}`;
    if (cameraKey !== shadowCamera || animation || combatAnimating) shadowDirty = true;
    shadowCamera = cameraKey;
    if (shadowDirty) shadowMap.resetRefreshCounter();
    shadowDirty = animation !== null || combatAnimating;
    if (animation) {
      const warrior = warriors.get(animation.unitId)!;
      const elapsed = (now - animation.started) / 440;
      const segment = Math.min(Math.floor(elapsed), animation.path.length - 2);
      const t = Math.min(1, elapsed - segment);
      const eased = t * t * (3 - 2 * t);
      const from = animation.path[segment];
      const to = animation.path[segment + 1];
      warrior.position.copyFrom(Vector3.Lerp(from, to, eased));
      warrior.position.y += Math.sin(t * Math.PI) * 0.24;
      warrior.rotation.y = Math.atan2(to.x - from.x, to.z - from.z) + Math.PI;
      if (elapsed >= animation.path.length - 1) {
        warrior.position.copyFrom(animation.path.at(-1)!);
        const done = animation.done;
        animation = null;
        done();
      }
    }
    const selectedWarrior = selected ? warriors.get(selected) : undefined;
    halo.setEnabled(!!selectedWarrior);
    if (selectedWarrior)
      halo.position.copyFrom(
        selectedWarrior.position.add(new Vector3(0, 0.025, 0)),
      );
    halo.scaling.setAll(1 + Math.sin(now / 330) * 0.025);
    const renderStart = performance.now();
    if (import.meta.env.DEV) engine._drawCalls.fetchNewFrame();
    scene.render();
    if (import.meta.env.DEV) {
      profile.frames.push({ cpu: performance.now() - renderStart, interval: now - lastFrame, draws: engine._drawCalls.current, active: scene.getActiveMeshes().length });
      if (profile.frames.length > 2000) profile.frames.shift();
    }
    lastFrame = now;
  });
  return {
    selectCity,
    setPortPlacement,
    getPortMarkerCount: () => portMarkers.length,
    selectResource: (tile: Position | null) => { selectedResource = tile; resourceLayer.select(currentState, selectedCity, tile); },
    getResourceRenderStats: resourceLayer.stats,
    getTerritoryRenderStats: () => ({ builds: territoryBuilds, meshes: territoryMeshes.length, quads: territoryMeshes.reduce((sum, mesh) => sum + mesh.getTotalVertices() / 4, 0), selectedCityId: selectedCity }),
    getProfile: () => ({ ...profile, meshes: scene.meshes.length, materials: scene.materials.length, loops: engine.activeRenderLoops.length }),
    resetProfile: () => { profile.frames.length = 0; profile.picks.length = 0; },
    rebuild,
    update,
    move,
    combat,
    project,
    isAnimating: () => animation !== null || combatAnimating,
    getVisualPosition: (unitId: string) => {
      const warrior = warriors.get(unitId);
      if (!warrior) throw new Error("Unknown visual unit");
      return {
        x: warrior.position.x + (currentState.width - 1) / 2,
        y: warrior.position.z + (currentState.height - 1) / 2,
        elevation: warrior.position.y,
      };
    },
    getMarkerCount: () =>
      markers.filter((mesh) => mesh.name === "legal move").length,
    getHoveredTile: () => hoveredKey,
    resetCamera: () => {
      camera.inertialAlphaOffset = 0;
      camera.inertialBetaOffset = 0;
      camera.alpha = -Math.PI / 4;
      camera.beta = 0.83;
      zoom = defaultZoom;
      resize();
    },
    dispose: () => {
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("contextmenu", contextMenu);
      engine.stopRenderLoop();
      scene.dispose();
      engine.dispose();
    },
  };
}
