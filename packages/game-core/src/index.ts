import { getCityGrowth, settleCityGrowth, getCityRewards, getHarvestReason, getImprovementReason, getClearForestReason, getBridgeBuildingReason, improvementDefinitions, isWater, adjacentTiles, type Improvement, type CityReward } from "./development";
export { getCityGrowth, getCityRewards, getHarvestReason, getImprovementReason, getClearForestReason, getBridgeBuildingReason, getConnectedCities, getImprovementPopulation, improvementDefinitions, rewardNames, isWater, type Improvement, type CityReward } from "./development";
import { generateWorld, placeResources, resourceRules, type WorldConfig } from "./world";
import { getTechnology, getTechnologyCost, getTechnologyUnlockReason, hasTechnology, type TechnologyId } from "./technologies";
import { getUnitDefinition, getUnitStats, hasUnitAbility, isUnitEnabled, fullRuleset, type GameRules, type UnitType } from "./units";
import { computeVisibleTiles, isTileVisible, updatePlayerExploration, type PlayerExploration } from "./fog";
export { TileVisibility, visionRules, tilesInRange, computeVisibleTiles, updatePlayerExploration, getTileVisibility, isTileVisible, isTileExplored, getPlayerView, getPlayerAction, type PlayerView, type PlayerExploration } from "./fog";
export { fullRuleset, hasUnitAbility, isUnitEnabled, type GameRules, type UnitAbility, unitDefinitions, getUnitDefinition, getUnitStats, type UnitType, type UnitDefinition } from "./units";
export { technologies, getTechnology, getTechnologyCost, hasTechnology, canUnlockTechnology, getTechnologyUnlockReason, type TechnologyId, type TechnologyDefinition, type TechEffect } from "./technologies";
export { getMapSize, mapSizes, terrainRules, resourceRules, type WorldConfig } from "./world";
export type Terrain = "grass" | "forest" | "mountain" | "water" | "ocean";
export type Position = { x: number; y: number };
export type Resource = "gold";
export type Resources = Record<Resource, number>;
export type Opportunity = "orchard" | "wheat" | "fishery" | "mine" | "animal" | "starfish";
export type Tile = Position & { terrain: Terrain; resource?: Opportunity; road?: boolean; port?: boolean; bridge?: boolean; improvement?: Improvement };
export type Player = { id: string; name: string; resources: Resources; technologies: TechnologyId[]; hasStartedTurn?: boolean };
export type City = Position & {
  id: string;
  ownerId: string | null;
  townHallLevel: number;
  population?: number;
  capitalOf?: string;
  rewardPending?: boolean;
  workshop?: boolean;
  walls?: boolean;
  expanded?: boolean;
  parks?: number;
  giantReward?: "available" | "claimed";
};
export const economy = { startingGold: 5 } as const;
export const emptyResources = (): Resources => ({ gold: 0 });
export const calculateGoldPerTurn = (state: GameState, playerId: string) => getProduction(state, playerId).gold;
export const getIncome = calculateGoldPerTurn;
export function getCityPopulation(state: GameState, city: City) {
  const used = state.units.filter(unit => unit.homeCityId === city.id && unit.ownerId === city.ownerId).length;
  const capacity = city.ownerId ? city.townHallLevel + 1 : 0;
  return { used, capacity, available: capacity - used };
}
export function getPlayerPopulation(state: GameState, playerId: string) {
  const cities = state.cities.filter(city => city.ownerId === playerId);
  const used = cities.reduce((sum, city) => sum + getCityPopulation(state, city).used, 0);
  const capacity = cities.reduce((sum, city) => sum + getCityPopulation(state, city).capacity, 0);
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
  if (state.units.some(unit => unit.ownerId !== city.ownerId && positionKey(unit) === positionKey(city))) return result;
  result.gold = Math.max(0, city.townHallLevel + Number(city.capitalOf === city.ownerId) + Number(!!city.workshop) + (city.parks ?? 0) + Math.min(0, getCityGrowth(state, city).current));
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
  carriedUnitType?: UnitType;
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
  outcome?: { eliminatedPlayerIds: string[]; winnerId: string | null };
  rules?: GameRules;
  peaceOffers?: { from: string; to: string }[];
  treaties?: { a: string; b: string }[];
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
export const territoryRules = { radius: 1 } as const;
export type TileTerritory = Position & { cityId: string | null; playerId: string | null };
function claimTile(state: GameState, tile: Position, radius: number): TileTerritory {
  let closest: City | undefined;
  let best = Infinity;
  for (const city of state.cities) {
    const distance = Math.max(Math.abs(city.x - tile.x), Math.abs(city.y - tile.y));
    if (distance <= radius + Number(!!city.expanded) && (distance < best || distance === best && city.id < closest!.id)) { closest = city; best = distance; }
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
export const areAtPeace = (state: GameState, a: string, b: string) => a === b || !!state.treaties?.some(treaty => treaty.a === a && treaty.b === b || treaty.a === b && treaty.b === a);

export type GameAction =
  | {
      type: "move";
      playerId: string;
      unitId: string;
      to: Position;
    }
  | { type: "ATTACK_UNIT"; playerId: string; unitId: string; targetId: string }
  | { type: "CLAIM_GIANT"; playerId: string; cityId: string }
  | { type: "CHOOSE_CITY_REWARD"; playerId: string; cityId: string; reward: CityReward }
  | { type: "HARVEST_RESOURCE"; playerId: string; to: Position }
  | { type: "BUILD_IMPROVEMENT"; playerId: string; to: Position; improvement: Improvement }
  | { type: "CLEAR_FOREST"; playerId: string; to: Position }
  | { type: "BUILD_BRIDGE"; playerId: string; to: Position }
  | { type: "UPGRADE_NAVAL"; playerId: string; unitId: string; unitType: UnitType }
  | { type: "HARVEST_STARFISH"; playerId: string; unitId: string }
  | { type: "PROPOSE_PEACE" | "ACCEPT_PEACE" | "BREAK_PEACE"; playerId: string; otherPlayerId: string }
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
  ocean: 1,
};
export const roadRules = { goldCost: 3, movementCost: 0.5 } as const;
export function isRoadConnected(state: GameState, position: Position): boolean {
  const tile = getTile(state, position.x, position.y);
  return !!tile && (tile.terrain === "grass" || tile.terrain === "forest" || !!tile.bridge) &&
    (!!tile.road || !!tile.bridge || state.cities.some(city => positionKey(city) === positionKey(position)));
}
export function getMovementCost(state: GameState, unit: Pick<Unit, "unitType"> & { embarked?: boolean }, from: Position, to: Tile): number {
  return !unit.embarked && getUnitDefinition(unit.unitType)?.domain === "land" && (!!getTile(state, from.x, from.y)?.road || !!to.road || !!getTile(state, from.x, from.y)?.bridge || !!to.bridge) && isRoadConnected(state, from) && isRoadConnected(state, to)
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

export const portRules = { goldCost: 7 } as const;
export function getPortBuildingReason(state: GameState, playerId: string, position: Position): string | null {
  const player = state.players.find(player => player.id === playerId);
  if (!player || state.activePlayerId !== playerId) return "Not your turn";
  if (!hasTechnology(state, playerId, "fishing")) return "Requires Fishing";
  if (!Number.isSafeInteger(position.x) || !Number.isSafeInteger(position.y) || position.x < 0 || position.y < 0 || position.x >= state.width || position.y >= state.height) return "Invalid tile";
  const tile = getTile(state, position.x, position.y);
  if (!isTileVisible(state, playerId, position)) return "Explore this tile first";
  if (!tile || tile.terrain !== "water") return "Ports require Water";
  if (getTileTerritory(state, tile.x, tile.y)?.playerId !== playerId) return "Requires owned territory";
  if (![[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => { const neighbor = getTile(state, tile.x + dx, tile.y + dy); return neighbor && !isWater(neighbor.terrain); })) return "Requires coastal Water";
  if (tile.port || tile.bridge || tile.improvement) return "Already developed";
  if (state.units.some(unit => positionKey(unit) === positionKey(tile))) return "Tile is occupied";
  if (player.resources.gold < portRules.goldCost) return "Not enough Gold";
  return null;
}
export function canUnitEnterTile(state: GameState, unit: Unit, from: Position, tile: Tile): boolean {
  if (unit.embarked && !isWater(tile.terrain) && !isUnitEnabled(state.rules, unit.carriedUnitType ?? "warrior")) return false;
  if (unit.embarked) return canUnitEnterTerrain(state, unit.ownerId, unit, tile.terrain) || canUnitEnterTerrain(state, unit.ownerId, { ...unit, unitType: unit.carriedUnitType ?? "warrior", embarked: false }, tile.terrain);
  if (isWater(tile.terrain) && getUnitDefinition(unit.unitType)?.domain === "land") return !!tile.bridge || hasTechnology(state, unit.ownerId, "fishing") && isUnitEnabled(state.rules, unit.unitType === "giant" ? "juggernaut" : "raft") && !!tile.port && !isWater(getTile(state, from.x, from.y)!.terrain) && (getTileTerritory(state, tile.x, tile.y)?.playerId === unit.ownerId || areAtPeace(state, unit.ownerId, getTileTerritory(state, tile.x, tile.y)?.playerId ?? ""));
  return canUnitEnterTerrain(state, unit.ownerId, unit, tile.terrain);
}
export function canUnitEnterTerrain(state: GameState, playerId: string, unit: Pick<Unit, "unitType" | "ownerId"> & { embarked?: boolean }, terrain: Terrain): boolean {
  const definition = getUnitDefinition(unit.unitType);
  if (!definition || unit.ownerId !== playerId || !state.players.some(player => player.id === playerId)) return false;
  if (unit.embarked || definition.domain === "naval") return terrain === "water" || terrain === "ocean" && hasTechnology(state, playerId, "sailing");
  if (isWater(terrain)) return false;
  return terrain !== "mountain" || hasTechnology(state, playerId, "climbing");
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
      population: 0,
      capitalOf: `player-${i + 1}`,
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
    outcome: { eliminatedPlayerIds: [], winnerId: null },
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
      resources: { gold: economy.startingGold },
      hasStartedTurn: i === 0,
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
      nearby[0].resource = "orchard";
      if (!opportunities.includes(nearby[0])) opportunities.push(nearby[0]);
    }
    for (const tile of nearby) {
      if (opportunities.length >= resourceRules.minimumCityOpportunities) break;
      if (!tile.resource) { tile.resource = food?.resource ?? "orchard"; opportunities.push(tile); }
    }
  }
  if (config.scenario === "demo") getTile(state, 4, 3)!.resource = "orchard";
  return updatePlayerExploration(state);
}

export function getReachableTiles(
  state: GameState,
  unitId: string,
): ReachableTile[] {
  const unit = state.units.find((candidate) => candidate.id === unitId);
  if (state.outcome?.winnerId || state.outcome?.eliminatedPlayerIds.includes(state.activePlayerId) || !unit || !isUnitEnabled(state.rules, unit.unitType) || unit.actionPhase === "complete" || (unit.hasAttacked && (unit.actionPhase !== "escape" || !hasUnitAbility(state.rules, unit.unitType, "ESCAPE"))) || unit.ownerId !== state.activePlayerId)
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
      if (dx && dy && !unit.embarked && !isWater(tile?.terrain ?? "grass")) continue;
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
      const changesDomain = isWater(getTile(state, current.x, current.y)?.terrain ?? "grass") !== (isWater(tile.terrain) && !tile.bridge);
      if (!changesDomain) queue.push(step);
    }
  }
  return [...visited.values()].filter((tile) => tile.cost > 0);
}

function arriveUnit(state: GameState, unit: Unit, destination: Position, cost: number): Unit {
  const tile = getTile(state, destination.x, destination.y)!;
  const water = isWater(tile.terrain) && !tile.bridge;
  const embark = !unit.embarked && getUnitDefinition(unit.unitType)?.domain === "land" && water;
  const land = unit.embarked && !isWater(tile.terrain);
  const type = embark ? unit.unitType === "giant" ? "juggernaut" : "raft" : land ? unit.carriedUnitType ?? "warrior" : unit.unitType;
  const transforms = embark || land;
  return { ...unit, x: destination.x, y: destination.y,
    ...(transforms ? { ...getUnitStats(type), embarked: embark, carriedUnitType: embark ? unit.unitType : undefined, maxHp: unit.maxHp } : {}),
    movement: transforms || unit.embarked || unit.hasAttacked ? 0 : unit.movement - cost,
    hasAttacked: transforms || unit.hasAttacked,
    actionPhase: transforms || unit.hasAttacked ? "complete" : "moved" };
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
  if (state.outcome?.winnerId || state.outcome?.eliminatedPlayerIds.includes(state.activePlayerId) || !unit || unit.ownerId !== state.activePlayerId || unit.hasAttacked || unit.attack <= 0 || !isUnitEnabled(state.rules, unit.unitType) || unit.actionPhase === "complete" || (unit.actionPhase === "moved" && !hasUnitAbility(state.rules, unit.unitType, "DASH")))
    return [];
  const visible = computeVisibleTiles(state, unit.ownerId);
  return state.units.filter(
    (target) =>
      !areAtPeace(state, target.ownerId, unit.ownerId) && distance(unit, target) <= unit.range && visible.has(positionKey(target)),
  );
}

function combatDamage(state: GameState, source: Unit, target: Unit, hp: number): number {
  return Math.max(1, Math.round((5 * source.attack * hp / source.maxHp) / Math.max(1, target.defense * getDefenseBonus(state, target))));
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
  const damage = Math.min(
    defender.hp,
    combatDamage(state, attacker, defender, attacker.hp),
  );
  const defenderHp = defender.hp - damage;
  const retaliation =
    defenderHp > 0 && defender.attack > 0 && !hasUnitAbility(state.rules, defender.unitType, "STIFF") && distance(attacker, defender) <= defender.range
      ? Math.min(attacker.hp, combatDamage(state, defender, attacker, defenderHp))
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
      attacker.range === 1 && distance(attacker, defender) === 1 &&
      tile &&
      canUnitEnterTile(state, attacker, attacker, tile)
        ? { x: defender.x, y: defender.y }
        : null,
  };
}

export function getDefenseBonus(state: GameState, unit: Unit): number {
  const city = state.cities.find(city => city.ownerId === unit.ownerId && positionKey(city) === positionKey(unit));
  if (city && hasUnitAbility(state.rules, unit.unitType, "FORTIFY") && !unit.embarked) return city.walls ? 4 : 1.5;
  const terrain = getTile(state, unit.x, unit.y)?.terrain;
  return terrain === "forest" && hasTechnology(state, unit.ownerId, "archery") || terrain === "mountain" && hasTechnology(state, unit.ownerId, "climbing") ? 1.5 : 1;
}

function exploreCity(state: GameState, city: City, playerId: string): GameState {
  let revealed = state;
  let position: Position = city;
  for (let step = 0; step < 15; step++) {
    const candidates = state.tiles.filter(tile => adjacentTiles(position, tile) && (tile.terrain !== "mountain" || hasTechnology(state, playerId, "climbing")) && (!isWater(tile.terrain) || hasTechnology(state, playerId, tile.terrain === "ocean" ? "sailing" : "fishing")));
    candidates.sort((a, b) => Number(revealed.exploration?.[playerId]?.exploredTiles.includes(positionKey(a))) - Number(revealed.exploration?.[playerId]?.exploredTiles.includes(positionKey(b))) || ((a.x * 31 + a.y * 17 + step * 13) % 97) - ((b.x * 31 + b.y * 17 + step * 13) % 97));
    if (!candidates.length) break;
    position = candidates[0];
    const scout: Unit = { ...state.units.find(unit => unit.ownerId === playerId)!, ...warriorStats, ...position, id: "reward-explorer", ownerId: playerId, hp: 10, movement: 0, hasAttacked: true };
    revealed = updatePlayerExploration({ ...revealed, units: [...state.units, scout] });
  }
  return { ...state, exploration: revealed.exploration };
}

export function getNavalUpgradeReason(state: GameState, playerId: string, unitId: string, type: string): string | null {
  const unit = state.units.find(unit => unit.id === unitId);
  if (state.activePlayerId !== playerId || unit?.ownerId !== playerId) return "Not your unit or turn";
  if (unit.unitType !== "raft" || !unit.embarked || unit.hasAttacked || unit.actionPhase !== "ready") return "Requires a ready Raft";
  if (!isUnitEnabled(state.rules, unit.unitType)) return "Unit disabled by current ruleset";
  const definition = getUnitDefinition(type);
  if (!definition || definition.domain !== "naval" || definition.goldCost === null) return "Invalid naval upgrade";
  if (!isUnitEnabled(state.rules, type as UnitType)) return "Unit disabled by current ruleset";
  if (getTileTerritory(state, unit.x, unit.y)?.playerId !== playerId) return "Upgrade in owned territory";
  if (definition.requiredTechnology && !hasTechnology(state, playerId, definition.requiredTechnology)) return `Requires ${getTechnology(definition.requiredTechnology)!.name}`;
  return state.players.find(player => player.id === playerId)!.resources.gold < definition.goldCost ? "Not enough Gold" : null;
}

function resolveAreaDamage(previous: GameState, next: GameState, source: Unit, position: Position, center: Position, ability: "SPLASH" | "STOMP"): GameState {
  if (!hasUnitAbility(previous.rules, source.unitType, ability) || !next.units.some(unit => unit.id === source.id)) return next;
  const visible = computeVisibleTiles(previous, source.ownerId);
  const units = next.units.map(target => {
    if (areAtPeace(previous, target.ownerId, source.ownerId) || !adjacentTiles(target, center) || !visible.has(positionKey(target))) return target;
    const damage = ability === "STOMP" ? source.attack : Math.max(1, Math.round(combatDamage(previous, source, target, source.hp) / 2));
    return { ...target, hp: Math.max(0, target.hp - damage) };
  }).filter(unit => unit.hp > 0);
  return { ...next, units: units.map(unit => unit.id === source.id ? { ...unit, ...position } : unit) };
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
  if (definition.domain === "naval") return "Build a Port and move a land unit onto it";
  if (!definition.recruitable || definition.goldCost === null) return "Requires city super-unit reward";
  if (definition.requiredTechnology && !hasTechnology(state, playerId, definition.requiredTechnology)) return `Requires ${getTechnology(definition.requiredTechnology)!.name}`;
  if (player.resources.gold < definition.goldCost) return "Not enough Gold";
  if (getCityPopulation(state, city).available < 1) return "City unit capacity reached";
  if (!getRecruitSpawn(state, cityId, definition.id as UnitType)) return "City spawn tile must be empty and passable";
  return null;
}

export const canRecruitUnit = (state: GameState, playerId: string, cityId: string, unitType: string) => getRecruitmentReason(state, playerId, cityId, unitType) === null;

export function applyAction(state: GameState, action: GameAction): GameState {
  if (state.perspectiveId) throw new Error("Player views cannot apply authoritative actions");
  if (state.outcome?.winnerId) throw new Error("The match has ended");
  if (state.outcome?.eliminatedPlayerIds.includes(action.playerId)) throw new Error("You have been eliminated");
  let discovered = updatePlayerExploration(state);
  const transitioned = transition(state, action);
  const captures = transitioned.cities.filter(city => city.ownerId !== state.cities.find(previous => previous.id === city.id)?.ownerId);
  const next = settleCityGrowth({ ...transitioned, units: transitioned.units.map(unit => {
    const captured = captures.find(city => positionKey(city) === positionKey(unit) && city.ownerId === unit.ownerId);
    if (captured) return { ...unit, homeCityId: captured.id };
    return captures.some(city => city.id === unit.homeCityId && city.ownerId !== unit.ownerId) ? { ...unit, homeCityId: null } : unit;
  }) });
  if (action.type === "move") {
    const destination = getReachableTiles(state, action.unitId).find(tile => positionKey(tile) === positionKey(action.to));
    for (const position of destination?.path ?? []) {
      discovered = updatePlayerExploration({ ...next, exploration: discovered.exploration, units: next.units.map(unit => unit.id === action.unitId ? { ...unit, ...position } : unit) });
    }
  }
  let resolved = next;
  if (state.outcome) {
    const eliminatedPlayerIds = state.players.filter(player => state.outcome!.eliminatedPlayerIds.includes(player.id) || !next.cities.some(city => city.ownerId === player.id) && (state.cities.some(city => city.ownerId === player.id) || state.units.some(unit => unit.ownerId === player.id) && !next.units.some(unit => unit.ownerId === player.id))).map(player => player.id);
    const survivors = state.players.filter(player => !eliminatedPlayerIds.includes(player.id));
    resolved = { ...next, outcome: { eliminatedPlayerIds, winnerId: state.players.length > 1 && survivors.length === 1 ? survivors[0].id : null },
      units: next.units.filter(unit => !eliminatedPlayerIds.includes(unit.ownerId)),
      treaties: next.treaties?.filter(treaty => !eliminatedPlayerIds.includes(treaty.a) && !eliminatedPlayerIds.includes(treaty.b)),
      peaceOffers: next.peaceOffers?.filter(offer => !eliminatedPlayerIds.includes(offer.from) && !eliminatedPlayerIds.includes(offer.to)) };
  }
  if (!resolved.outcome?.winnerId && resolved.outcome?.eliminatedPlayerIds.includes(resolved.activePlayerId)) resolved = { ...transition(resolved, { type: "END_TURN", playerId: resolved.activePlayerId }), revision: resolved.revision };
  return updatePlayerExploration({ ...resolved, exploration: action.type === "move" ? discovered.exploration : resolved.exploration });
}

function transition(state: GameState, action: GameAction): GameState {
  if (
    action.type !== "move" &&
    action.type !== "ATTACK_UNIT" &&
    action.type !== "END_TURN" &&
    action.type !== "CHOOSE_CITY_REWARD" &&
    action.type !== "HARVEST_RESOURCE" &&
    action.type !== "BUILD_IMPROVEMENT" &&
    action.type !== "CLEAR_FOREST" &&
    action.type !== "BUILD_BRIDGE" &&
    action.type !== "UPGRADE_NAVAL" &&
    action.type !== "HARVEST_STARFISH" &&
    action.type !== "PROPOSE_PEACE" && action.type !== "ACCEPT_PEACE" && action.type !== "BREAK_PEACE" &&
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
  if (action.type === "HARVEST_RESOURCE" || action.type === "BUILD_IMPROVEMENT" || action.type === "CLEAR_FOREST" || action.type === "BUILD_BRIDGE") {
    const reason = action.type === "HARVEST_RESOURCE" ? getHarvestReason(state, action.playerId, action.to) : action.type === "BUILD_IMPROVEMENT" ? getImprovementReason(state, action.playerId, action.to, action.improvement) : action.type === "CLEAR_FOREST" ? getClearForestReason(state, action.playerId, action.to) : getBridgeBuildingReason(state, action.playerId, action.to);
    if (reason) throw new Error(reason);
    const cost = action.type === "HARVEST_RESOURCE" ? 2 : action.type === "BUILD_IMPROVEMENT" ? improvementDefinitions[action.improvement].cost : action.type === "BUILD_BRIDGE" ? 5 : -1;
    const cityId = getTileTerritory(state, action.to.x, action.to.y)?.cityId;
    return { ...state, revision: state.revision + 1,
      players: state.players.map(player => player.id === action.playerId ? { ...player, resources: { gold: player.resources.gold - cost } } : player),
      cities: action.type === "HARVEST_RESOURCE" ? state.cities.map(city => city.id === cityId ? { ...city, population: (city.population ?? 0) + 1 } : city) : state.cities,
      tiles: state.tiles.map(tile => {
        if (positionKey(tile) !== positionKey(action.to)) return tile;
        if (action.type === "BUILD_BRIDGE") return { ...tile, bridge: true, resource: undefined };
        if (action.type === "BUILD_IMPROVEMENT") return { ...tile, improvement: action.improvement, resource: undefined };
        return { ...tile, resource: undefined, ...(action.type === "CLEAR_FOREST" ? { terrain: "grass" as const } : {}) };
      }) };
  }
  if (action.type === "PROPOSE_PEACE" || action.type === "ACCEPT_PEACE" || action.type === "BREAK_PEACE") {
    if (action.otherPlayerId === action.playerId || state.outcome?.eliminatedPlayerIds.includes(action.otherPlayerId) || !state.players.some(player => player.id === action.otherPlayerId)) throw new Error("Invalid treaty player");
    const offers = state.peaceOffers ?? [], treaties = state.treaties ?? [];
    if (action.type === "PROPOSE_PEACE") {
      if (!hasTechnology(state, action.playerId, "strategy") || areAtPeace(state, action.playerId, action.otherPlayerId) || offers.some(offer => offer.from === action.playerId && offer.to === action.otherPlayerId)) throw new Error("Cannot propose peace");
      return { ...state, revision: state.revision + 1, peaceOffers: [...offers, { from: action.playerId, to: action.otherPlayerId }] };
    }
    if (action.type === "ACCEPT_PEACE") {
      if (!offers.some(offer => offer.from === action.otherPlayerId && offer.to === action.playerId)) throw new Error("No peace offer");
      return { ...state, revision: state.revision + 1, treaties: [...treaties, { a: action.playerId, b: action.otherPlayerId }], peaceOffers: offers.filter(offer => !(offer.from === action.otherPlayerId && offer.to === action.playerId || offer.from === action.playerId && offer.to === action.otherPlayerId)) };
    }
    if (!areAtPeace(state, action.playerId, action.otherPlayerId)) throw new Error("No peace treaty");
    return { ...state, revision: state.revision + 1, treaties: treaties.filter(treaty => !(treaty.a === action.playerId && treaty.b === action.otherPlayerId || treaty.b === action.playerId && treaty.a === action.otherPlayerId)),
      units: state.units.filter(unit => unit.ownerId !== action.playerId || getTileTerritory(state, unit.x, unit.y)?.playerId !== action.otherPlayerId).map(unit => unit.ownerId === action.playerId ? { ...unit, movement: 0, hasAttacked: true, actionPhase: "complete" } : unit) };
  }
  if (action.type === "UPGRADE_NAVAL") {
    const reason = getNavalUpgradeReason(state, action.playerId, action.unitId, action.unitType);
    if (reason) throw new Error(reason);
    const definition = getUnitDefinition(action.unitType)!;
    return { ...state, revision: state.revision + 1,
      players: state.players.map(player => player.id === action.playerId ? { ...player, resources: { gold: player.resources.gold - definition.goldCost! } } : player),
      units: state.units.map(unit => unit.id === action.unitId ? { ...unit, ...getUnitStats(action.unitType), maxHp: unit.maxHp, movement: 0, hasAttacked: true, actionPhase: "complete" } : unit) };
  }
  if (action.type === "HARVEST_STARFISH") {
    const unit = state.units.find(unit => unit.id === action.unitId);
    if (!unit || unit.ownerId !== action.playerId || !unit.embarked || !isUnitEnabled(state.rules, unit.unitType) || unit.actionPhase !== "ready" || unit.hasAttacked || getTile(state, unit.x, unit.y)?.resource !== "starfish" || !hasTechnology(state, action.playerId, "navigation")) throw new Error("Requires a ready naval unit on Starfish and Navigation");
    return { ...state, revision: state.revision + 1,
      players: state.players.map(player => player.id === action.playerId ? { ...player, resources: { gold: player.resources.gold + 8 } } : player),
      tiles: state.tiles.map(tile => positionKey(tile) === positionKey(unit) ? { ...tile, resource: undefined } : tile),
      units: state.units.map(candidate => candidate.id === unit.id ? { ...candidate, movement: 0, hasAttacked: true, actionPhase: "complete" } : candidate) };
  }
  if (action.type === "BUILD_PORT") {
    const reason = getPortBuildingReason(state, action.playerId, action.to);
    if (reason) throw new Error(reason);
    return {
      ...state, revision: state.revision + 1,
      players: state.players.map(player => player.id === action.playerId ? { ...player, resources: { gold: player.resources.gold - portRules.goldCost } } : player),
      tiles: state.tiles.map(tile => positionKey(tile) === positionKey(action.to) ? { ...tile, port: true, resource: undefined } : tile),
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
    const next: GameState = {
      ...state,
      revision: state.revision + 1,
      players: state.players.map(player => player.id === action.playerId ? {
        ...player,
        resources: { ...player.resources, gold: player.resources.gold - getTechnologyCost(state, action.playerId, technology.id) },
        technologies: [...player.technologies, technology.id],
      } : player),
    };
    return next;
  }
  if (action.type === "END_TURN") {
    const nextPlayer = Array.from({ length: state.players.length }, (_, offset) => state.players[(playerIndex + offset + 1) % state.players.length]).find(player => !state.outcome?.eliminatedPlayerIds.includes(player.id))!;
    return {
      ...state,
      revision: state.revision + 1,
      turnNumber: state.turnNumber + 1,
      activePlayerId: nextPlayer.id,
      players: state.players.map((player) =>
        player.id === nextPlayer.id
          ? { ...player, hasStartedTurn: true, resources: { gold: player.resources.gold + (player.hasStartedTurn === false ? 0 : calculateGoldPerTurn(state, player.id)) } }
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
    if (action.type === "CHOOSE_CITY_REWARD") {
      if (!city.rewardPending || !getCityRewards(city.townHallLevel).includes(action.reward)) throw new Error("Invalid city reward");
      updated.rewardPending = false;
      if (action.reward === "workshop") updated.workshop = true;
      if (action.reward === "walls") updated.walls = true;
      if (action.reward === "resources") resources.gold += 5;
      if (action.reward === "population") updated.population = (city.population ?? 0) + 3;
      if (action.reward === "borders") updated.expanded = true;
      if (action.reward === "park") updated.parks = (city.parks ?? 0) + 1;
      if (action.reward === "giant") {
        if (city.giantReward === "available" || !isUnitEnabled(state.rules, "giant")) throw new Error("Claim the existing Giant or enable Giants first");
        updated.giantReward = "available";
      }
      if (action.reward === "explorer") return exploreCity({ ...state, revision: state.revision + 1, cities: state.cities.map(candidate => candidate.id === city.id ? updated : candidate) }, city, action.playerId);
    }
    return { ...state, revision: state.revision + 1,
      players: state.players.map(player => player.id === action.playerId ? { ...player, resources } : player),
      cities: state.cities.map(candidate => candidate.id === city.id ? updated : candidate) };
  }
  const capture = (positions: Position[]) =>
    state.cities.map((city) =>
      positions.some((p) => p.x === city.x && p.y === city.y)
        ? areAtPeace(state, city.ownerId ?? "", action.playerId) ? city : { ...city, ownerId: action.playerId }
        : city,
    );
  if (!("unitId" in action)) throw new Error("Unknown unit action");
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
    return resolveAreaDamage(state, next, unit, getTile(state, result.advance?.x ?? unit.x, result.advance?.y ?? unit.y)!, getTile(state, state.units.find(candidate => candidate.id === action.targetId)!.x, state.units.find(candidate => candidate.id === action.targetId)!.y)!, "SPLASH");
  }
  const destination = getReachableTiles(state, unit.id).find(
    (tile) => tile.x === action.to.x && tile.y === action.to.y,
  );
  if (!destination) throw new Error("Unreachable destination");
  const moved = arriveUnit(state, unit, destination, destination.cost);
  const next: GameState = {
    ...state,
    revision: state.revision + 1,
    cities: capture([destination]),
    units: state.units.map(candidate => candidate.id === unit.id ? moved : candidate),
  };
  return resolveAreaDamage(state, next, moved, destination, destination, "STOMP");
}
