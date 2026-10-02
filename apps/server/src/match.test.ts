import { applyAction, getReachableTiles, getWorkableTiles, getAttackTargets, type GameState } from "@reach/game-core";
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

  async function match(count = 2) {
    const created = await create();
    const clients = [created.host];
    for (let i = 1; i < count; i++) {
      const client = await connect();
      client.send({ type: "JOIN_ROOM", name: `Guest ${i}`, code: created.room.code });
      for (const existing of clients) await existing.next();
      await client.next();
      clients.push(client);
    }
    clients[0].send({ type: "START_MATCH" });
    let state!: GameState;
    for (const client of clients) {
      const response = await client.next();
      if (response.type !== "MATCH_STATE") throw new Error("Expected match");
      if (state) expect(response.state).toEqual(state);
      state = response.state;
    }
    return { clients, state, code: created.room.code };
  }

  async function act(clients: Awaited<ReturnType<typeof connect>>[], state: GameState, action: unknown, index = state.players.findIndex(player => player.id === state.activePlayerId)) {
    clients[index].send({ type: "GAME_ACTION", requestId: "test", expectedRevision: state.revision, action });
    let next!: GameState;
    for (const client of [clients[index], ...clients.filter((_, i) => i !== index)]) {
      const response = await client.next();
      if (response.type !== "MATCH_STATE") throw new Error(JSON.stringify(response));
      if (next) expect(response.state).toEqual(next);
      next = response.state;
    }
    expect(next.revision).toBe(state.revision + 1);
    return next;
  }

  it("requires a host and two players to start", async () => {
    const { host, room } = await create();
    host.send({ type: "START_MATCH" });
    expect((await host.next()).type).toBe("LOBBY_ERROR");
    const guest = await connect();
    guest.send({ type: "JOIN_ROOM", name: "Guest", code: room.code });
    await host.next(); await guest.next();
    guest.send({ type: "START_MATCH" });
    expect((await guest.next()).type).toBe("LOBBY_ERROR");
  });

  it.each([2, 8])("starts identical canonical state for %i players", async count => {
    const { state, clients } = await match(count);
    expect(state.players).toHaveLength(count);
    expect(state.units).toHaveLength(count);
    clients[0].send({ type: "START_MATCH" });
    expect((await clients[0].next()).type).toBe("LOBBY_ERROR");
    expect(state.players[0].name).toBe("Fern");
    expect(state.units[0].ownerId).toBe(state.players[0].id);
  });

  it("synchronizes movement, capture, workers, population, upgrades and turns", async () => {
    let { clients, state } = await match();
    state = await act(clients, state, { type: "move", unitId: "warrior-1", to: { x: 5, y: 5 } });
    expect(state.cities.find(city => city.id === "neutral-1")!.ownerId).toBe(state.players[0].id);
    const tile = getWorkableTiles(state, "city-1").find(tile => tile.resource === "orchard" || tile.resource === "wheat")!;
    state = await act(clients, state, { type: "ASSIGN_WORKER", cityId: "city-1", tile: { x: tile.x, y: tile.y } });
    for (let i = 0; i < 12; i++) state = await act(clients, state, { type: "END_TURN" });
    state = await act(clients, state, { type: "GROW_POPULATION", cityId: "city-1" });
    state = await act(clients, state, { type: "UPGRADE_TOWN_HALL", cityId: "city-1" });
    state = await act(clients, state, { type: "UNASSIGN_WORKER", cityId: "city-1", tile: { x: tile.x, y: tile.y } });
    expect(state.cities[0].townHallLevel).toBe(2);
    state = await act(clients, state, { type: "END_TURN" });
    expect(state.activePlayerId).toBe(state.players[1].id);
    const to = getReachableTiles(state, "warrior-2")[0];
    state = await act(clients, state, { type: "move", unitId: "warrior-2", to: { x: to.x, y: to.y } });
    expect(state.units[1].x).toBe(to.x);
  });

  it("rejects spoofing, invalid rules, malformed intents and stale revisions without changing state", async () => {
    let { clients, state } = await match();
    const original = structuredClone(state);
    const cases = [
      [1, { type: "END_TURN" }],
      [0, { type: "move", unitId: "warrior-2", to: { x: 6, y: 3 } }],
      [0, { type: "move", unitId: "warrior-1", to: { x: -1, y: 0 } }],
      [0, { type: "ATTACK_UNIT", unitId: "warrior-1", targetId: "warrior-2" }],
      [0, { type: "GROW_POPULATION", cityId: "city-1" }],
      [0, { type: "UPGRADE_TOWN_HALL", cityId: "city-2" }],
      [0, { type: "UPGRADE_TOWN_HALL", cityId: "city-1" }],
      [0, { type: "ASSIGN_WORKER", cityId: "city-2", tile: { x: 7, y: 4 } }],
      [0, { type: "UNASSIGN_WORKER", cityId: "city-2", tile: { x: 7, y: 4 } }],
      [0, { type: "ATTACK_UNIT", unitId: "warrior-2", targetId: "warrior-1" }],
      [0, { type: "END_TURN", playerId: state.players[1].id }],
      [0, { type: "move", unitId: "warrior-1", to: { x: "5", y: 5 } }],
      [0, { type: "REPLACE_STATE", state: {} }],
    ] as const;
    for (const [index, action] of cases) {
      clients[index].send({ type: "GAME_ACTION", requestId: "bad", expectedRevision: state.revision, action });
      expect(["ACTION_REJECTED", "LOBBY_ERROR"]).toContain((await clients[index].next()).type);
    }
    clients[0].send({ type: "GAME_ACTION", requestId: "stale", expectedRevision: 100, action: { type: "END_TURN" } });
    expect((await clients[0].next()).type).toBe("ACTION_REJECTED");
    state = await act(clients, state, { type: "END_TURN" });
    expect(state).toEqual(applyAction(original, { type: "END_TURN", playerId: original.activePlayerId }));
    expect(state.units.map(unit => ({ ...unit, movement: 0 }))).toEqual(original.units.map(unit => ({ ...unit, movement: 0 })));
    expect(state.cities).toEqual(original.cities);
  });

  it("broadcasts combat and deaths through the same rule boundary", async () => {
    let { clients, state } = await match();
    state = await act(clients, state, { type: "move", unitId: "warrior-1", to: { x: 6, y: 5 } });
    state = await act(clients, state, { type: "END_TURN" });
    state = await act(clients, state, { type: "move", unitId: "warrior-2", to: { x: 7, y: 4 } });
    state = await act(clients, state, { type: "END_TURN" });
    state = await act(clients, state, { type: "move", unitId: "warrior-1", to: { x: 7, y: 5 } });
    state = await act(clients, state, { type: "END_TURN" });
    expect(getAttackTargets(state, "warrior-2").map(unit => unit.id)).toContain("warrior-1");
    for (let i = 0; i < 12 && state.units.length > 1; i++) {
      const attacker = state.units.find(unit => unit.ownerId === state.activePlayerId)!;
      const target = state.units.find(unit => unit.ownerId !== state.activePlayerId)!;
      state = await act(clients, state, { type: "ATTACK_UNIT", unitId: attacker.id, targetId: target.id });
      state = await act(clients, state, { type: "END_TURN" });
    }
    expect(state.units).toHaveLength(1);
  });

  it("rejects late joining and malformed JSON without replacing match state", async () => {
    const { clients, state, code } = await match();
    const late = await connect();
    late.send({ type: "JOIN_ROOM", name: "Late", code });
    expect((await late.next()).type).toBe("LOBBY_ERROR");
    clients[0].socket.send("{");
    expect((await clients[0].next()).type).toBe("LOBBY_ERROR");
    clients[0].socket.send(Buffer.from("{}"));
    expect((await clients[0].next()).type).toBe("LOBBY_ERROR");
    const next = await act(clients, state, { type: "END_TURN" });
    expect(next).toEqual(applyAction(state, { type: "END_TURN", playerId: state.activePlayerId }));
  });

  it("isolates rooms and destroys a match on disconnect", async () => {
    const first = await match();
    const second = await match();
    await act(first.clients, first.state, { type: "END_TURN" });
    const next = await act(second.clients, second.state, { type: "END_TURN" });
    expect(next.revision).toBe(1);
    await first.clients[0].close();
    expect((await first.clients[1].next()).type).toBe("MATCH_ENDED");
    const newcomer = await connect();
    newcomer.send({ type: "JOIN_ROOM", name: "Late", code: first.code });
    expect((await newcomer.next()).type).toBe("LOBBY_ERROR");
  });
});
