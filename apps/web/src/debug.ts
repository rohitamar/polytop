import type {
  GameState,
  Position,
  Tile,
  Unit,
  ReachableTile,
} from "@reach/game-core";

export interface GameDebug {
  getState(): GameState;
  getUnits(): Unit[];
  getTile(x: number, y: number): Tile | undefined;
  setSeed(seed: string): void;
  getReachableTiles(): ReachableTile[];
  getSelectedUnitId(): string | null;
  getTileScreenPosition(x: number, y: number): Position;
  getUnitScreenPosition(): Position;
  isAnimating(): boolean;
  getVisualPosition(): Position & { elevation: number };
  getMarkerCount(): number;
  getHoveredTile(): string;
}

declare global {
  interface Window {
    __GAME_DEBUG__?: GameDebug;
  }
}
