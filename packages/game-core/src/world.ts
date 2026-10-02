import type { Position, Terrain, Tile } from "./index";

export const mapSizes = [
  { maxPlayers: 2, size: 20 },
  { maxPlayers: 4, size: 24 },
  { maxPlayers: 6, size: 28 },
  { maxPlayers: 8, size: 30 },
] as const;
export const terrainRules = {
  waterScale: 6,
  mountainScale: 4,
  forestScale: 3,
  waterThreshold: 0.35,
  mountainThreshold: 0.70,
  forestThreshold: 0.54,
  coastalBias: 0.18,
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
  const columns = Math.ceil(width / scale) + 1;
  const rows = Math.ceil(height / scale) + 1;
  const values = Array.from({ length: columns * rows }, () => random());
  const smooth = (v: number) => v * v * (3 - 2 * v);
  return (x: number, y: number) => {
    const cx = Math.floor(x / scale), cy = Math.floor(y / scale);
    const fx = smooth(x / scale - cx), fy = smooth(y / scale - cy);
    const top = values[cy * columns + cx] * (1 - fx) + values[cy * columns + cx + 1] * fx;
    const bottom = values[(cy + 1) * columns + cx] * (1 - fx) + values[(cy + 1) * columns + cx + 1] * fx;
    return top * (1 - fy) + bottom * fy;
  };
}
export function generateWorld(seed: string, playerCount: number, config: WorldConfig) {
  const defaults = getMapSize(playerCount);
  const width = config.width ?? defaults.width, height = config.height ?? defaults.height;
  if (![width, height].every(value => Number.isInteger(value) && value >= 10 && value <= 128)) throw new Error("Map dimensions must be integers from 10 to 128");
  const rules = { ...terrainRules, ...config.terrain };
  if (![rules.waterScale, rules.mountainScale, rules.forestScale].every(value => Number.isFinite(value) && value >= 1) ||
      ![rules.waterThreshold, rules.mountainThreshold, rules.forestThreshold, rules.coastalBias].every(value => Number.isFinite(value) && value >= 0 && value <= 1) ||
      !Number.isInteger(rules.safeRadius) || rules.safeRadius < 2 || rules.safeRadius > 4 ||
      !Number.isInteger(rules.neutralCities) || rules.neutralCities < 0 || rules.neutralCities > 16) throw new Error("Invalid terrain configuration");
  if (config.scenario === "demo" && (playerCount !== 2 || width !== 20 || height !== 20)) throw new Error("Demo scenario requires two players on a 20x20 map");
  const water = noise(seed + ":water", width, height, rules.waterScale);
  const mountain = noise(seed + ":mountain", width, height, rules.mountainScale);
  const forest = noise(seed + ":forest", width, height, rules.forestScale);
  const tiles: Tile[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const coast = Math.min(x, y, width - 1 - x, height - 1 - y) < 1 ? rules.coastalBias : 0;
    const terrain: Terrain = water(x, y) - coast < rules.waterThreshold ? "water" : mountain(x, y) > rules.mountainThreshold ? "mountain" : forest(x, y) > rules.forestThreshold ? "forest" : "grass";
    tiles.push({ x, y, terrain });
  }
  const candidates = tiles.filter(tile => tile.x >= rules.safeRadius + 1 && tile.y >= rules.safeRadius + 1 && tile.x < width - rules.safeRadius - 1 && tile.y < height - rules.safeRadius - 1);
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
    if (starts.some(start => distance(start, tile) <= rules.safeRadius) || villages.some(city => distance(city, tile) <= 1)) tile.terrain = "grass";
  }
  const connect = (from: Position, to: Position) => {
    let x = from.x, y = from.y;
    while (x !== to.x || y !== to.y) {
      if (x !== to.x) x += Math.sign(to.x - x); else y += Math.sign(to.y - y);
      if (tiles[y * width + x].terrain === "water" || tiles[y * width + x].terrain === "mountain") tiles[y * width + x].terrain = "grass";
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
  return { width, height, starts, villages, tiles };
}

export const resourceRules = { scale: 3, orchardThreshold: 0.32, wheatThreshold: 0.62, fishThreshold: 0.38, metalThreshold: 0.44, minimumCityOpportunities: 3 } as const;
export function placeResources(seed: string, tiles: Tile[], width: number, height: number) {
  const fields = noise(seed + ":fields", width, height, resourceRules.scale);
  const deposits = noise(seed + ":deposits", width, height, resourceRules.scale);
  const neighbors = (tile: Tile) => [[0, -1], [1, 0], [0, 1], [-1, 0]].flatMap(([dx, dy]) => {
    const x = tile.x + dx, y = tile.y + dy;
    return x < 0 || y < 0 || x >= width || y >= height ? [] : [tiles[y * width + x]];
  });
  for (const tile of tiles) {
    const nearby = neighbors(tile);
    const value = fields(tile.x, tile.y);
    if (tile.terrain === "forest") tile.resource = "forest";
    else if (tile.terrain === "water" && nearby.some(other => other.terrain !== "water") && value > resourceRules.fishThreshold) tile.resource = "fishery";
    else if (tile.terrain === "grass") {
      if (nearby.some(other => other.terrain === "mountain") && deposits(tile.x, tile.y) > resourceRules.metalThreshold) tile.resource = "mine";
      else if (value < resourceRules.orchardThreshold) tile.resource = "orchard";
      else if (value > resourceRules.wheatThreshold) tile.resource = "wheat";
    }
  }
}
