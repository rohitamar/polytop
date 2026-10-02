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
  | { type: "LEAVE_ROOM" };
export const LOBBY_ERRORS = [
  "MALFORMED_MESSAGE",
  "ROOM_NOT_FOUND",
  "ROOM_FULL",
  "ALREADY_IN_ROOM",
] as const;
export type LobbyServerMessage =
  | { type: "LOBBY_UPDATE"; playerId: string; room: LobbyRoom }
  | { type: "LEFT_ROOM" }
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
  if (value.type === "LEAVE_ROOM" && exact(value, ["type"]))
    return { type: "LEAVE_ROOM" };
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
  if (value.type === "LEFT_ROOM" && exact(value, ["type"]))
    return { type: "LEFT_ROOM" };
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
