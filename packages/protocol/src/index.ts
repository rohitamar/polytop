import type { GameAction, GameState } from "@reach/game-core";
export * from "./lobby";

export type ClientMessage = {
  type: "action";
  requestId: string;
  expectedRevision: number;
  action: GameAction;
};
export type ServerMessage =
  | { type: "state"; state: GameState }
  | { type: "rejected"; requestId: string; reason: string };
