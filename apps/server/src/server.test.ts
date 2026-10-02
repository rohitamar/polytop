import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  parseLobbyServerMessage,
  ROOM_CODE_PATTERN,
  type LobbyServerMessage,
} from "@reach/protocol";
import { createLobbyServer } from "./server";

describe("lobby WebSocket server", () => {
  let server: ReturnType<typeof createLobbyServer>;
  let port: number;
  beforeEach(async () => {
    server = createLobbyServer();
    port = await server.listen(0);
  });
  afterEach(async () => {
    await server.close();
  });

  async function connect() {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/lobby`);
    const queue: LobbyServerMessage[] = [];
    const waiters: ((message: LobbyServerMessage) => void)[] = [];
    socket.on("message", (data) => {
      const message = parseLobbyServerMessage(JSON.parse(data.toString()));
      if (!message) throw new Error("Invalid server response");
      const waiter = waiters.shift();
      if (waiter) waiter(message);
      else queue.push(message);
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    return {
      socket,
      send: (message: unknown) => socket.send(JSON.stringify(message)),
      next: () =>
        queue.length
          ? Promise.resolve(queue.shift()!)
          : new Promise<LobbyServerMessage>((resolve) => waiters.push(resolve)),
      close: () =>
        new Promise<void>((resolve) => {
          socket.once("close", resolve);
          socket.close();
        }),
    };
  }

  async function create() {
    const host = await connect();
    host.send({ type: "CREATE_ROOM", name: "  Fern  " });
    const update = await host.next();
    if (update.type !== "LOBBY_UPDATE") throw new Error("Expected lobby");
    return { host, room: update.room, playerId: update.playerId };
  }

  it("creates distinct rooms with readable codes and server-owned identities", async () => {
    const first = await create();
    const second = await create();
    expect(first.room.code).toMatch(ROOM_CODE_PATTERN);
    expect(second.room.code).not.toBe(first.room.code);
    expect(second.playerId).not.toBe(first.playerId);
    expect(first.room.hostId).toBe(first.playerId);
    expect(first.room.players[0].name).toBe("Fern");
  });

  it("broadcasts joins to both members and normalizes room codes", async () => {
    const { host, room, playerId } = await create();
    const guest = await connect();
    guest.send({
      type: "JOIN_ROOM",
      name: "Moss",
      code: ` ${room.code.toLowerCase()} `,
    });
    const hostUpdate = await host.next();
    const guestUpdate = await guest.next();
    expect(hostUpdate.type).toBe("LOBBY_UPDATE");
    if (
      hostUpdate.type !== "LOBBY_UPDATE" ||
      guestUpdate.type !== "LOBBY_UPDATE"
    )
      throw new Error("Expected updates");
    expect(hostUpdate.room).toEqual(guestUpdate.room);
    expect(hostUpdate.room.players).toHaveLength(2);
    expect(guestUpdate.playerId).not.toBe(playerId);
    expect(
      new Set(hostUpdate.room.players.map((player) => player.color)).size,
    ).toBe(2);
  });

  it("accepts eight players, rejects player nine, and reuses a departed color", async () => {
    const { host, room } = await create();
    const guests = [];
    let final = room;
    for (let index = 1; index < 8; index++) {
      const guest = await connect();
      guests.push(guest);
      guest.send({
        type: "JOIN_ROOM",
        name: `Player ${index}`,
        code: room.code,
      });
      const update = await host.next();
      if (update.type !== "LOBBY_UPDATE") throw new Error("Expected update");
      final = update.room;
    }
    expect(final.players).toHaveLength(8);
    expect(new Set(final.players.map((player) => player.id)).size).toBe(8);
    expect(new Set(final.players.map((player) => player.color)).size).toBe(8);
    const ninth = await connect();
    ninth.send({ type: "JOIN_ROOM", name: "Ninth", code: room.code });
    expect(await ninth.next()).toMatchObject({
      type: "LOBBY_ERROR",
      code: "ROOM_FULL",
    });
    await guests[0].close();
    expect(await host.next()).toMatchObject({
      type: "LOBBY_UPDATE",
      room: { players: expect.any(Array) },
    });
    ninth.send({ type: "JOIN_ROOM", name: "Ninth", code: room.code });
    const joined = await ninth.next();
    if (joined.type !== "LOBBY_UPDATE") throw new Error("Expected update");
    expect(joined.room.players).toHaveLength(8);
    expect(joined.room.players[7].color).toBe(final.players[1].color);
  });

  it("rejects nonexistent rooms and malformed requests without disconnecting", async () => {
    const client = await connect();
    client.send({ type: "JOIN_ROOM", name: "Fern", code: "AAAAAA" });
    expect(await client.next()).toMatchObject({ code: "ROOM_NOT_FOUND" });
    const malformed = [
      null,
      [],
      {},
      { type: "JOIN_ROOM", name: "Fern", code: "!" },
      { type: "CREATE_ROOM", name: " " },
      { type: "CREATE_ROOM", name: "x".repeat(25) },
      { type: "CREATE_ROOM", name: "Fern", playerId: "forged" },
      { type: "action", action: { type: "END_TURN" } },
    ];
    for (const message of malformed) {
      client.send(message);
      expect(await client.next()).toMatchObject({ code: "MALFORMED_MESSAGE" });
    }
    client.socket.send("{broken");
    expect(await client.next()).toMatchObject({ code: "MALFORMED_MESSAGE" });
    client.socket.send(Buffer.from("{}"));
    expect(await client.next()).toMatchObject({ code: "MALFORMED_MESSAGE" });
    client.send({ type: "CREATE_ROOM", name: "Fern" });
    expect(await client.next()).toMatchObject({ type: "LOBBY_UPDATE" });
  });

  it("rejects duplicate membership without changing the room", async () => {
    const { host, room } = await create();
    host.send({ type: "CREATE_ROOM", name: "Other" });
    expect(await host.next()).toMatchObject({ code: "ALREADY_IN_ROOM" });
    host.send({ type: "JOIN_ROOM", name: "Other", code: room.code });
    expect(await host.next()).toMatchObject({ code: "ALREADY_IN_ROOM" });
  });

  it("transfers host on disconnect and deletes the last player's room", async () => {
    const { host, room } = await create();
    const guest = await connect();
    guest.send({ type: "JOIN_ROOM", name: "Moss", code: room.code });
    const joined = await guest.next();
    if (joined.type !== "LOBBY_UPDATE") throw new Error("Expected update");
    await host.close();
    expect(await guest.next()).toMatchObject({
      room: { hostId: joined.playerId, players: [{ name: "Moss" }] },
    });
    guest.send({ type: "LEAVE_ROOM" });
    expect(await guest.next()).toEqual({ type: "LEFT_ROOM" });
    guest.send({ type: "JOIN_ROOM", name: "Moss", code: room.code });
    expect(await guest.next()).toMatchObject({ code: "ROOM_NOT_FOUND" });
    guest.send({ type: "CREATE_ROOM", name: "Moss" });
    expect(await guest.next()).toMatchObject({ type: "LOBBY_UPDATE" });
  });

  it("closes oversized messages", async () => {
    const client = await connect();
    const closed = new Promise<number>((resolve) =>
      client.socket.once("close", resolve),
    );
    client.socket.send("x".repeat(4097));
    expect(await closed).toBe(1009);
  });
});
