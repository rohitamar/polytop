import type { GameAction, PlayerView, Position } from "@reach/game-core";
export const ROOM_CAPACITY = 8;
export const PLAYER_COLORS = [
  "#c58036",
  "#397da8",
  "#518049",
  "#a55379",
  "#7561ad",
  "#bd5643",
  "#348780",
  "#8b713e",
] as const;
export const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

export type LobbyPlayer = { id: string; name: string; color: string };
export type LobbyRoom = {
  code: string;
  hostId: string;
  players: LobbyPlayer[];
};
export type LobbyClientMessage =
  | { type: "CREATE_ROOM"; name: string }
  | { type: "JOIN_ROOM"; name: string; code: string }
  | { type: "LEAVE_ROOM" }
  | { type: "START_MATCH" }
  | { type: "RESUME_MATCH"; code: string; token: string }
  | { type: "GAME_ACTION"; requestId: string; expectedRevision: number; action: GameIntent };
export type GameIntent = GameAction extends infer A ? A extends GameAction ? Omit<A, "playerId"> : never : never;

export const LOBBY_ERRORS = [
  "MALFORMED_MESSAGE",
  "ROOM_NOT_FOUND",
  "ROOM_FULL",
  "ALREADY_IN_ROOM",
  "MATCH_ERROR",
] as const;
export type LobbyServerMessage =
  | { type: "MATCH_SESSION"; code: string; token: string }
  | { type: "LOBBY_UPDATE"; playerId: string; room: LobbyRoom }
  | { type: "LEFT_ROOM" }
  | { type: "MATCH_STATE"; state: PlayerView; action: GameAction | null; path?: Position[] }
  | { type: "ACTION_REJECTED"; requestId: string; message: string }
  | { type: "MATCH_ENDED"; message: string }
  | {
      type: "LOBBY_ERROR";
      code: (typeof LOBBY_ERRORS)[number];
      message: string;
    };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: string[]) {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value)
  );
}

export function parseLobbyClientMessage(
  value: unknown,
): LobbyClientMessage | null {
  if (!record(value)) return null;
  if (value.type === "RESUME_MATCH" && exact(value, ["type", "code", "token"]) && typeof value.code === "string" && ROOM_CODE_PATTERN.test(value.code) && typeof value.token === "string" && /^[a-f0-9-]{36}$/.test(value.token)) return value as LobbyClientMessage;
  if (value.type === "LEAVE_ROOM" && exact(value, ["type"]))
    return { type: "LEAVE_ROOM" };
  if (value.type === "START_MATCH" && exact(value, ["type"])) return { type: "START_MATCH" };
  if (value.type === "GAME_ACTION" && exact(value, ["type", "requestId", "expectedRevision", "action"])) {
    if (typeof value.requestId !== "string" || !value.requestId.length || value.requestId.length > 100 || !Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0 || !record(value.action)) return null;
    const a = value.action;
    const position = (p: unknown) => record(p) && exact(p, ["x", "y"]) && Number.isSafeInteger(p.x) && Number.isSafeInteger(p.y);
    const id = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 100;
    const valid = a.type === "END_TURN" ? exact(a, ["type"]) :
      a.type === "UNLOCK_TECHNOLOGY" ? exact(a, ["type", "technologyId"]) && id(a.technologyId) :
      a.type === "RECRUIT_UNIT" ? exact(a, ["type", "cityId", "unitType"]) && id(a.cityId) && id(a.unitType) :
      (["BUILD_ROAD", "BUILD_PORT", "HARVEST_RESOURCE", "CLEAR_FOREST", "BUILD_BRIDGE"].includes(a.type as string)) ? exact(a, ["type", "to"]) && position(a.to) :
      a.type === "move" ? exact(a, ["type", "unitId", "to"]) && id(a.unitId) && position(a.to) :
      a.type === "ATTACK_UNIT" ? exact(a, ["type", "unitId", "targetId"]) && id(a.unitId) && id(a.targetId) :
      a.type === "CHOOSE_CITY_REWARD" ? exact(a, ["type", "cityId", "reward"]) && id(a.cityId) && id(a.reward) :
      a.type === "BUILD_IMPROVEMENT" ? exact(a, ["type", "to", "improvement"]) && position(a.to) && id(a.improvement) :
      a.type === "UPGRADE_NAVAL" ? exact(a, ["type", "unitId", "unitType"]) && id(a.unitId) && id(a.unitType) :
      a.type === "HARVEST_STARFISH" ? exact(a, ["type", "unitId"]) && id(a.unitId) :
      ["PROPOSE_PEACE", "ACCEPT_PEACE", "BREAK_PEACE"].includes(a.type as string) ? exact(a, ["type", "otherPlayerId"]) && id(a.otherPlayerId) :
      a.type === "CLAIM_GIANT" ? exact(a, ["type", "cityId"]) && id(a.cityId) :
      false;
    return valid ? value as LobbyClientMessage : null;
  }
  if (typeof value.name !== "string") return null;
  const name = value.name.trim();
  if (!name || name.length > 24 || /[\u0000-\u001f\u007f]/.test(name))
    return null;
  if (value.type === "CREATE_ROOM" && exact(value, ["type", "name"]))
    return { type: "CREATE_ROOM", name };
  if (
    value.type === "JOIN_ROOM" &&
    exact(value, ["type", "name", "code"]) &&
    typeof value.code === "string"
  ) {
    const code = value.code.trim().toUpperCase();
    if (ROOM_CODE_PATTERN.test(code)) return { type: "JOIN_ROOM", name, code };
  }
  return null;
}

export function parseLobbyServerMessage(
  value: unknown,
): LobbyServerMessage | null {
  if (!record(value)) return null;
  if (value.type === "MATCH_SESSION" && exact(value, ["type", "code", "token"]) && typeof value.code === "string" && ROOM_CODE_PATTERN.test(value.code) && typeof value.token === "string" && /^[a-f0-9-]{36}$/.test(value.token)) return value as LobbyServerMessage;
  if (value.type === "LEFT_ROOM" && exact(value, ["type"])) return { type: "LEFT_ROOM" };
  if (value.type === "MATCH_STATE" && record(value.state) && typeof value.state.perspectiveId === "string" && record(value.state.exploration) && Object.keys(value.state.exploration).length === 1 && value.state.perspectiveId in value.state.exploration && Number.isSafeInteger(value.state.revision) && Array.isArray(value.state.players) && Array.isArray(value.state.units) && Array.isArray(value.state.tiles) && Array.isArray(value.state.cities)) return value as LobbyServerMessage;
  if ((value.type === "ACTION_REJECTED" && typeof value.requestId === "string" || value.type === "MATCH_ENDED") && typeof value.message === "string") return value as LobbyServerMessage;
  if (
    value.type === "LOBBY_ERROR" &&
    exact(value, ["type", "code", "message"]) &&
    LOBBY_ERRORS.some((code) => code === value.code) &&
    typeof value.message === "string"
  )
    return value as LobbyServerMessage;
  if (
    value.type !== "LOBBY_UPDATE" ||
    !exact(value, ["type", "playerId", "room"]) ||
    typeof value.playerId !== "string" ||
    !record(value.room)
  )
    return null;
  const room = value.room;
  if (
    !exact(room, ["code", "hostId", "players"]) ||
    typeof room.code !== "string" ||
    !ROOM_CODE_PATTERN.test(room.code) ||
    typeof room.hostId !== "string" ||
    !Array.isArray(room.players) ||
    room.players.length < 1 ||
    room.players.length > ROOM_CAPACITY
  )
    return null;
  if (
    !room.players.every(
      (player) =>
        record(player) &&
        exact(player, ["id", "name", "color"]) &&
        typeof player.id === "string" &&
        player.id.length > 0 &&
        typeof player.name === "string" &&
        parseLobbyClientMessage({ type: "CREATE_ROOM", name: player.name })
          ?.type === "CREATE_ROOM" &&
        PLAYER_COLORS.some((color) => color === player.color),
    )
  )
    return null;
  const players = room.players as LobbyPlayer[];
  if (
    new Set(players.map((player) => player.id)).size !== players.length ||
    new Set(players.map((player) => player.color)).size !== players.length ||
    !players.some((player) => player.id === room.hostId) ||
    !players.some((player) => player.id === value.playerId)
  )
    return null;
  return value as LobbyServerMessage;
}
