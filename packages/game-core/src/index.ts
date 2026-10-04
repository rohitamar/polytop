import { generateWorld, placeResources, resourceRules, type WorldConfig } from "./world";
import { getTechnology, getTechnologyCost, getTechnologyUnlockReason, hasTechnology, type TechnologyId } from "./technologies";
import { getUnitDefinition, getUnitStats, hasUnitAbility, isUnitEnabled, fullRuleset, type GameRules, type UnitType } from "./units";
import { computeVisibleTiles, isTileVisible, updatePlayerExploration, type PlayerExploration } from "./fog";
export { TileVisibility, visionRules, tilesInRange, computeVisibleTiles, updatePlayerExploration, getTileVisibility, isTileVisible, isTileExplored, getPlayerView, getPlayerAction, type PlayerView, type PlayerExploration } from "./fog";
export { fullRuleset, hasUnitAbility, isUnitEnabled, type GameRules, type UnitAbility, unitDefinitions, getUnitDefinition, type UnitType, type UnitDefinition } from "./units";
export { technologies, getTechnology, getTechnologyCost, hasTechnology, canUnlockTechnology, getTechnologyUnlockReason, type TechnologyId, type TechnologyDefinition, type TechEffect } from "./technologies";
export { getMapSize, mapSizes, terrainRules, resourceRules, type WorldConfig } from "./world";
export type Terrain = "grass" | "forest" | "mountain" | "water";
export type Position = { x: number; y: number };
export type Resource = "gold";
export type Resources = Record<Resource, number>;
export type Opportunity = "orchard" | "wheat" | "fishery" | "forest" | "mine";
export type Tile = Position & { terrain: Terrain; resource?: Opportunity; road?: boolean; port?: boolean };
export type Player = { id: string; name: string; resources: Resources; technologies: TechnologyId[] };
export type City = Position & {
  id: string;
  ownerId: string | null;
  townHallLevel: number;
  giantReward?: "available" | "claimed";
};
export const resourceDefinitions: Record<Opportunity, { goldReward: number; requiredTechnology: TechnologyId | null }> = {
  orchard: { goldReward: 2, requiredTechnology: null },
  wheat: { goldReward: 2, requiredTechnology: null },
  fishery: { goldReward: 2, requiredTechnology: null },
  forest: { goldReward: 2, requiredTechnology: null },
  mine: { goldReward: 3, requiredTechnology: "mining" },
};
export const economy = {
  goldIncome: [2, 3, 5],
  populationCaps: [3, 6, 9],
  upgradeCosts: [4, 8],
  maxLevel: 3,
} as const;
export const emptyResources = (): Resources => ({ gold: 0 });
export const calculateGoldPerTurn = (state: GameState, playerId: string) => getProduction(state, playerId).gold;
export const getIncome = calculateGoldPerTurn;
export const getUpgradeCost = (city: City) =>
  city.townHallLevel >= economy.maxLevel ? null : economy.upgradeCosts[city.townHallLevel - 1];
export function getCityPopulation(state: GameState, city: City) {
  const used = state.units.filter(unit => unit.homeCityId === city.id && unit.ownerId === city.ownerId).reduce((total, unit) => total + unit.populationCost, 0);
  const capacity = city.ownerId ? economy.populationCaps[city.townHallLevel - 1] : 0;
  return { used, capacity, available: capacity - used };
}
export function getPlayerPopulation(state: GameState, playerId: string) {
  const used = state.units.filter(unit => unit.ownerId === playerId).reduce((total, unit) => total + unit.populationCost, 0);
  const capacity = state.cities.reduce((total, city) => total + (city.ownerId === playerId ? economy.populationCaps[city.townHallLevel - 1] : 0), 0);
  return { used, capacity, available: capacity - used };
}
export function getCityResourceTiles(state: GameState, cityId: string): Tile[] {
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
  return result;
}
export function getProduction(state: GameState, playerId: string): Resources {
  const result = emptyResources();
  for (const city of state.cities.filter(city => city.ownerId === playerId)) {
    const income = getCityProduction(state, city.id);
    result.gold += income.gold;
  }
  return result;
}
export type Unit = Position & {
  unitType: UnitType;
  embarked?: boolean;
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
  actionPhase?: "ready" | "moved" | "escape" | "complete";
};
export type GameState = {
  rules?: GameRules;
  exploration?: Record<string, PlayerExploration>;
  perspectiveId?: string;
  rememberedTerritory?: TileTerritory[];
  rememberedUnits?: Unit[];
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
  return state.rememberedTerritory ?? state.tiles.map(tile => claimTile(state, tile, radius));
}
export const getTileTerritory = (state: GameState, x: number, y: number) => {
  const tile = getTile(state, x, y);
  return tile ? state.rememberedTerritory?.find(claim => positionKey(claim) === positionKey(tile)) ?? claimTile(state, tile, territoryRules.radius) : undefined;
};

export type GameAction =
  | {
      type: "move";
      playerId: string;
      unitId: string;
      to: Position;
    }
  | { type: "ATTACK_UNIT"; playerId: string; unitId: string; targetId: string }
  | { type: "CLAIM_GIANT"; playerId: string; cityId: string }
  | { type: "UPGRADE_TOWN_HALL"; playerId: string; cityId: string }
  | { type: "UNLOCK_TECHNOLOGY"; playerId: string; technologyId: TechnologyId }
  | { type: "RECRUIT_UNIT"; playerId: string; cityId: string; unitType: UnitType }
  | { type: "BUILD_PORT"; playerId: string; to: Position }
  | { type: "BUILD_ROAD"; playerId: string; to: Position }
  | { type: "END_TURN"; playerId: string };
export type ReachableTile = Position & { cost: number; path: Position[] };

export const warriorStats = { homeCityId: null as string | null, ...getUnitStats("warrior") };

export const movementCost: Record<Terrain, number> = {
  grass: 1,
  forest: 1,
  mountain: 1,
  water: 1,
};
export const roadRules = { goldCost: 3, movementCost: 0.5 } as const;
export function isRoadConnected(state: GameState, position: Position): boolean {
  const tile = getTile(state, position.x, position.y);
  return !!tile && (tile.terrain === "grass" || tile.terrain === "forest") &&
    (!!tile.road || state.cities.some(city => positionKey(city) === positionKey(position)));
}
export function getMovementCost(state: GameState, unit: Pick<Unit, "unitType">, from: Position, to: Tile): number {
  return getUnitDefinition(unit.unitType)?.domain === "land" && (!!getTile(state, from.x, from.y)?.road || !!to.road) && isRoadConnected(state, from) && isRoadConnected(state, to)
    ? roadRules.movementCost : movementCost[to.terrain];
}
export function getRoadBuildingReason(state: GameState, playerId: string, position: Position): string | null {
  const player = state.players.find(player => player.id === playerId);
  if (!player || state.activePlayerId !== playerId) return "Not your turn";
  if (!hasTechnology(state, playerId, "roads")) return "Requires Roads";
  if (!Number.isSafeInteger(position.x) || !Number.isSafeInteger(position.y) || position.x < 0 || position.y < 0 || position.x >= state.width || position.y >= state.height) return "Invalid tile";
  if (!isTileVisible(state, playerId, position)) return "Explore this tile first";
  const tile = getTile(state, position.x, position.y);
  if (!tile) return "Invalid tile";
  if (tile.terrain !== "grass" && tile.terrain !== "forest") return "Roads require traversable land";
  const ownerId = getTileTerritory(state, tile.x, tile.y)?.playerId;
  if (ownerId && ownerId !== playerId) return "Enemy-controlled land";
  if (isRoadConnected(state, tile)) return "Already road-connected";
  if (player.resources.gold < roadRules.goldCost) return "Not enough Gold";
  return null;
}

export const portRules = { goldCost: 7, maxMovement: 2 } as const;
export function getPortBuildingReason(state: GameState, playerId: string, position: Position): string | null {
  const player = state.players.find(player => player.id === playerId);
  if (!player || state.activePlayerId !== playerId) return "Not your turn";
  if (!hasTechnology(state, playerId, "fishing")) return "Requires Fishing";
  if (!Number.isSafeInteger(position.x) || !Number.isSafeInteger(position.y) || position.x < 0 || position.y < 0 || position.x >= state.width || position.y >= state.height) return "Invalid tile";
  const tile = getTile(state, position.x, position.y);
  if (!isTileVisible(state, playerId, position)) return "Explore this tile first";
  if (!tile || tile.terrain !== "water") return "Ports require Water";
  if (getTileTerritory(state, tile.x, tile.y)?.playerId !== playerId) return "Requires owned territory";
  if (![[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => { const neighbor = getTile(state, tile.x + dx, tile.y + dy); return neighbor && neighbor.terrain !== "water"; })) return "Requires coastal Water";
  if (tile.port) return "Already a Port";
  if (state.units.some(unit => positionKey(unit) === positionKey(tile))) return "Tile is occupied";
  if (player.resources.gold < portRules.goldCost) return "Not enough Gold";
  return null;
}
export function canUnitEnterTile(state: GameState, unit: Unit, from: Position, tile: Tile): boolean {
  if (unit.embarked) return tile.terrain === "water" || canUnitEnterTerrain(state, unit.ownerId, { ...unit, embarked: false }, tile.terrain);
  if (tile.terrain === "water" && getUnitDefinition(unit.unitType)?.domain === "land") return !!tile.port && getTile(state, from.x, from.y)?.terrain !== "water" && getTileTerritory(state, tile.x, tile.y)?.playerId === unit.ownerId;
  return canUnitEnterTerrain(state, unit.ownerId, unit, tile.terrain);
}

export function canUnitEnterTerrain(state: GameState, playerId: string, unit: Pick<Unit, "unitType" | "ownerId"> & { embarked?: boolean }, terrain: Terrain): boolean {
  const definition = getUnitDefinition(unit.unitType);
  if (!definition || unit.ownerId !== playerId || !state.players.some(player => player.id === playerId)) return false;
  if (unit.embarked || definition.domain === "naval") return terrain === "water";
  if (terrain === "water") return false;
  return terrain !== "mountain" || hasTechnology(state, playerId, "climbing");
}

export function canCollectResource(state: GameState, unit: Unit, tile: Tile): boolean {
  if (!tile.resource || !canUnitEnterTerrain(state, unit.ownerId, unit, tile.terrain)) return false;
  const required = resourceDefinitions[tile.resource].requiredTechnology;
  return !required || hasTechnology(state, unit.ownerId, required);
}

function collectResource(state: GameState, unit: Unit, position: Position): GameState {
  const tile = getTile(state, position.x, position.y);
  if (!tile || !canCollectResource(state, unit, tile)) return state;
  const reward = resourceDefinitions[tile.resource!].goldReward;
  return {
    ...state,
    players: state.players.map(player => player.id === unit.ownerId ? { ...player, resources: { gold: player.resources.gold + reward } } : player),
    tiles: state.tiles.map(candidate => {
      if (candidate !== tile) return candidate;
      const { resource: depleted, ...remaining } = candidate;
      return remaining;
    }),
  };
}
export const positionKey = ({ x, y }: Position) => `${x},${y}`;
export const getTile = (state: GameState, x: number, y: number) => {
  const indexed = state.tiles[y * state.width + x];
  return indexed?.x === x && indexed.y === y ? indexed : state.tiles.find(tile => tile.x === x && tile.y === y);
};

export function createGame(seed = "fern-104", playerCount = 2, config: WorldConfig & { rules?: GameRules } = {}): GameState {
  const world = generateWorld(seed, playerCount, config);
  const { starts, villages, tiles } = world;
  const cities: City[] = [
    ...starts.map((position, i) => ({
      ...position,
      id: `city-${i + 1}`,
      ownerId: `player-${i + 1}`,
      townHallLevel: 1,
    })),
    ...villages.map((position, i) => ({
      ...position,
      id: `neutral-${i + 1}`,
      ownerId: null,
      townHallLevel: 1,
    })),
  ];
  placeResources(seed, tiles, world.width, world.height);
  for (const tile of tiles) if (cities.some(city => city.x === tile.x && city.y === tile.y)) delete tile.resource;
  const state: GameState = {
    rules: { enabledUnitTypes: [...(config.rules ?? fullRuleset).enabledUnitTypes], enabledUnitAbilities: [...(config.rules ?? fullRuleset).enabledUnitAbilities] },
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
      resources: emptyResources(),
      technologies: [],
    })),
    cities,
    turnNumber: 1,
    tiles,
    units: starts.map((position, i) => ({
      ...position,
      id: `warrior-${i + 1}`,
      ownerId: `player-${i + 1}`,
      movement: i === 0 ? warriorStats.maxMovement : 0,
      ...warriorStats,
      homeCityId: `city-${i + 1}`,
      hp: warriorStats.maxHp,
      hasAttacked: false,
      actionPhase: "ready",
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
  state.players[0].resources.gold = calculateGoldPerTurn(state, state.activePlayerId);
  return updatePlayerExploration(state);
}

export function getReachableTiles(
  state: GameState,
  unitId: string,
): ReachableTile[] {
  const unit = state.units.find((candidate) => candidate.id === unitId);
  if (!unit || !isUnitEnabled(state.rules, unit.unitType) || unit.actionPhase === "complete" || (unit.hasAttacked && (unit.actionPhase !== "escape" || !hasUnitAbility(state.rules, unit.unitType, "ESCAPE"))) || unit.ownerId !== state.activePlayerId)
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
      [-1, -1], [1, -1], [1, 1], [-1, 1],
    ]) {
      const next = { x: current.x + dx, y: current.y + dy };
      if (
        next.x < 0 ||
        next.y < 0 ||
        next.x >= state.width ||
        next.y >= state.height
      )
        continue;
      const tile = getTile(state, next.x, next.y) ?? (state.perspectiveId ? { ...next, terrain: unit.embarked ? "water" as const : "grass" as const } : undefined);
      if (dx && dy && !unit.embarked && tile?.terrain !== "water") continue;
      if (
        !tile || !canUnitEnterTile(state, unit, current, tile) ||
        state.units.some(
          (other) =>
            other.id !== unitId && other.x === next.x && other.y === next.y,
        )
      )
        continue;
      const cost = current.cost + getMovementCost(state, unit, current, tile);
      if (
        cost > unit.movement ||
        (visited.get(positionKey(next))?.cost ?? Infinity) <= cost
      )
        continue;
      const step = { ...next, cost, path: [...current.path, next] };
      visited.set(positionKey(next), step);
      const changesDomain = (getTile(state, current.x, current.y)?.terrain === "water") !== (tile.terrain === "water");
      if (!changesDomain) queue.push(step);
    }
  }
  return [...visited.values()].filter((tile) => tile.cost > 0);
}

function arriveUnit(state: GameState, unit: Unit, destination: Position, cost: number): Unit {
  const water = getTile(state, destination.x, destination.y)!.terrain === "water";
  const transforms = getUnitDefinition(unit.unitType)?.domain === "land" && !!unit.embarked !== water;
  return {
    ...unit, x: destination.x, y: destination.y,
    ...(transforms ? water ? { embarked: true, maxMovement: portRules.maxMovement, attack: 0, defense: 1, range: 0 } : { ...getUnitStats(unit.unitType), embarked: false, maxHp: unit.maxHp } : {}),
    movement: transforms || unit.embarked ? 0 : unit.movement - cost,
    hasAttacked: transforms || unit.hasAttacked,
    actionPhase: transforms || unit.hasAttacked ? "complete" : "moved",
    ...(unit.hasAttacked ? { movement: 0 } : {}),
  };
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

export const gridDistance = (a: Position, b: Position) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const distance = gridDistance;

export function getAttackTargets(state: GameState, unitId: string): Unit[] {
  const unit = state.units.find((candidate) => candidate.id === unitId);
  if (!unit || unit.ownerId !== state.activePlayerId || unit.hasAttacked || unit.embarked || !isUnitEnabled(state.rules, unit.unitType) || unit.actionPhase === "complete" || (unit.actionPhase === "moved" && !hasUnitAbility(state.rules, unit.unitType, "DASH")))
    return [];
  const visible = computeVisibleTiles(state, unit.ownerId);
  return state.units.filter(
    (target) =>
      target.ownerId !== unit.ownerId && distance(unit, target) <= unit.range && visible.has(positionKey(target)),
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
        (5 * source.attack * (hp / source.maxHp)) / Math.max(1, target.defense * getDefenseBonus(state, target)),
      ),
    );
  const damage = Math.min(
    defender.hp,
    damageFor(attacker, defender, attacker.hp),
  );
  const defenderHp = defender.hp - damage;
  const retaliation =
    defenderHp > 0 && !defender.embarked && !hasUnitAbility(state.rules, defender.unitType, "STIFF") && distance(attacker, defender) <= defender.range
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
      canUnitEnterTile(state, attacker, attacker, tile)
        ? { x: defender.x, y: defender.y }
        : null,
  };
}

export function getDefenseBonus(state: GameState, unit: Unit): number {
  return hasUnitAbility(state.rules, unit.unitType, "FORTIFY") && !unit.embarked && state.cities.some(city => city.ownerId === unit.ownerId && positionKey(city) === positionKey(unit)) ? 1.5 : 1;
}

function spawnUnit(state: GameState, unitType: UnitType, position: Position & { id: string }, ownerId: string): Unit {
  const definition = getUnitDefinition(unitType)!;
  return { x: position.x, y: position.y, ...getUnitStats(unitType), id: `recruit-${state.revision + 1}`, ownerId, homeCityId: position.id, movement: 0, hp: definition.maxHp, hasAttacked: true, actionPhase: "complete" };
}

export function getGiantRewardReason(state: GameState, playerId: string, cityId: string): string | null {
  if (state.activePlayerId !== playerId) return "Not your turn";
  const city = state.cities.find(candidate => candidate.id === cityId);
  if (!city || city.ownerId !== playerId) return "Not your city";
  if (city.giantReward !== "available") return "No super-unit reward available";
  if (!isUnitEnabled(state.rules, "giant")) return "Unit disabled by current ruleset";
  if (!getRecruitSpawn(state, cityId, "giant")) return "City spawn tile must be empty and passable";
  return null;
}

export function getRecruitSpawn(state: GameState, cityId: string, unitType: UnitType = "warrior"): Position | null {
  const city = state.cities.find(city => city.id === cityId);
  if (!city || city.x < 0 || city.y < 0 || city.x >= state.width || city.y >= state.height) return null;
  if (!city.ownerId) return null;
  const definition = getUnitDefinition(unitType);
  if (!definition) return null;
  const candidates = definition.domain === "naval"
    ? [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dx, dy]) => ({ x: city.x + dx, y: city.y + dy }))
    : [{ x: city.x, y: city.y }];
  return candidates.find(position => {
    const tile = getTile(state, position.x, position.y);
    return position.x >= 0 && position.y >= 0 && position.x < state.width && position.y < state.height && tile &&
      canUnitEnterTerrain(state, city.ownerId!, { unitType, ownerId: city.ownerId! }, tile.terrain) &&
      !state.units.some(unit => positionKey(unit) === positionKey(position));
  }) ?? null;
}

export function getRecruitmentReason(state: GameState, playerId: string, cityId: string, unitType: string): string | null {
  const player = state.players.find(player => player.id === playerId);
  if (!player || state.activePlayerId !== playerId) return "Not your turn";
  const city = state.cities.find(city => city.id === cityId);
  if (!city || city.ownerId !== playerId) return "Not your city";
  const definition = getUnitDefinition(unitType);
  if (!definition) return "Unknown unit type";
  if (!isUnitEnabled(state.rules, definition.id as UnitType)) return "Unit disabled by current ruleset";
  if (!definition.recruitable || definition.goldCost === null) return "Requires city super-unit reward";
  if (definition.domain === "naval") return "Build a Port and move a land unit onto it";
  if (definition.requiredTechnology && !hasTechnology(state, playerId, definition.requiredTechnology)) return `Requires ${getTechnology(definition.requiredTechnology)!.name}`;
  if (player.resources.gold < definition.goldCost) return "Not enough Gold";
  if (getPlayerPopulation(state, playerId).available < definition.populationCost) return "Insufficient population";
  if (!getRecruitSpawn(state, cityId, definition.id as UnitType)) return "City spawn tile must be empty and passable";
  return null;
}

export const canRecruitUnit = (state: GameState, playerId: string, cityId: string, unitType: string) => getRecruitmentReason(state, playerId, cityId, unitType) === null;

export function applyAction(state: GameState, action: GameAction): GameState {
  if (state.perspectiveId) throw new Error("Player views cannot apply authoritative actions");
  let discovered = updatePlayerExploration(state);
  const next = transition(state, action);
  if (action.type === "move") {
    const destination = getReachableTiles(state, action.unitId).find(tile => positionKey(tile) === positionKey(action.to));
    for (const position of destination?.path ?? []) {
      discovered = updatePlayerExploration({ ...next, exploration: discovered.exploration, units: next.units.map(unit => unit.id === action.unitId ? { ...unit, ...position } : unit) });
    }
  }
  return updatePlayerExploration({ ...next, exploration: discovered.exploration });
}

function transition(state: GameState, action: GameAction): GameState {
  if (
    action.type !== "move" &&
    action.type !== "ATTACK_UNIT" &&
    action.type !== "END_TURN" &&
    action.type !== "UPGRADE_TOWN_HALL" &&
    action.type !== "CLAIM_GIANT" &&
    action.type !== "UNLOCK_TECHNOLOGY" &&
    action.type !== "RECRUIT_UNIT" &&
    action.type !== "BUILD_ROAD" &&
    action.type !== "BUILD_PORT"
  )
    throw new Error("Unknown action");
  const playerIndex = state.players.findIndex(
    (player) => player.id === action.playerId,
  );
  if (playerIndex < 0 || action.playerId !== state.activePlayerId)
    throw new Error("Not your turn");
  if (action.type === "BUILD_PORT") {
    const reason = getPortBuildingReason(state, action.playerId, action.to);
    if (reason) throw new Error(reason);
    return {
      ...state, revision: state.revision + 1,
      players: state.players.map(player => player.id === action.playerId ? { ...player, resources: { gold: player.resources.gold - portRules.goldCost } } : player),
      tiles: state.tiles.map(tile => positionKey(tile) === positionKey(action.to) ? { ...tile, port: true } : tile),
    };
  }
  if (action.type === "BUILD_ROAD") {
    const reason = getRoadBuildingReason(state, action.playerId, action.to);
    if (reason) throw new Error(reason);
    return {
      ...state,
      revision: state.revision + 1,
      players: state.players.map(player => player.id === action.playerId ? { ...player, resources: { gold: player.resources.gold - roadRules.goldCost } } : player),
      tiles: state.tiles.map(tile => positionKey(tile) === positionKey(action.to) ? { ...tile, road: true } : tile),
    };
  }
  if (action.type === "RECRUIT_UNIT") {
    const reason = getRecruitmentReason(state, action.playerId, action.cityId, action.unitType);
    if (reason) throw new Error(reason);
    const definition = getUnitDefinition(action.unitType)!;
    const spawn = getRecruitSpawn(state, action.cityId, action.unitType)!;
    return {
      ...state,
      revision: state.revision + 1,
      players: state.players.map(player => player.id === action.playerId ? { ...player, resources: { gold: player.resources.gold - definition.goldCost! } } : player),
      units: [...state.units, spawnUnit(state, action.unitType, { ...spawn, id: action.cityId }, action.playerId)],
    };
  }
  if (action.type === "UNLOCK_TECHNOLOGY") {
    const reason = getTechnologyUnlockReason(state, action.playerId, action.technologyId);
    if (reason) throw new Error(reason);
    const technology = getTechnology(action.technologyId)!;
    let next: GameState = {
      ...state,
      revision: state.revision + 1,
      players: state.players.map(player => player.id === action.playerId ? {
        ...player,
        resources: { ...player.resources, gold: player.resources.gold - getTechnologyCost(state, action.playerId, technology.id) },
        technologies: [...player.technologies, technology.id],
      } : player),
    };
    const collectionEffects = technology.effects.filter(effect => effect.type === "collect-resource");
    if (collectionEffects.length) {
      for (const unit of next.units.filter(unit => unit.ownerId === action.playerId)) {
        const resource = getTile(next, unit.x, unit.y)?.resource;
        if (resource && collectionEffects.some(effect => effect.resource === resource)) next = collectResource(next, unit, unit);
      }
    }
    return next;
  }
  if (action.type === "END_TURN") {
    const nextPlayer = state.players[(playerIndex + 1) % state.players.length];
    return {
      ...state,
      revision: state.revision + 1,
      turnNumber: state.turnNumber + 1,
      activePlayerId: nextPlayer.id,
      players: state.players.map((player) =>
        player.id === nextPlayer.id
          ? { ...player, resources: { gold: player.resources.gold + calculateGoldPerTurn(state, player.id) } }
          : player,
      ),
      units: state.units.map((unit) =>
        unit.ownerId === nextPlayer.id
          ? { ...unit, movement: unit.maxMovement, hasAttacked: false, actionPhase: "ready" }
          : unit,
      ),
    };
  }
  if ("cityId" in action) {
    const city = state.cities.find(city => city.id === action.cityId);
    if (!city || city.ownerId !== action.playerId) throw new Error("Not your city");
    const updated = { ...city };
    const resources = { ...state.players[playerIndex].resources };
    if (action.type === "CLAIM_GIANT") {
      const reason = getGiantRewardReason(state, action.playerId, city.id);
      if (reason) throw new Error(reason);
      return { ...state, revision: state.revision + 1,
        cities: state.cities.map(candidate => candidate.id === city.id ? { ...candidate, giantReward: "claimed" } : candidate),
        units: [...state.units, spawnUnit(state, "giant", city, action.playerId)] };
    }
    if (action.type === "UPGRADE_TOWN_HALL") {
      const cost = getUpgradeCost(city);
      if (cost === null) throw new Error("Town Hall is at maximum level");
      if (resources.gold < cost) throw new Error("Not enough Gold");
      resources.gold -= cost;
      updated.townHallLevel++;
      if (updated.townHallLevel === economy.maxLevel) updated.giantReward = "available";
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
  if (!isUnitEnabled(state.rules, unit.unitType)) throw new Error("Unit disabled by current ruleset");
  if (unit.actionPhase === "complete" || (unit.hasAttacked && (action.type !== "move" || unit.actionPhase !== "escape" || !hasUnitAbility(state.rules, unit.unitType, "ESCAPE")))) throw new Error("Unit has finished acting");
  if (action.type === "ATTACK_UNIT") {
    const result = previewCombat(state, unit.id, action.targetId);
    const finishAttack = (candidate: Unit): Unit => {
      const attacked = { ...candidate, hp: result.attackerHp, movement: 0, hasAttacked: true };
      const advanced = result.advance ? arriveUnit(state, attacked, result.advance, 0) : attacked;
      const escape = !advanced.embarked && hasUnitAbility(state.rules, advanced.unitType, "ESCAPE");
      return { ...advanced, movement: escape ? advanced.maxMovement : 0, actionPhase: escape ? "escape" : "complete" };
    };
    const next: GameState = {
      ...state,
      revision: state.revision + 1,
      cities: capture(result.advance ? [result.advance] : []),
      units: state.units
        .map((candidate): Unit =>
          candidate.id === unit.id
            ? finishAttack(candidate)
            : candidate.id === action.targetId
              ? { ...candidate, hp: result.defenderHp }
              : candidate,
        )
        .filter((candidate) => candidate.hp > 0),
    };
    return result.advance && result.attackerHp > 0 ? collectResource(next, next.units.find(candidate => candidate.id === unit.id)!, result.advance) : next;
  }
  const destination = getReachableTiles(state, unit.id).find(
    (tile) => tile.x === action.to.x && tile.y === action.to.y,
  );
  if (!destination) throw new Error("Unreachable destination");
  const moved = arriveUnit(state, unit, destination, destination.cost);
  return collectResource({
    ...state,
    revision: state.revision + 1,
    cities: capture(destination.path),
    units: state.units.map(candidate => candidate.id === unit.id ? moved : candidate),
  }, moved, destination);
}
