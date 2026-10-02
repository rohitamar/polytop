import type {
  GameState,
  Position,
  Tile,
  Unit,
  ReachableTile,
  Player,
} from "@reach/game-core";

export interface GameDebug {
  getProfile(): { frames: { cpu: number; interval: number; draws: number; active: number }[]; picks: number[]; builds: number; updates: number; meshes: number; materials: number; loops: number; reactRenders: number };
  resetProfile(): void;
  getState(): GameState;
  getUnits(): Unit[];
  getActivePlayer(): Player;
  getTurnNumber(): number;
  getTile(x: number, y: number): Tile | undefined;
  setSeed(seed: string): void;
  getReachableTiles(unitId?: string): ReachableTile[];
  getSelectedUnitId(): string | null;
  getTileScreenPosition(x: number, y: number): Position;
  getUnitScreenPosition(unitId?: string): Position;
  isAnimating(): boolean;
  getVisualPosition(unitId?: string): Position & { elevation: number };
  getMarkerCount(): number;
  getHoveredTile(): string;
}

declare global {
  interface Window {
    __GAME_DEBUG__?: GameDebug;
  }
}
