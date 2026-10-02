import { applyAction, createGame, type GameState } from "@reach/game-core";
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

type Member = { socket: WebSocket; player: LobbyPlayer };
type Room = { code: string; members: Member[]; state?: GameState };

export function createLobbyServer() {
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
  const leave = (socket: WebSocket) => {
    const room = memberships.get(socket);
    if (!room) return;
    if (room.state) {
      for (const member of room.members) {
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
      if (message.type === "LEAVE_ROOM") {
        leave(socket);
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
            const initial = createGame("fern-104", room.members.length);
            const ids = new Map(initial.players.map((player, i) => [player.id, room.members[i].player.id]));
            room.state = { ...initial, activePlayerId: member.player.id,
              players: initial.players.map((player, i) => ({ ...player, id: room.members[i].player.id, name: room.members[i].player.name })),
              units: initial.units.map(unit => ({ ...unit, ownerId: ids.get(unit.ownerId)! })),
              cities: initial.cities.map(city => ({ ...city, ownerId: city.ownerId ? ids.get(city.ownerId)! : null })) };
            for (const participant of room.members) send(participant.socket, { type: "MATCH_STATE", state: room.state, action: null });
          } else {
            if (!room.state) throw new Error("Match has not started");
            if (message.expectedRevision !== room.state.revision) throw new Error("State changed. Try again.");
            const action = { ...message.action, playerId: member.player.id };
            room.state = applyAction(room.state, action);
            for (const participant of room.members) send(participant.socket, { type: "MATCH_STATE", state: room.state, action });
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
        player: { id: randomUUID(), name: message.name, color },
      });
      memberships.set(socket, room);
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
        clearInterval(heartbeat);
        for (const socket of websocket.clients) socket.terminate();
        websocket.close(() =>
          http.close((error) => (error ? reject(error) : resolve())),
        );
      }),
  };
}
