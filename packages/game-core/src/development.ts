import { getTile, getTileTerritory, positionKey, getTerritory, isTileVisible, hasTechnology, type City, type GameState, type Position, type Terrain, type Tile } from "./index";
import type { TechnologyId } from "./technologies";

export type Improvement = "farm" | "lumber-hut" | "mine" | "sawmill" | "forge";
export type CityReward = "workshop" | "explorer" | "walls" | "resources" | "borders" | "population" | "park" | "giant";
export const improvementDefinitions: Record<Improvement, { name: string; cost: number; technology: TechnologyId; terrain: Terrain; resource?: Tile["resource"]; population: number; adjacent?: Improvement; unique?: boolean }> = {
  farm: { name: "Farm", cost: 5, technology: "farming", terrain: "grass", resource: "wheat", population: 2 },
  "lumber-hut": { name: "Lumber Hut", cost: 3, technology: "forestry", terrain: "forest", population: 1 },
  mine: { name: "Mine", cost: 5, technology: "mining", terrain: "mountain", resource: "mine", population: 2 },
  sawmill: { name: "Sawmill", cost: 5, technology: "mathematics", terrain: "grass", population: 1, adjacent: "lumber-hut", unique: true },
  forge: { name: "Forge", cost: 5, technology: "smithery", terrain: "grass", population: 2, adjacent: "mine", unique: true },
};
export const rewardNames: Record<CityReward, string> = { workshop: "Workshop · +1 Gold/turn", explorer: "Explorer · reveal nearby land", walls: "City Walls · stronger city defense", resources: "Resources · +5 Gold", borders: "Border Growth · expand territory", population: "Population Growth · +3 population", park: "Park · +1 Gold/turn", giant: "Giant · super-unit reward" };
export const getCityRewards = (level: number): CityReward[] => level === 2 ? ["workshop", "explorer"] : level === 3 ? ["walls", "resources"] : level === 4 ? ["borders", "population"] : level >= 5 ? ["park", "giant"] : [];
export const populationSpent = (level: number) => level * (level + 1) / 2 - 1;
export const adjacentTiles = (a: Position, b: Position) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) === 1;
export const isWater = (terrain: Terrain) => terrain === "water" || terrain === "ocean";

export function getTileDevelopmentReason(state: GameState, playerId: string, position: Position): string | null {
  if (state.activePlayerId !== playerId || !state.players.some(player => player.id === playerId)) return "Not your turn";
  if (!Number.isSafeInteger(position.x) || !Number.isSafeInteger(position.y) || !getTile(state, position.x, position.y)) return "Invalid tile";
  if (!isTileVisible(state, playerId, position)) return "Explore this tile first";
  const claim = getTileTerritory(state, position.x, position.y);
  if (claim?.playerId !== playerId) return "Requires owned territory";
  if (state.cities.some(city => positionKey(city) === positionKey(position))) return "City center cannot be developed";
  if (state.units.some(unit => positionKey(unit) === positionKey(position) && unit.ownerId !== playerId)) return "Enemy unit occupies tile";
  const city = state.cities.find(city => city.id === claim.cityId)!;
  if (state.units.some(unit => positionKey(unit) === positionKey(city) && unit.ownerId !== playerId)) return "City is under siege";
  return null;
}

export function getHarvestReason(state: GameState, playerId: string, position: Position): string | null {
  const reason = getTileDevelopmentReason(state, playerId, position);
  if (reason) return reason;
  const tile = getTile(state, position.x, position.y)!;
  const technology = tile.resource === "orchard" ? "organization" : tile.resource === "animal" ? "hunting" : tile.resource === "fishery" ? "fishing" : null;
  if (!technology || tile.improvement || tile.port || tile.bridge) return "No harvestable resource";
  if (!hasTechnology(state, playerId, technology)) return `Requires ${technology === "organization" ? "Organization" : technology === "hunting" ? "Hunting" : "Fishing"}`;
  return state.players.find(player => player.id === playerId)!.resources.gold < 2 ? "Not enough Gold" : null;
}

export function getImprovementPopulation(state: GameState, tile: Tile): number {
  if (tile.port) return 1;
  if (!tile.improvement) return 0;
  const definition = improvementDefinitions[tile.improvement];
  if (!definition.adjacent) return definition.population;
  const owner = getTileTerritory(state, tile.x, tile.y)?.playerId;
  return definition.population * state.tiles.filter(other => other.improvement === definition.adjacent && adjacentTiles(tile, other) && getTileTerritory(state, other.x, other.y)?.playerId === owner).length;
}

export function getImprovementReason(state: GameState, playerId: string, position: Position, type: string): string | null {
  const reason = getTileDevelopmentReason(state, playerId, position);
  if (reason) return reason;
  if (!Object.hasOwn(improvementDefinitions, type)) return "Unknown improvement";
  const definition = improvementDefinitions[type as Improvement];
  const tile = getTile(state, position.x, position.y)!;
  if (!hasTechnology(state, playerId, definition.technology)) return `Requires ${definition.technology[0].toUpperCase()}${definition.technology.slice(1)}`;
  if (tile.improvement || tile.port || tile.bridge) return "Tile already developed";
  if (tile.terrain !== definition.terrain || definition.resource && tile.resource !== definition.resource) return "Requires suitable terrain and resource";
  if (tile.resource && tile.resource !== definition.resource) return "Harvest or clear the resource first";
  const cityId = getTileTerritory(state, tile.x, tile.y)!.cityId;
  if (definition.unique && state.tiles.some(other => other.improvement === type && getTileTerritory(state, other.x, other.y)?.cityId === cityId)) return "Only one per city";
  if (definition.adjacent && !state.tiles.some(other => other.improvement === definition.adjacent && adjacentTiles(tile, other) && getTileTerritory(state, other.x, other.y)?.playerId === playerId)) return "Requires an adjacent friendly improvement";
  return state.players.find(player => player.id === playerId)!.resources.gold < definition.cost ? "Not enough Gold" : null;
}

export function getClearForestReason(state: GameState, playerId: string, position: Position): string | null {
  const reason = getTileDevelopmentReason(state, playerId, position);
  if (reason) return reason;
  if (!hasTechnology(state, playerId, "forestry")) return "Requires Forestry";
  const tile = getTile(state, position.x, position.y)!;
  return tile.terrain !== "forest" || tile.improvement ? "Requires an undeveloped forest" : null;
}

export function getBridgeBuildingReason(state: GameState, playerId: string, position: Position): string | null {
  if (state.activePlayerId !== playerId) return "Not your turn";
  if (!hasTechnology(state, playerId, "roads")) return "Requires Roads";
  const tile = getTile(state, position.x, position.y);
  if (!tile || !isTileVisible(state, playerId, position)) return "Explore this tile first";
  if (tile.terrain !== "water" || tile.port || tile.bridge) return "Requires undeveloped shallow water";
  if (getTileTerritory(state, tile.x, tile.y)?.playerId && getTileTerritory(state, tile.x, tile.y)?.playerId !== playerId) return "Enemy-controlled territory";
  if (![[1, 0], [0, 1]].some(([dx, dy]) => [1, -1].every(sign => {
    const bank = getTile(state, tile.x + dx * sign, tile.y + dy * sign);
    return bank && !isWater(bank.terrain) && bank.terrain !== "mountain";
  }))) return "Requires opposite land banks";
  return state.players.find(player => player.id === playerId)!.resources.gold < 5 ? "Not enough Gold" : null;
}

export function getConnectedCities(state: GameState, playerId: string): string[] {
  const cities = state.cities.filter(city => city.ownerId === playerId);
  const capital = cities.find(city => city.capitalOf === playerId);
  if (!capital) return [];
  const cityKeys = new Map(cities.map(city => [positionKey(city), city.id]));
  const valid = (tile: Tile) => {
    const owner = getTileTerritory(state, tile.x, tile.y)?.playerId;
    return (!owner || owner === playerId) && !state.units.some(unit => unit.ownerId !== playerId && positionKey(unit) === positionKey(tile)) && (tile.road || tile.bridge || tile.port || cityKeys.has(positionKey(tile)));
  };
  const visited = new Set([positionKey(capital)]), queue: Position[] = [capital];
  while (queue.length) {
    const current = queue.shift()!;
    for (const tile of state.tiles) {
      if (visited.has(positionKey(tile)) || !valid(tile)) continue;
      const near = adjacentTiles(current, tile);
      const currentTile = getTile(state, current.x, current.y)!;
      const seaLink = currentTile.port && tile.port && seaDistance(state, current, tile, playerId) <= 4;
      if (near || seaLink) { visited.add(positionKey(tile)); queue.push(tile); }
    }
  }
  return cities.filter(city => city.id !== capital.id && visited.has(positionKey(city))).map(city => city.id);
}

function seaDistance(state: GameState, start: Position, target: Position, playerId: string): number {
  const visited = new Set([positionKey(start)]), queue = [{ ...start, distance: 0 }];
  while (queue.length) {
    const current = queue.shift()!;
    if (positionKey(current) === positionKey(target)) return current.distance;
    if (current.distance >= 4) continue;
    for (const tile of state.tiles) if (adjacentTiles(current, tile) && isWater(tile.terrain) && !visited.has(positionKey(tile)) && (!getTileTerritory(state, tile.x, tile.y)?.playerId || getTileTerritory(state, tile.x, tile.y)?.playerId === playerId)) {
      visited.add(positionKey(tile)); queue.push({ ...tile, distance: current.distance + 1 });
    }
  }
  return Infinity;
}

export function getCityGrowth(state: GameState, city: City) {
  const claims = new Map(getTerritory(state).map(claim => [positionKey(claim), claim.cityId]));
  const developed = state.tiles.filter(tile => claims.get(positionKey(tile)) === city.id).reduce((sum, tile) => sum + getImprovementPopulation(state, tile), 0);
  const connected = city.ownerId ? getConnectedCities(state, city.ownerId) : [];
  const connections = city.capitalOf === city.ownerId ? connected.length : Number(connected.includes(city.id));
  const total = (city.population ?? populationSpent(city.townHallLevel)) + developed + connections;
  return { total, current: total - populationSpent(city.townHallLevel), needed: city.townHallLevel + 1, connected: connections > 0 };
}

export function settleCityGrowth(state: GameState): GameState {
  return { ...state, cities: state.cities.map(city => city.ownerId && !city.rewardPending && getCityGrowth(state, city).current >= city.townHallLevel + 1 ? { ...city, townHallLevel: city.townHallLevel + 1, rewardPending: true } : city) };
}
