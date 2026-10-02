export type Terrain = "grass" | "forest" | "mountain" | "water";
export type Position = { x: number; y: number };
export type Tile = Position & { terrain: Terrain };
export type Player = { id: string; name: string };
export type Unit = Position & {
  id: string;
  ownerId: string;
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
};
export type GameAction =
  | {
      type: "move";
      playerId: string;
      unitId: string;
      to: Position;
    }
  | { type: "ATTACK_UNIT"; playerId: string; unitId: string; targetId: string }
  | { type: "END_TURN"; playerId: string };
export type ReachableTile = Position & { cost: number; path: Position[] };

export const warriorStats = { maxHp: 10, attack: 2, defense: 2, range: 1 };

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
  const width = 20;
  const height = 20;
  const random = randomFromSeed(seed);
  const tiles: Tile[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const roll = random();
      const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
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
      if (Math.abs(x - 7) + Math.abs(y - 3) <= 1) terrain = "grass";
      tiles.push({ x, y, terrain });
    }
  }
  return {
    seed,
    width,
    height,
    revision: 0,
    activePlayerId: "player-1",
    players: [
      { id: "player-1", name: "Sunward" },
      { id: "player-2", name: "Tideward" },
    ],
    turnNumber: 1,
    tiles,
    units: [
      {
        id: "warrior-1",
        ownerId: "player-1",
        x: 4,
        y: 5,
        movement: 2,
        maxMovement: 2,
        ...warriorStats,
        hp: warriorStats.maxHp,
        hasAttacked: false,
      },
      {
        id: "warrior-2",
        ownerId: "player-2",
        x: 7,
        y: 3,
        movement: 0,
        maxMovement: 2,
        ...warriorStats,
        hp: warriorStats.maxHp,
        hasAttacked: false,
      },
    ],
  };
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
    action.type !== "END_TURN"
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
      units: state.units.map((unit) =>
        unit.ownerId === nextPlayer.id
          ? { ...unit, movement: unit.maxMovement, hasAttacked: false }
          : unit,
      ),
    };
  }
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
