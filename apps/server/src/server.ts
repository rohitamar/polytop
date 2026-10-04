import { applyAction, createGame, getReachableTiles, getPlayerView, getPlayerAction, updatePlayerExploration, type GameState } from "@reach/game-core";
import { randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  PLAYER_COLORS,
  ROOM_CAPACITY,
  parseLobbyClientMessage,
  type LobbyPlayer,
  type LobbyRoom,
  type LobbyServerMessage,
} from "@reach/protocol";

type Member = { socket: WebSocket; player: LobbyPlayer; token: string; expiry?: ReturnType<typeof setTimeout>; acceptedRequests?: Set<string> };
type Room = { code: string; members: Member[]; state?: GameState };

export function createLobbyServer(options: { seed?: string; demo?: boolean } = {}) {
  let closing = false;
  const rooms = new Map<string, Room>();
  const memberships = new Map<WebSocket, Room>();
  const http = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ service: "reach-lobby" }));
  });
  const websocket = new WebSocketServer({
    server: http,
    path: "/lobby",
    maxPayload: 4096,
  });
  const alive = new Set<WebSocket>();
  const send = (socket: WebSocket, message: LobbyServerMessage) => {
    if (socket.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify(message));
  };
  const broadcast = (room: Room) => {
    const snapshot: LobbyRoom = {
      code: room.code,
      hostId: room.members[0].player.id,
      players: room.members.map((member) => member.player),
    };
    for (const member of room.members)
      send(member.socket, {
        type: "LOBBY_UPDATE",
        playerId: member.player.id,
        room: snapshot,
      });
  };
  const leave = (socket: WebSocket, intentional = false, room = memberships.get(socket)) => {
    if (!room || closing) return;
    if (room.state) {
      if (!intentional) {
        memberships.delete(socket);
        const member = room.members.find(member => member.socket === socket);
        if (member) {
          member.expiry = setTimeout(() => leave(socket, true, room), 60000);
          member.expiry.unref();
        }
        return;
      }
      for (const member of room.members) {
        clearTimeout(member.expiry);
        memberships.delete(member.socket);
        send(member.socket, { type: "MATCH_ENDED", message: "A player disconnected. The match has ended." });
      }
      rooms.delete(room.code);
      room.state = undefined;
      room.members = [];
      return;
    }
    memberships.delete(socket);
    room.members = room.members.filter((member) => member.socket !== socket);
    if (room.members.length) broadcast(room);
    else rooms.delete(room.code);
  };
  websocket.on("connection", (socket) => {
    alive.add(socket);
    socket.on("pong", () => alive.add(socket));
    socket.on("error", () => socket.terminate());
    socket.on("close", () => {
      alive.delete(socket);
      leave(socket);
    });
    socket.on("message", (data, binary) => {
      let message = null;
      try {
        if (!binary)
          message = parseLobbyClientMessage(JSON.parse(data.toString()));
      } catch {}
      if (!message) {
        send(socket, {
          type: "LOBBY_ERROR",
          code: "MALFORMED_MESSAGE",
          message:
            "Use a valid lobby request, a name of 1–24 characters, and a six-character room code.",
        });
        return;
      }
      if (message.type === "RESUME_MATCH") {
        const room = rooms.get(message.code);
        const member = room?.members.find(member => member.token === message.token);
        if (!room?.state || !member || memberships.has(socket)) {
          send(socket, { type: "LOBBY_ERROR", code: "MATCH_ERROR", message: "Match session unavailable." });
          return;
        }
        clearTimeout(member.expiry);
        const previous = member.socket;
        memberships.delete(previous);
        member.socket = socket;
        memberships.set(socket, room);
        if (previous !== socket) {
          send(previous, { type: "MATCH_ENDED", message: "This player session resumed in another connection." });
          previous.close();
        }
        broadcast(room);
        send(socket, { type: "MATCH_STATE", state: getPlayerView(room.state, member.player.id), action: null });
        return;
      }
      if (message.type === "LEAVE_ROOM") {
        leave(socket, true);
        send(socket, { type: "LEFT_ROOM" });
        return;
      }
      if (message.type === "START_MATCH" || message.type === "GAME_ACTION") {
        const room = memberships.get(socket);
        const member = room?.members.find(member => member.socket === socket);
        try {
          if (!room || !member) throw new Error("Join a room first");
          if (message.type === "START_MATCH") {
            if (room.members[0] !== member) throw new Error("Only the host can start the match");
            if (room.state) throw new Error("Match already started");
            if (room.members.length < 2) throw new Error("At least two players are required");
            const initial = createGame(options.seed ?? randomUUID(), room.members.length, options.demo && room.members.length === 2 ? { scenario: "demo" } : {});
            const ids = new Map(initial.players.map((player, i) => [player.id, room.members[i].player.id]));
            room.state = updatePlayerExploration({ ...initial, exploration: undefined, activePlayerId: member.player.id,
              players: initial.players.map((player, i) => ({ ...player, id: room.members[i].player.id, name: room.members[i].player.name })),
              units: initial.units.map(unit => ({ ...unit, ownerId: ids.get(unit.ownerId)! })),
              cities: initial.cities.map(city => ({ ...city, ownerId: city.ownerId ? ids.get(city.ownerId)! : null, capitalOf: city.capitalOf ? ids.get(city.capitalOf) : undefined })) });
            for (const participant of room.members) send(participant.socket, { type: "MATCH_STATE", state: getPlayerView(room.state, participant.player.id), action: null });
          } else {
            if (!room.state) throw new Error("Match has not started");
            if (member.acceptedRequests?.has(message.requestId)) throw new Error("Request already accepted");
            if (message.expectedRevision !== room.state.revision) throw new Error("State changed. Try again.");
            const action = { ...message.action, playerId: member.player.id };
            if ("unitId" in action && !room.state.units.some(unit => unit.id === action.unitId && unit.ownerId === member.player.id)) throw new Error("Not your unit or turn");
            const path = action.type === "move" ? getReachableTiles(room.state, action.unitId).find(tile => tile.x === action.to.x && tile.y === action.to.y)?.path : undefined;
            room.state = applyAction(room.state, action);
            member.acceptedRequests ??= new Set();
            member.acceptedRequests.add(message.requestId);
            for (const participant of room.members) send(participant.socket, { type: "MATCH_STATE", state: getPlayerView(room.state, participant.player.id), action: getPlayerAction(participant.player.id, action), ...(participant === member && path ? { path } : {}) });
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : "Action rejected";
          send(socket, message.type === "GAME_ACTION" ? { type: "ACTION_REJECTED", requestId: message.requestId, message: reason } : { type: "LOBBY_ERROR", code: "MATCH_ERROR", message: reason });
        }
        return;
      }
      if (memberships.has(socket)) {
        send(socket, {
          type: "LOBBY_ERROR",
          code: "ALREADY_IN_ROOM",
          message: "Leave your current room first.",
        });
        return;
      }
      let room: Room;
      if (message.type === "CREATE_ROOM") {
        const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let code: string;
        do {
          code = Array.from(
            { length: 6 },
            () => alphabet[randomInt(alphabet.length)],
          ).join("");
        } while (rooms.has(code));
        room = { code, members: [] };
        rooms.set(code, room);
      } else {
        const existing = rooms.get(message.code);
        if (!existing) {
          send(socket, {
            type: "LOBBY_ERROR",
            code: "ROOM_NOT_FOUND",
            message: "That room does not exist.",
          });
          return;
        }
        if (existing.state) {
          send(socket, { type: "LOBBY_ERROR", code: "MATCH_ERROR", message: "This match has already started." });
          return;
        }
        if (existing.members.length >= ROOM_CAPACITY) {
          send(socket, {
            type: "LOBBY_ERROR",
            code: "ROOM_FULL",
            message: "That room already has eight players.",
          });
          return;
        }
        room = existing;
      }
      const color = PLAYER_COLORS.find(
        (color) =>
          !room.members.some((member) => member.player.color === color),
      )!;
      room.members.push({
        socket,
        token: randomUUID(),
        player: { id: randomUUID(), name: message.name, color },
      });
      memberships.set(socket, room);
      send(socket, { type: "MATCH_SESSION", code: room.code, token: room.members.at(-1)!.token });
      broadcast(room);
    });
  });
  const heartbeat = setInterval(() => {
    for (const socket of websocket.clients) {
      if (!alive.delete(socket)) socket.terminate();
      else socket.ping();
    }
  }, 15000);
  heartbeat.unref();
  return {
    listen: (port = 3001, host = "127.0.0.1") =>
      new Promise<number>((resolve, reject) => {
        http.once("error", reject);
        http.listen(port, host, () => {
          http.removeListener("error", reject);
          resolve((http.address() as { port: number }).port);
        });
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        closing = true;
        clearInterval(heartbeat);
        for (const room of rooms.values()) for (const member of room.members) clearTimeout(member.expiry);
        for (const socket of websocket.clients) socket.terminate();
        websocket.close(() =>
          http.close((error) => (error ? reject(error) : resolve())),
        );
      }),
  };
}
