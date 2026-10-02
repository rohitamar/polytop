import { generateWorld, placeResources, resourceRules, type WorldConfig } from "./world";
export { getMapSize, mapSizes, terrainRules, resourceRules, type WorldConfig } from "./world";
export type Terrain = "grass" | "forest" | "mountain" | "water";
export type Position = { x: number; y: number };
export type Resource = "gold" | "food" | "wood" | "steel";
export type Resources = Record<Resource, number>;
export type Opportunity = "orchard" | "wheat" | "fishery" | "forest" | "mine";
export type Tile = Position & { terrain: Terrain; resource?: Opportunity };
export type Player = { id: string; name: string; resources: Resources };
export type City = Position & {
  id: string;
  ownerId: string | null;
  townHallLevel: number;
  population: number;
  workedTiles: string[];
};
export const economy = {
  goldIncome: [2, 3, 5],
  populationCaps: [5, 8, 12],
  upgradeCosts: [4, 8],
  maxLevel: 3,
  growthCost: 4,
  startingPopulation: 3,
  yields: {
    orchard: { resource: "food", amount: 2 },
    wheat: { resource: "food", amount: 3 },
    fishery: { resource: "food", amount: 2 },
    forest: { resource: "wood", amount: 2 },
    mine: { resource: "steel", amount: 2 },
  },
} as const;
export const emptyResources = (): Resources => ({ gold: 0, food: 0, wood: 0, steel: 0 });
export const getIncome = (state: GameState, playerId: string) =>
  state.cities.reduce((total, city) => total + (city.ownerId === playerId ? economy.goldIncome[city.townHallLevel - 1] : 0), 0);
export const getUpgradeCost = (city: City) =>
  city.townHallLevel >= economy.maxLevel ? null : economy.upgradeCosts[city.townHallLevel - 1];
export function getCityPopulation(state: GameState, city: City) {
  const military = state.units.filter(unit => unit.homeCityId === city.id).reduce((total, unit) => total + unit.populationCost, 0);
  const civilian = city.population - military;
  return { total: city.population, military, civilian, available: civilian - city.workedTiles.length, cap: economy.populationCaps[city.townHallLevel - 1] };
}
export function getWorkableTiles(state: GameState, cityId: string): Tile[] {
  const city = state.cities.find(city => city.id === cityId);
  if (!city?.ownerId) return [];
  const claims = new Map(getTerritory(state).map(tile => [positionKey(tile), tile.cityId]));
  const centers = new Set(state.cities.map(positionKey));
  return state.tiles.filter(tile => tile.resource && !centers.has(positionKey(tile)) && claims.get(positionKey(tile)) === cityId);
}
export function getCityProduction(state: GameState, cityId: string): Resources {
  const city = state.cities.find(city => city.id === cityId);
  const result = emptyResources();
  if (!city?.ownerId) return result;
  result.gold = economy.goldIncome[city.townHallLevel - 1];
  const worked = new Set(city.workedTiles);
  for (const tile of getWorkableTiles(state, city.id)) {
    if (!worked.has(positionKey(tile))) continue;
    const yieldRule = economy.yields[tile.resource!];
    result[yieldRule.resource] += yieldRule.amount;
  }
  return result;
}
export function getProduction(state: GameState, playerId: string): Resources {
  const result = emptyResources();
  for (const city of state.cities.filter(city => city.ownerId === playerId)) {
    const income = getCityProduction(state, city.id);
    for (const resource of ["gold", "food", "wood", "steel"] as const) result[resource] += income[resource];
  }
  return result;
}
export type Unit = Position & {
  id: string;
  ownerId: string;
  homeCityId: string | null;
  populationCost: number;
  movement: number;
  maxMovement: number;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  range: number;
  hasAttacked: boolean;
};
export type GameState = {
  seed: string;
  width: number;
  height: number;
  revision: number;
  activePlayerId: string;
  players: Player[];
  turnNumber: number;
  tiles: Tile[];
  units: Unit[];
  cities: City[];
};
export const territoryRules = { radius: 2 } as const;
export type TileTerritory = Position & { cityId: string | null; playerId: string | null };
function claimTile(state: GameState, tile: Position, radius: number): TileTerritory {
  let closest: City | undefined;
  let best = radius + 1;
  for (const city of state.cities) {
    const distance = Math.abs(city.x - tile.x) + Math.abs(city.y - tile.y);
    if (distance <= radius && (distance < best || distance === best && city.id < closest!.id)) {
      closest = city;
      best = distance;
    }
  }
  return { x: tile.x, y: tile.y, cityId: closest?.id ?? null, playerId: closest?.ownerId ?? null };
}
export function getTerritory(state: GameState, radius: number = territoryRules.radius): TileTerritory[] {
  if (!Number.isInteger(radius) || radius < 0) throw new Error("Invalid territory radius");
  return state.tiles.map(tile => claimTile(state, tile, radius));
}
export const getTileTerritory = (state: GameState, x: number, y: number) => {
  const tile = getTile(state, x, y);
  return tile ? claimTile(state, tile, territoryRules.radius) : undefined;
};

export type GameAction =
  | {
      type: "move";
      playerId: string;
      unitId: string;
      to: Position;
    }
  | { type: "ATTACK_UNIT"; playerId: string; unitId: string; targetId: string }
  | { type: "UPGRADE_TOWN_HALL" | "GROW_POPULATION"; playerId: string; cityId: string }
  | { type: "ASSIGN_WORKER" | "UNASSIGN_WORKER"; playerId: string; cityId: string; tile: Position }
  | { type: "END_TURN"; playerId: string };
export type ReachableTile = Position & { cost: number; path: Position[] };

export const warriorStats = { homeCityId: null as string | null, populationCost: 1, maxHp: 10, attack: 2, defense: 2, range: 1 };

export const movementCost: Record<Terrain, number> = {
  grass: 1,
  forest: 2,
  mountain: Infinity,
  water: Infinity,
};
export const positionKey = ({ x, y }: Position) => `${x},${y}`;
export const getTile = (state: GameState, x: number, y: number) => {
  const indexed = state.tiles[y * state.width + x];
  return indexed?.x === x && indexed.y === y ? indexed : state.tiles.find(tile => tile.x === x && tile.y === y);
};

export function createGame(seed = "fern-104", playerCount = 2, config: WorldConfig = {}): GameState {
  const world = generateWorld(seed, playerCount, config);
  const { starts, villages, tiles } = world;
  const cities: City[] = [
    ...starts.map((position, i) => ({
      ...position,
      id: `city-${i + 1}`,
      ownerId: `player-${i + 1}`,
      townHallLevel: 1,
      population: economy.startingPopulation,
      workedTiles: [],
    })),
    ...villages.map((position, i) => ({
      ...position,
      id: `neutral-${i + 1}`,
      ownerId: null,
      townHallLevel: 1,
      population: economy.startingPopulation,
      workedTiles: [],
    })),
  ];
  placeResources(seed, tiles, world.width, world.height);
  for (const tile of tiles) if (cities.some(city => city.x === tile.x && city.y === tile.y)) delete tile.resource;
  const state: GameState = {
    seed,
    width: world.width,
    height: world.height,
    revision: 0,
    activePlayerId: "player-1",
    players: starts.map((_, i) => ({
      id: `player-${i + 1}`,
      name: [
        "Sunward",
        "Tideward",
        "Mossward",
        "Dawnward",
        "Emberward",
        "Violetward",
        "Roseward",
        "Stoneward",
      ][i],
      resources: { ...emptyResources(), gold: i === 0 ? economy.goldIncome[0] : 0 },
    })),
    cities,
    turnNumber: 1,
    tiles,
    units: starts.map((position, i) => ({
      ...position,
      id: `warrior-${i + 1}`,
      ownerId: `player-${i + 1}`,
      movement: i === 0 ? 2 : 0,
      maxMovement: 2,
      ...warriorStats,
      homeCityId: `city-${i + 1}`,
      hp: warriorStats.maxHp,
      hasAttacked: false,
    })),
  };
  const claims = new Map(getTerritory(state).map(tile => [positionKey(tile), tile.cityId]));
  for (const city of cities) {
    const nearby = tiles.filter(tile => tile.terrain === "grass" && claims.get(positionKey(tile)) === city.id && !cities.some(center => positionKey(center) === positionKey(tile)));
    const opportunities = tiles.filter(tile => tile.resource && claims.get(positionKey(tile)) === city.id);
    const food = opportunities.find(tile => tile.resource === "wheat" || tile.resource === "orchard");
    if (!food && nearby.length) {
      nearby[0].resource = "wheat";
      if (!opportunities.includes(nearby[0])) opportunities.push(nearby[0]);
    }
    for (const tile of nearby) {
      if (opportunities.length >= resourceRules.minimumCityOpportunities) break;
      if (!tile.resource) { tile.resource = food?.resource ?? "wheat"; opportunities.push(tile); }
    }
  }
  if (config.scenario === "demo") getTile(state, 4, 3)!.resource = "wheat";
  return state;
}

export function getReachableTiles(
  state: GameState,
  unitId: string,
): ReachableTile[] {
  const unit = state.units.find((candidate) => candidate.id === unitId);
  if (!unit || unit.hasAttacked || unit.ownerId !== state.activePlayerId)
    return [];
  const start: ReachableTile = { x: unit.x, y: unit.y, cost: 0, path: [] };
  const visited = new Map<string, ReachableTile>([[positionKey(start), start]]);
  const queue = [start];
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift()!;
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ]) {
      const next = { x: current.x + dx, y: current.y + dy };
      if (
        next.x < 0 ||
        next.y < 0 ||
        next.x >= state.width ||
        next.y >= state.height
      )
        continue;
      const tile = getTile(state, next.x, next.y);
      if (
        !tile ||
        state.units.some(
          (other) =>
            other.id !== unitId && other.x === next.x && other.y === next.y,
        )
      )
        continue;
      const cost = current.cost + movementCost[tile.terrain];
      if (
        cost > unit.movement ||
        (visited.get(positionKey(next))?.cost ?? Infinity) <= cost
      )
        continue;
      const step = { ...next, cost, path: [...current.path, next] };
      visited.set(positionKey(next), step);
      queue.push(step);
    }
  }
  return [...visited.values()].filter((tile) => tile.cost > 0);
}

export type CombatPreview = {
  attackerId: string;
  defenderId: string;
  damage: number;
  retaliation: number;
  attackerHp: number;
  defenderHp: number;
  advance: Position | null;
};

const distance = (a: Position, b: Position) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export function getAttackTargets(state: GameState, unitId: string): Unit[] {
  const unit = state.units.find((candidate) => candidate.id === unitId);
  if (!unit || unit.ownerId !== state.activePlayerId || unit.hasAttacked)
    return [];
  return state.units.filter(
    (target) =>
      target.ownerId !== unit.ownerId && distance(unit, target) <= unit.range,
  );
}

export function previewCombat(
  state: GameState,
  unitId: string,
  targetId: string,
): CombatPreview {
  const attacker = state.units.find((unit) => unit.id === unitId);
  const defender = getAttackTargets(state, unitId).find(
    (unit) => unit.id === targetId,
  );
  if (!attacker || !defender) throw new Error("Illegal attack target");
  const damageFor = (source: Unit, target: Unit, hp: number) =>
    Math.max(
      1,
      Math.round(
        (5 * source.attack * (hp / source.maxHp)) / Math.max(1, target.defense),
      ),
    );
  const damage = Math.min(
    defender.hp,
    damageFor(attacker, defender, attacker.hp),
  );
  const defenderHp = defender.hp - damage;
  const retaliation =
    defenderHp > 0 && distance(attacker, defender) <= defender.range
      ? Math.min(attacker.hp, damageFor(defender, attacker, defenderHp))
      : 0;
  const tile = getTile(state, defender.x, defender.y);
  return {
    attackerId: unitId,
    defenderId: targetId,
    damage,
    retaliation,
    attackerHp: attacker.hp - retaliation,
    defenderHp,
    advance:
      defenderHp === 0 &&
      distance(attacker, defender) === 1 &&
      tile &&
      Number.isFinite(movementCost[tile.terrain])
        ? { x: defender.x, y: defender.y }
        : null,
  };
}

export function applyAction(state: GameState, action: GameAction): GameState {
  if (
    action.type !== "move" &&
    action.type !== "ATTACK_UNIT" &&
    action.type !== "END_TURN" &&
    action.type !== "UPGRADE_TOWN_HALL" &&
    action.type !== "GROW_POPULATION" &&
    action.type !== "ASSIGN_WORKER" &&
    action.type !== "UNASSIGN_WORKER"
  )
    throw new Error("Unknown action");
  const playerIndex = state.players.findIndex(
    (player) => player.id === action.playerId,
  );
  if (playerIndex < 0 || action.playerId !== state.activePlayerId)
    throw new Error("Not your turn");
  if (action.type === "END_TURN") {
    const nextPlayer = state.players[(playerIndex + 1) % state.players.length];
    return {
      ...state,
      revision: state.revision + 1,
      turnNumber: state.turnNumber + 1,
      activePlayerId: nextPlayer.id,
      players: state.players.map((player) =>
        player.id === nextPlayer.id
          ? { ...player, resources: Object.fromEntries(Object.entries(getProduction(state, player.id)).map(([key, value]) => [key, player.resources[key as Resource] + value])) as Resources }
          : player,
      ),
      units: state.units.map((unit) =>
        unit.ownerId === nextPlayer.id
          ? { ...unit, movement: unit.maxMovement, hasAttacked: false }
          : unit,
      ),
    };
  }
  if ("cityId" in action) {
    const city = state.cities.find(city => city.id === action.cityId);
    if (!city || city.ownerId !== action.playerId) throw new Error("Not your city");
    const updated = { ...city, workedTiles: [...city.workedTiles] };
    const resources = { ...state.players[playerIndex].resources };
    if (action.type === "UPGRADE_TOWN_HALL") {
      const cost = getUpgradeCost(city);
      if (cost === null) throw new Error("Town Hall is at maximum level");
      if (resources.gold < cost) throw new Error("Not enough Gold");
      resources.gold -= cost;
      updated.townHallLevel++;
    } else if (action.type === "GROW_POPULATION") {
      if (city.population >= getCityPopulation(state, city).cap) throw new Error("Population at cap");
      if (resources.food < economy.growthCost) throw new Error("Not enough Food");
      resources.food -= economy.growthCost;
      updated.population++;
    } else if ("tile" in action) {
      const key = positionKey(action.tile);
      if (!getWorkableTiles(state, city.id).some(tile => positionKey(tile) === key)) throw new Error("Tile is not workable by this city");
      if (action.type === "ASSIGN_WORKER") {
        if (city.workedTiles.includes(key)) throw new Error("Tile already worked");
        if (getCityPopulation(state, city).available <= 0) throw new Error("No available civilians");
        updated.workedTiles.push(key);
      } else {
        if (!city.workedTiles.includes(key)) throw new Error("Tile is not worked");
        updated.workedTiles = updated.workedTiles.filter(tile => tile !== key);
      }
    }
    return { ...state, revision: state.revision + 1,
      players: state.players.map(player => player.id === action.playerId ? { ...player, resources } : player),
      cities: state.cities.map(candidate => candidate.id === city.id ? updated : candidate) };
  }
  const capture = (positions: Position[]) =>
    state.cities.map((city) =>
      positions.some((p) => p.x === city.x && p.y === city.y)
        ? { ...city, ownerId: action.playerId }
        : city,
    );
  const unit = state.units.find((candidate) => candidate.id === action.unitId);
  if (!unit) throw new Error("Unknown unit");
  if (
    action.playerId !== state.activePlayerId ||
    unit.ownerId !== action.playerId
  )
    throw new Error("Not your unit or turn");
  if (unit.hasAttacked) throw new Error("Unit has finished acting");
  if (action.type === "ATTACK_UNIT") {
    const result = previewCombat(state, unit.id, action.targetId);
    return {
      ...state,
      revision: state.revision + 1,
      cities: capture(result.advance ? [result.advance] : []).map(city => ({ ...city,
        population: city.population - state.units.filter(candidate => candidate.homeCityId === city.id && ((candidate.id === result.attackerId && result.attackerHp === 0) || (candidate.id === result.defenderId && result.defenderHp === 0))).reduce((total, candidate) => total + candidate.populationCost, 0),
      })),
      units: state.units
        .map((candidate) =>
          candidate.id === unit.id
            ? {
                ...candidate,
                hp: result.attackerHp,
                movement: 0,
                hasAttacked: true,
                ...(result.advance ?? {}),
              }
            : candidate.id === action.targetId
              ? { ...candidate, hp: result.defenderHp }
              : candidate,
        )
        .filter((candidate) => candidate.hp > 0),
    };
  }
  const destination = getReachableTiles(state, unit.id).find(
    (tile) => tile.x === action.to.x && tile.y === action.to.y,
  );
  if (!destination) throw new Error("Unreachable destination");
  return {
    ...state,
    revision: state.revision + 1,
    cities: capture(destination.path),
    units: state.units.map((candidate) =>
      candidate.id === unit.id
        ? {
            ...candidate,
            x: destination.x,
            y: destination.y,
            movement: candidate.movement - destination.cost,
          }
        : candidate,
    ),
  };
}
