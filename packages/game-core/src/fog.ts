import { getTerritory, gridDistance, positionKey, type City, type GameAction, type GameState, type Position, type Tile, type TileTerritory, type Unit } from "./index";
import { getUnitDefinition } from "./units";
import { hasTechnology } from "./technologies";

export enum TileVisibility {
  Unexplored = "unexplored",
  Explored = "explored",
  Visible = "visible",
}

export type PlayerExploration = {
  visibleTiles: string[];
  exploredTiles: string[];
  tiles: Record<string, Tile>;
  cities: Record<string, City>;
  territory: Record<string, TileTerritory>;
  units?: Record<string, Unit>;
};

export type PlayerView = GameState & { perspectiveId: string };
export const visionRules = { unitVisionRadius: 1, cityVisionRadius: 2 } as const;

export function tilesInRange(state: Pick<GameState, "width" | "height">, center: Position, radius: number): Position[] {
  const result: Position[] = [];
  for (let y = Math.max(0, center.y - radius); y <= Math.min(state.height - 1, center.y + radius); y++) {
    for (let x = Math.max(0, center.x - radius); x <= Math.min(state.width - 1, center.x + radius); x++) {
      if (gridDistance(center, { x, y }) <= radius) result.push({ x, y });
    }
  }
  return result;
}

export function computeVisibleTiles(state: GameState, playerId: string): Set<string> {
  if (state.perspectiveId) return new Set(state.exploration?.[playerId]?.visibleTiles ?? []);
  const visible = new Set<string>();
  const reveal = (center: Position, radius: number) => {
    for (const tile of tilesInRange(state, center, radius)) visible.add(positionKey(tile));
  };
  for (const unit of state.units) if (unit.ownerId === playerId) reveal(unit, getUnitDefinition(unit.unitType)?.visionRadius ?? visionRules.unitVisionRadius);
  for (const city of state.cities) if (city.ownerId === playerId) reveal(city, visionRules.cityVisionRadius + Number(!!city.expanded));
  for (const claim of getTerritory(state)) if (claim.playerId === playerId) visible.add(positionKey(claim));
  return visible;
}

export function updatePlayerExploration(state: GameState): GameState {
  if (state.perspectiveId) throw new Error("Cannot update exploration from a player view");
  const exploration: Record<string, PlayerExploration> = {};
  const tileIndex = new Map(state.tiles.map(tile => [positionKey(tile), tile]));
  const cityIndex = new Map(state.cities.map(city => [positionKey(city), city]));
  const unitIndex = new Map(state.units.map(unit => [unit.id, unit]));
  const territory = new Map(getTerritory(state).map(claim => [positionKey(claim), claim]));
  for (const player of state.players) {
    const previous = state.exploration?.[player.id];
    const visible = computeVisibleTiles(state, player.id);
    const tiles = { ...previous?.tiles };
    const cities = { ...previous?.cities };
    const claims = { ...previous?.territory };
    const units = { ...previous?.units };
    for (const [id, sighting] of Object.entries(units)) {
      const current = unitIndex.get(id);
      if (!current || current.ownerId === player.id || positionKey(current) !== positionKey(sighting)) delete units[id];
    }
    for (const unit of state.units) {
      if (unit.ownerId !== player.id && visible.has(positionKey(unit))) units[unit.id] = { ...unit, homeCityId: null, movement: 0, hasAttacked: false, actionPhase: "ready" };
    }
    for (const key of visible) {
      const tile = tileIndex.get(key);
      if (tile) {
        const hidden = tile.resource === "wheat" && !hasTechnology(state, player.id, "organization") || tile.resource === "mine" && !hasTechnology(state, player.id, "climbing") || tile.resource === "starfish" && !hasTechnology(state, player.id, "fishing");
        tiles[key] = { ...tile, ...(hidden ? { resource: undefined } : {}) };
      }
      const city = cityIndex.get(key);
      if (city) cities[key] = { ...city };
      else delete cities[key];
      const claim = territory.get(key);
      if (claim) claims[key] = { ...claim };
    }
    exploration[player.id] = {
      visibleTiles: [...visible],
      exploredTiles: [...new Set([...(previous?.exploredTiles ?? []), ...visible])],
      tiles, cities, territory: claims, units,
    };
  }
  return { ...state, exploration };
}

export function getTileVisibility(state: GameState, playerId: string, tile: Position | string): TileVisibility {
  const key = typeof tile === "string" ? tile : positionKey(tile);
  const memory = state.exploration?.[playerId];
  if (computeVisibleTiles(state, playerId).has(key)) return TileVisibility.Visible;
  return memory?.exploredTiles.includes(key) ? TileVisibility.Explored : TileVisibility.Unexplored;
}

export const isTileVisible = (state: GameState, playerId: string, tile: Position | string) => computeVisibleTiles(state, playerId).has(typeof tile === "string" ? tile : positionKey(tile));
export const isTileExplored = (state: GameState, playerId: string, tile: Position | string) => getTileVisibility(state, playerId, tile) !== TileVisibility.Unexplored;

export function getPlayerView(state: GameState, playerId: string): PlayerView {
  if (state.perspectiveId) {
    if (state.perspectiveId !== playerId) throw new Error("Player view belongs to another player");
    return state as PlayerView;
  }
  if (!state.players.some(player => player.id === playerId)) throw new Error("Unknown player");
  const refreshed = updatePlayerExploration(state);
  const memory = refreshed.exploration![playerId];
  const visible = new Set(memory.visibleTiles);
  return {
    outcome: state.outcome ? structuredClone(state.outcome) : undefined,
    rules: state.rules ? structuredClone(state.rules) : undefined,
    treaties: structuredClone(state.treaties ?? []),
    peaceOffers: (state.peaceOffers ?? []).filter(offer => offer.from === playerId || offer.to === playerId).map(offer => ({ ...offer })),
    seed: "", width: state.width, height: state.height, revision: state.revision,
    activePlayerId: state.activePlayerId, turnNumber: state.turnNumber, perspectiveId: playerId,
    players: state.players.map(player => player.id === playerId ? { ...player, resources: { ...player.resources }, technologies: [...player.technologies] } : { id: player.id, name: player.name, resources: { gold: 0 }, technologies: [] }),
    tiles: Object.values(memory.tiles).map(tile => ({ ...tile })).sort((a, b) => a.y - b.y || a.x - b.x),
    cities: Object.values(memory.cities).map(city => ({ ...city })),
    units: state.units.filter(unit => unit.ownerId === playerId || visible.has(positionKey(unit))).map(unit => unit.ownerId === playerId ? { ...unit } : { ...unit, homeCityId: null, movement: 0, hasAttacked: false, actionPhase: "ready" }),
    rememberedUnits: Object.values(memory.units ?? {}).filter(unit => !visible.has(positionKey(unit))).map(unit => ({ ...unit })),
    exploration: { [playerId]: structuredClone(memory) },
    rememberedTerritory: Object.values(memory.territory).map(claim => ({ ...claim })),
  };
}

export function getPlayerAction(playerId: string, action: GameAction): GameAction | null {
  if (action.playerId === playerId || action.type === "END_TURN") return action;
  return null;
}
