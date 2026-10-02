export type Terrain = "grass" | "forest" | "mountain" | "water";
export type Position = { x: number; y: number };
export type Tile = Position & { terrain: Terrain };
export type Unit = Position & { id: string; ownerId: string; movement: number };
export type GameState = {
  seed: string;
  width: number;
  height: number;
  revision: number;
  activePlayerId: string;
  tiles: Tile[];
  units: Unit[];
};
export type GameAction = {
  type: "move";
  playerId: string;
  unitId: string;
  to: Position;
};
export type ReachableTile = Position & { cost: number; path: Position[] };

export const movementCost: Record<Terrain, number> = {
  grass: 1,
  forest: 2,
  mountain: Infinity,
  water: Infinity,
};
export const positionKey = ({ x, y }: Position) => `${x},${y}`;
export const getTile = (state: GameState, x: number, y: number) =>
  state.tiles.find((tile) => tile.x === x && tile.y === y);

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

export function createGame(seed = "fern-104"): GameState {
  const random = randomFromSeed(seed);
  const tiles: Tile[] = [];
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) {
      const roll = random();
      const edge = x === 0 || y === 0 || x === 9 || y === 9;
      let terrain: Terrain =
        edge && roll < 0.76
          ? "water"
          : roll < 0.16
            ? "water"
            : roll < 0.31
              ? "mountain"
              : roll < 0.57
                ? "forest"
                : "grass";
      if (Math.abs(x - 4) + Math.abs(y - 5) <= 2) terrain = "grass";
      if (x === 4 && y === 4) terrain = "forest";
      tiles.push({ x, y, terrain });
    }
  }
  return {
    seed,
    width: 10,
    height: 10,
    revision: 0,
    activePlayerId: "player-1",
    tiles,
    units: [{ id: "warrior-1", ownerId: "player-1", x: 4, y: 5, movement: 2 }],
  };
}

export function getReachableTiles(
  state: GameState,
  unitId: string,
): ReachableTile[] {
  const unit = state.units.find((candidate) => candidate.id === unitId);
  if (!unit) return [];
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

export function applyAction(state: GameState, action: GameAction): GameState {
  if (action.type !== "move") throw new Error("Unknown action");
  const unit = state.units.find((candidate) => candidate.id === action.unitId);
  if (!unit) throw new Error("Unknown unit");
  if (
    action.playerId !== state.activePlayerId ||
    unit.ownerId !== action.playerId
  )
    throw new Error("Not your unit or turn");
  const destination = getReachableTiles(state, unit.id).find(
    (tile) => tile.x === action.to.x && tile.y === action.to.y,
  );
  if (!destination) throw new Error("Unreachable destination");
  return {
    ...state,
    revision: state.revision + 1,
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
