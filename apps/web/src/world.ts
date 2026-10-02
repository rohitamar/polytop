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
  getReachableTiles,
  getAttackTargets,
  type CombatPreview,
  positionKey,
  type GameState,
  type Position,
  type Tile,
  type Unit,
} from "@reach/game-core";
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
  const tilePoint = (p: Position) =>
    new Vector3(
      p.x - (currentState.width - 1) / 2,
      tileHeight(currentState?.tiles.find((t) => t.x === p.x && t.y === p.y)),
      p.y - (currentState.height - 1) / 2,
    );
  const solid = (
    mesh: Mesh,
    mat: StandardMaterial,
    parent: TransformNode = root,
    cast = true,
  ) => {
    mesh.material = mat;
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
  ) => mat.alpha < 1
    ? solid(CreateBox(name, { width, height, depth }, scene), mat, parent)
    : repeated(`box:${width}:${height}:${depth}:${mat.name}`, () => solid(CreateBox(name, { width, height, depth }, scene), mat, parent));
  const cone = (
    name: string,
    height: number,
    bottom: number,
    mat: StandardMaterial,
    parent?: TransformNode,
    top = 0,
  ) => {
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
    warrior.position.copyFrom(tilePoint(unit));
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
  scene.onPointerObservable.add((info) => {
    if (
      info.type !== PointerEventTypes.POINTERMOVE &&
      info.type !== PointerEventTypes.POINTERTAP
    )
      return;
    const pick = info.pickInfo;
    const metadata = pick?.pickedMesh?.metadata;
    const pickedUnit = currentState?.units.find(
      (unit) => unit.id === metadata?.unitId,
    );
    const tile = pickedUnit
      ? currentState?.tiles.find(
          (t) => t.x === pickedUnit.x && t.y === pickedUnit.y,
        )
      : (metadata?.tile as Tile | undefined);
    if (info.type === PointerEventTypes.POINTERMOVE) {
      const key = tile ? positionKey(tile) : "";
      if (key !== hoveredKey) {
        hoveredKey = key;
        onHover(tile ?? null);
      }
      hover.setEnabled(!!tile);
      if (tile)
        hover.position.copyFrom(tilePoint(tile).add(new Vector3(0, 0.027, 0)));
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
  });
  const rebuild = (state: GameState) => {
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
    defaultZoom = Math.max(state.width, state.height) * 0.81;
    zoom = defaultZoom;
    camera.radius = Math.max(state.width, state.height) * 2.2;
    resize();
    buildingTerrain = true;
    for (const tile of state.tiles) {
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
        const cap = cone("snowcap", 0.33, 0.28, snow);
        cap.position.set(point.x, point.y + 0.93, point.z);
        cap.rotation.y = tile.x;
      }
      if (tile.terrain === "water") {
        for (let i = 0; i < 2; i++) {
          const ripple = box("ripple", 0.18 + i * 0.12, 0.007, 0.018, foam);
          ripple.position.set(
            point.x - 0.1 + i * 0.23,
            point.y + 0.01,
            point.z - 0.19 + i * 0.35,
          );
        }
      }
    }
    buildingTerrain = false;
    for (const mesh of decorations) mesh.freezeWorldMatrix();
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
    hover.setEnabled(false);
    hoveredKey = "";
  };
  const update = (state: GameState, selectedUnitId: string | null) => {
    shadowDirty = true;
    if (import.meta.env.DEV) profile.updates++;
    currentState = state;
    selected = selectedUnitId;
    for (const city of state.cities) {
      const signature = `${city.ownerId}:${city.level}`;
      if (cityModels.get(city.id)?.signature === signature) continue;
      cityModels.get(city.id)?.node.dispose();
      const node = new TransformNode(city.id, scene);
      node.position.copyFrom(tilePoint(city));
      const index = state.players.findIndex(
        (player) => player.id === city.ownerId,
      );
      const roof = index < 0 ? neutral : accents[index];
      const plaza = box("city plaza", 0.88, 0.06, 0.88, snow, node);
      plaza.position.y = 0.03;
      for (let i = 0; i < city.level; i++) {
        const x = -0.27 + i * 0.25;
        const height = 0.28 + i * 0.13;
        const house = box("city house", 0.21, height, 0.25, armor, node);
        house.position.set(x, height / 2 + 0.06, 0.24);
        const cap = cone("city roof", 0.17, 0.34, roof, node);
        cap.position.set(x, height + 0.14, 0.24);
      }
      const pole = box("city flagpole", 0.025, 0.75, 0.025, bark, node);
      pole.position.set(0.32, 0.4, -0.25);
      const flag = box("city banner", 0.22, 0.16, 0.025, roof, node);
      flag.position.set(0.23, 0.69, -0.25);
      for (const mesh of node.getChildMeshes()) {
        mesh.isPickable = true;
        mesh.metadata = {
          tile: state.tiles.find(
            (tile) => tile.x === city.x && tile.y === city.y,
          ),
        };
      }
      cityModels.set(city.id, { node, signature });
    }
    for (const unit of state.units) {
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
          tilePoint(target).add(new Vector3(0, 0.02, 0)),
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
        marker.position.copyFrom(tilePoint(tile).add(new Vector3(0, 0.015, 0)));
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
      const warrior = warriors.get(unitId)!;
      animation = {
        unitId,
        path: [warrior.position.clone(), ...path.map(tilePoint)],
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
      (unit) => !after.units.some((next) => next.id === unit.id),
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
      const model = warriors.get(unit.id)!;
      model.position.copyFrom(tilePoint(unit));
      model.rotation.z = 0;
    }
    combatAnimating = false;
  };
  const project = (position: Position, height = 0.04) => {
    scene.updateTransformMatrix(true);
    const point = Vector3.Project(
      tilePoint(position).add(new Vector3(0, height, 0)),
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
