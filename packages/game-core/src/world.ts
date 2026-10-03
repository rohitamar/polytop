import type { Position, Terrain, Tile } from "./index";

export const mapSizes = [
  { maxPlayers: 2, size: 20 },
  { maxPlayers: 4, size: 24 },
  { maxPlayers: 6, size: 28 },
  { maxPlayers: 8, size: 30 },
] as const;
export const terrainRules = {
  elevationScale: 6,
  waterMin: 0.1333,
  waterMax: 0.1333,
  mountainCoverage: 0.1333,
  forestCoverage: 0.1333,
  safeRadius: 2,
  neutralCities: 4,
} as const;
export type WorldConfig = { width?: number; height?: number; scenario?: "demo"; terrain?: Partial<Record<keyof typeof terrainRules, number>> };
export function getMapSize(playerCount: number) {
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 8) throw new Error("Expected 2-8 players");
  const size = mapSizes.find(entry => playerCount <= entry.maxPlayers)!.size;
  return { width: size, height: size };
}
const distance = (a: Position, b: Position) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
function randomFromSeed(seed: string) {
  let value = 2166136261;
  for (const char of seed)
    value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return () => {
    value += 0x6d2b79f5;
    let n = Math.imul(value ^ (value >>> 15), 1 | value);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function noise(seed: string, width: number, height: number, scale: number) {
  const random = randomFromSeed(seed);
  const columns = Math.ceil((width + 1) / scale) + 1;
  const rows = Math.ceil((height + 1) / scale) + 1;
  const gradients = Array.from({ length: columns * rows }, () => {
    const angle = random() * Math.PI * 2;
    return [Math.cos(angle), Math.sin(angle)];
  });
  const fade = (v: number) => v * v * v * (v * (v * 6 - 15) + 10);
  return (x: number, y: number) => {
    const px = (x + 0.37) / scale, py = (y + 0.71) / scale;
    const cx = Math.floor(px), cy = Math.floor(py), dx = px - cx, dy = py - cy;
    const dot = (gx: number, gy: number) => {
      const gradient = gradients[gy * columns + gx];
      return gradient[0] * (px - gx) + gradient[1] * (py - gy);
    };
    const fx = fade(dx), fy = fade(dy);
    const top = dot(cx, cy) * (1 - fx) + dot(cx + 1, cy) * fx;
    const bottom = dot(cx, cy + 1) * (1 - fx) + dot(cx + 1, cy + 1) * fx;
    return 0.5 + (top * (1 - fy) + bottom * fy) * 0.5;
  };
}
function growForests(seed: string, tiles: Tile[], width: number, height: number, target: number, excluded: Set<number>) {
  const random = randomFromSeed(seed);
  const eligible = tiles.filter(tile => tile.terrain === "grass" && !excluded.has(tile.y * width + tile.x));
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
  }
  let count = tiles.filter(tile => tile.terrain === "forest").length;
  for (const seedTile of eligible) {
    if (count >= target) break;
    if (seedTile.terrain !== "grass") continue;
    const frontier = [seedTile];
    let remaining = 3 + Math.floor(random() * 5);
    while (frontier.length && remaining > 0 && count < target) {
      const [tile] = frontier.splice(Math.floor(random() * frontier.length), 1);
      const index = tile.y * width + tile.x;
      if (tile.terrain !== "grass" || excluded.has(index)) continue;
      tile.terrain = "forest";
      count++;
      remaining--;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const x = tile.x + dx, y = tile.y + dy;
        if (x >= 0 && y >= 0 && x < width && y < height) frontier.push(tiles[y * width + x]);
      }
    }
  }
}
export function generateWorld(seed: string, playerCount: number, config: WorldConfig) {
  const defaults = getMapSize(playerCount);
  const width = config.width ?? defaults.width, height = config.height ?? defaults.height;
  if (![width, height].every(value => Number.isInteger(value) && value >= 10 && value <= 128)) throw new Error("Map dimensions must be integers from 10 to 128");
  const rules = { ...terrainRules, ...config.terrain };
  if (!Number.isFinite(rules.elevationScale) || rules.elevationScale < 1 ||
      ![rules.waterMin, rules.waterMax, rules.mountainCoverage, rules.forestCoverage].every(value => Number.isFinite(value) && value >= 0 && value <= 1) || rules.waterMin > rules.waterMax ||
      !Number.isInteger(rules.safeRadius) || rules.safeRadius < 2 || rules.safeRadius > 4 ||
      !Number.isInteger(rules.neutralCities) || rules.neutralCities < 0 || rules.neutralCities > 16) throw new Error("Invalid terrain configuration");
  if (config.scenario === "demo" && (playerCount !== 2 || width !== 20 || height !== 20)) throw new Error("Demo scenario requires two players on a 20x20 map");
  const elevation = noise(seed + ":elevation", width, height, rules.elevationScale);
  const detail = noise(seed + ":elevation-detail", width, height, Math.max(1, rules.elevationScale / 2));
  const tiles: Tile[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) tiles.push({ x, y, terrain: "grass" });
  const levels = tiles.map(tile => elevation(tile.x, tile.y) * 0.8 + detail(tile.x, tile.y) * 0.2);
  const ranked = tiles.map((_, index) => index).sort((a, b) => levels[a] - levels[b] || a - b);
  const coverage = rules.waterMin + randomFromSeed(seed + ":water-coverage")() * (rules.waterMax - rules.waterMin);
  const waterTarget = rules.waterMin === rules.waterMax ? Math.round(tiles.length * coverage) : Math.max(Math.ceil(tiles.length * rules.waterMin), Math.min(Math.floor(tiles.length * rules.waterMax), Math.round(tiles.length * coverage)));
  for (const index of ranked.slice(0, waterTarget)) tiles[index].terrain = "water";
  const mountains = randomFromSeed(seed + ":mountains");
  for (const tile of tiles) {
    const roll = mountains();
    if (tile.terrain === "grass" && roll < rules.mountainCoverage) tile.terrain = "mountain";
  }
  growForests(seed + ":forests", tiles, width, height, Math.round(tiles.length * rules.forestCoverage), new Set());
  const interior = tiles.filter(tile => tile.x >= rules.safeRadius + 1 && tile.y >= rules.safeRadius + 1 && tile.x < width - rules.safeRadius - 1 && tile.y < height - rules.safeRadius - 1);
  const land = new Set<number>();
  const seen = new Set<number>();
  for (let index = 0; index < tiles.length; index++) {
    if (seen.has(index) || !["grass", "forest"].includes(tiles[index].terrain)) continue;
    const region = [index];
    seen.add(index);
    for (let i = 0; i < region.length; i++) {
      const tile = tiles[region[i]];
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const x = tile.x + dx, y = tile.y + dy, next = y * width + x;
        if (x < 0 || y < 0 || x >= width || y >= height || seen.has(next) || !["grass", "forest"].includes(tiles[next].terrain)) continue;
        seen.add(next);
        region.push(next);
      }
    }
    if (region.length > land.size) { land.clear(); region.forEach(index => land.add(index)); }
  }
  const suitable = interior.filter(tile => tile.terrain === "grass" && land.has(tile.y * width + tile.x) && tiles.filter(other => distance(tile, other) <= rules.safeRadius && ["grass", "forest"].includes(other.terrain)).length >= 11);
  const candidates = suitable.length >= playerCount + rules.neutralCities ? suitable : interior;
  if (candidates.length < playerCount + rules.neutralCities) throw new Error("Map cannot fit cities with the configured safe radius");
  const random = randomFromSeed(seed + ":starts");
  const first = candidates[Math.floor(random() * candidates.length)];
  const starts: Position[] = [{ x: first.x, y: first.y }];
  while (starts.length < playerCount) {
    let best = candidates[0], score = -1;
    for (const tile of candidates) {
      const separation = Math.min(...starts.map(start => distance(start, tile)));
      if (separation > score) { best = tile; score = separation; }
    }
    if (score < 6) for (const tile of interior) {
      const separation = Math.min(...starts.map(start => distance(start, tile)));
      if (separation > score) { best = tile; score = separation; }
    }
    if (score < 1) throw new Error("Map cannot fit starting cities");
    starts.push({ x: best.x, y: best.y });
  }
  if (config.scenario === "demo") starts.splice(0, starts.length, { x: 4, y: 5 }, { x: 7, y: 3 });
  const villages: Position[] = [];
  for (let i = 0; i < rules.neutralCities; i++) {
    let best = candidates[0], score = -1;
    for (const tile of candidates) {
      const separation = Math.min(...[...starts, ...villages].map(city => distance(city, tile)));
      if (separation > score) { best = tile; score = separation; }
    }
    if (score < 1) throw new Error("Map cannot fit neutral cities");
    villages.push({ x: best.x, y: best.y });
  }
  if (config.scenario === "demo") villages.splice(0, villages.length, { x: 5, y: 5 }, { x: 10, y: 7 }, { x: 12, y: 12 }, { x: 7, y: 11 });
  for (const tile of tiles) {
    if (config.scenario === "demo") {
      if (starts.some(start => distance(start, tile) <= rules.safeRadius) || villages.some(city => distance(city, tile) <= 1)) tile.terrain = "grass";
    } else {
      const nearStart = starts.some(start => distance(start, tile) <= rules.safeRadius);
      const center = [...starts, ...villages].some(city => distance(city, tile) === 0);
      const immediateStart = starts.some(start => distance(start, tile) <= 1);
      if (center || nearStart && tile.terrain === "water" || immediateStart && tile.terrain === "mountain") tile.terrain = "grass";
    }
  }
  const routes = new Set<number>();
  const connect = (from: Position, to: Position) => {
    const costs = new Float64Array(tiles.length).fill(Infinity);
    const previous = new Int32Array(tiles.length).fill(-1);
    const start = from.y * width + from.x, target = to.y * width + to.x;
    const pending = new Set([start]);
    costs[start] = 0;
    while (pending.size) {
      let current = -1;
      for (const index of pending) if (current < 0 || costs[index] < costs[current]) current = index;
      pending.delete(current);
      if (current === target) break;
      const tile = tiles[current];
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const x = tile.x + dx, y = tile.y + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const index = y * width + x;
        const terrain = tiles[index].terrain;
        const cost = costs[current] + (terrain === "water" ? 24 : terrain === "mountain" ? 12 : 1) + levels[index] * 0.3;
        if (cost >= costs[index]) continue;
        costs[index] = cost;
        previous[index] = current;
        pending.add(index);
      }
    }
    routes.add(start);
    for (let index = target; index !== start && index >= 0; index = previous[index]) {
      routes.add(index);
      if (tiles[index].terrain === "water" || tiles[index].terrain === "mountain") tiles[index].terrain = "grass";
    }
  };
  const connected = [starts[0]];
  for (const city of [...starts.slice(1), ...villages]) {
    const nearest = [...connected].sort((a, b) => distance(a, city) - distance(b, city))[0];
    connect(city, nearest);
    connected.push(city);
  }
  if (config.scenario === "demo") {
    tiles[4 * width + 4].terrain = "forest";
    tiles[4 * width + 7].terrain = "grass";
    tiles[5 * width + 7].terrain = "grass";
  }
  const reserved = new Set(routes);
  for (const tile of tiles) if (starts.some(start => distance(start, tile) <= rules.safeRadius) || villages.some(city => distance(city, tile) === 0)) reserved.add(tile.y * width + tile.x);
  if (config.scenario === "demo") for (const [x, y] of [[4, 3], [4, 4], [7, 4], [7, 5]]) reserved.add(y * width + x);
  let waters = tiles.filter(tile => tile.terrain === "water").length;
  for (const index of ranked) {
    if (waters >= waterTarget) break;
    if (!reserved.has(index) && tiles[index].terrain !== "water") { tiles[index].terrain = "water"; waters++; }
  }
  const centers = new Set([...starts, ...villages].map(city => city.y * width + city.x));
  if (config.scenario === "demo") for (const [x, y] of [[4, 3], [7, 4], [7, 5]]) centers.add(y * width + x);
  const mountainTarget = Math.round(tiles.length * rules.mountainCoverage);
  const existingMountains = tiles.filter(tile => tile.terrain === "mountain");
  for (const tile of existingMountains.slice(mountainTarget)) tile.terrain = "grass";
  let mountainCount = Math.min(existingMountains.length, mountainTarget);
  const mountainRandom = randomFromSeed(seed + ":mountain-balance");
  const mountainCandidates = tiles.filter(tile => tile.terrain === "grass" && !routes.has(tile.y * width + tile.x) && !centers.has(tile.y * width + tile.x) && !starts.some(start => distance(start, tile) <= (config.scenario === "demo" ? rules.safeRadius : 1)) && !(config.scenario === "demo" && (reserved.has(tile.y * width + tile.x) || villages.some(city => distance(city, tile) <= 1)))).map(tile => ({ tile, priority: mountainRandom() })).sort((a, b) => a.priority - b.priority || a.tile.y - b.tile.y || a.tile.x - b.tile.x);
  for (const { tile } of mountainCandidates) {
    if (mountainCount >= mountainTarget) break;
    tile.terrain = "mountain";
    mountainCount++;
  }
  if (mountainCount < mountainTarget) throw new Error("Map cannot fit configured mountain coverage while preserving city routes");
  const forestTarget = Math.round(tiles.length * rules.forestCoverage);
  const existingForest = tiles.filter(tile => tile.terrain === "forest");
  for (const tile of existingForest.slice(forestTarget)) tile.terrain = "grass";
  growForests(seed + ":forest-balance", tiles, width, height, forestTarget, centers);
  return { width, height, starts, villages, tiles };
}

export const resourceRules = { grassChance: 0.40, fruitShare: 0.50, fishChance: 0.60, minimumCityOpportunities: 3 } as const;
export function placeResources(seed: string, tiles: Tile[], width: number, height: number) {
  const random = randomFromSeed(seed + ":resources");
  for (const tile of tiles) {
    delete tile.resource;
    const roll = random(), kind = random();
    const near = [[0, -1], [1, 0], [0, 1], [-1, 0]].flatMap(([dx, dy]) => {
      const x = tile.x + dx, y = tile.y + dy;
      return x < 0 || y < 0 || x >= width || y >= height ? [] : [tiles[y * width + x]];
    });
    if (tile.terrain === "forest") tile.resource = "forest";
    else if (tile.terrain === "mountain") tile.resource = "mine";
    else if (tile.terrain === "water" && near.some(other => other.terrain !== "water") && roll < resourceRules.fishChance) tile.resource = "fishery";
    else if (tile.terrain === "grass" && roll < resourceRules.grassChance) {
      tile.resource = kind < resourceRules.fruitShare ? "orchard" : "wheat";
    }
  }
}
