import { createGame, getPlayerView, getTileVisibility, TileVisibility, getPlayerAction, updatePlayerExploration, type GameAction, getTechnologyCost, economy, getPlayerPopulation, getProduction, canUnitEnterTerrain, getTile, movementCost, positionKey, getTerritory, applyAction, getReachableTiles, getAttackTargets, type GameState } from "@reach/game-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  parseLobbyServerMessage,
  type LobbyServerMessage,
} from "@reach/protocol";
import { createLobbyServer } from "./server";

describe("lobby WebSocket server", () => {
  let server: ReturnType<typeof createLobbyServer>;
  let port: number;
  let demo = true;
  beforeEach(async () => {
    demo = true;
    server = createLobbyServer({ seed: "fern-104", demo: true });
    port = await server.listen(0);
  });
  afterEach(async () => {
    await server.close();
  });

  async function connect() {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/lobby`);
    let session: Extract<LobbyServerMessage, { type: "MATCH_SESSION" }> | undefined;
    const queue: LobbyServerMessage[] = [];
    const waiters: ((message: LobbyServerMessage) => void)[] = [];
    socket.on("message", (data) => {
      const message = parseLobbyServerMessage(JSON.parse(data.toString()));
      if (!message) throw new Error("Invalid server response");
      if (message.type === "MATCH_SESSION") { session = message; return; }
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
      session: () => session!,
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
    for (let i = 0; i < clients.length; i++) {
      const response = await clients[i].next();
      if (response.type !== "MATCH_STATE") throw new Error("Expected match");
      if (!state) {
        const initial = createGame("fern-104", count, demo && count === 2 ? { scenario: "demo" } : {});
        const ids = new Map(initial.players.map((player, index) => [player.id, response.state.players[index].id]));
        state = updatePlayerExploration({ ...initial, exploration: undefined, activePlayerId: response.state.activePlayerId,
          players: initial.players.map((player, index) => ({ ...player, id: response.state.players[index].id, name: response.state.players[index].name })),
          units: initial.units.map(unit => ({ ...unit, ownerId: ids.get(unit.ownerId)! })),
          cities: initial.cities.map(city => ({ ...city, ownerId: city.ownerId ? ids.get(city.ownerId)! : null })) });
      }
      expect(response.state).toEqual(getPlayerView(state, state.players[i].id));
    }
    return { clients, state, code: created.room.code };
  }

  async function act(clients: Awaited<ReturnType<typeof connect>>[], state: GameState, action: unknown, index = state.players.findIndex(player => player.id === state.activePlayerId)) {
    clients[index].send({ type: "GAME_ACTION", requestId: `test-${state.revision}`, expectedRevision: state.revision, action });
    const accepted = { ...action as GameAction, playerId: state.players[index].id };
    const path = accepted.type === "move" ? getReachableTiles(state, accepted.unitId).find(tile => positionKey(tile) === positionKey(accepted.to))?.path : undefined;
    const next = applyAction(state, accepted);
    for (let i = 0; i < clients.length; i++) {
      const response = await clients[i].next();
      expect(response).toEqual({ type: "MATCH_STATE", state: getPlayerView(next, next.players[i].id), action: getPlayerAction(next.players[i].id, accepted), ...(i === index && path ? { path } : {}) });
    }
    expect(next.revision).toBe(state.revision + 1);
    return next;
  }


  it("withholds the map seed, hidden enemies and other players' exploration", async () => {
    const first = await match(8);
    const second = await match(2);
    const view = getPlayerView(first.state, first.state.players[0].id);
    expect(view.seed).toBe("");
    expect(view.tiles.length).toBeLessThan(first.state.tiles.length);
    expect(view.units).toHaveLength(1);
    expect(Object.keys(view.exploration!)).toEqual([first.state.players[0].id]);
    expect(first.state.width).toBe(30);
    expect(second.state.width).toBe(20);
    expect((await act(second.clients, second.state, { type: "END_TURN" })).revision).toBe(1);
  });

  it("resumes explored fog memory and gives no hidden-unit existence oracle", async () => {
    const { clients, state: initial, code } = await match();
    let state = initial;
    for (const to of [{ x: 4, y: 4 }, { x: 4, y: 3 }, { x: 4, y: 4 }]) {
      state = await act(clients, state, { type: "move", unitId: "warrior-1", to });
      state = await act(clients, state, { type: "END_TURN" });
      state = await act(clients, state, { type: "END_TURN" });
    }
    expect(getTileVisibility(state, state.players[0].id, "4,2")).toBe(TileVisibility.Explored);
    for (const unitId of ["warrior-2", "unknown-unit"]) {
      clients[0].send({ type: "GAME_ACTION", requestId: unitId, expectedRevision: state.revision, action: { type: "move", unitId, to: { x: 7, y: 4 } } });
      expect(await clients[0].next()).toMatchObject({ type: "ACTION_REJECTED", message: "Not your unit or turn" });
    }
    const token = clients[0].session().token;
    await clients[0].close();
    const resumed = await connect();
    resumed.send({ type: "RESUME_MATCH", code, token });
    await clients[1].next();
    await resumed.next();
    expect(await resumed.next()).toEqual({ type: "MATCH_STATE", state: getPlayerView(state, state.players[0].id), action: null });
  });

  it("synchronizes automatic Gold and population for eight clients", async () => {
    const { clients, state: initial } = await match(8);
    let state = initial;
    expect(getPlayerPopulation(state, state.players[0].id)).toEqual({ used: 1, capacity: 3, available: 2 });
    const income = getProduction(state, state.players[0].id).gold;
    expect(income).toBe(economy.goldIncome[0]);
    for (let i = 0; i < 8; i++) state = await act(clients, state, { type: "END_TURN" });
    expect(state.players[0].resources).toEqual({ gold: initial.players[0].resources.gold + income });
    expect(state.tiles).toEqual(initial.tiles);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it("rejects simultaneous, stale and replayed turn requests without duplicate income", async () => {
    const { clients, state: matchState } = await match();
    let state = matchState;
    const original = structuredClone(state);
    const request = { type: "GAME_ACTION", requestId: "turn-once", expectedRevision: state.revision, action: { type: "END_TURN" } };
    clients[0].send(request);
    clients[0].send(request);
    const response = await clients[0].next();
    if (response.type !== "MATCH_STATE") throw new Error("Expected turn");
    const enemyResponse = await clients[1].next();
    expect(enemyResponse).toMatchObject({ type: "MATCH_STATE", state: { perspectiveId: state.players[1].id, revision: response.state.revision } });
    expect((await clients[0].next()).type).toBe("ACTION_REJECTED");
    state = applyAction(original, { type: "END_TURN", playerId: original.activePlayerId });
    expect(response.state).toEqual(getPlayerView(state, state.players[0].id));
    clients[1].send({ ...request, requestId: "stale-turn" });
    expect((await clients[1].next()).type).toBe("ACTION_REJECTED");
    state = await act(clients, state, { type: "END_TURN" });
    clients[0].send({ ...request, expectedRevision: state.revision });
    expect(await clients[0].next()).toMatchObject({ type: "ACTION_REJECTED", message: "Request already accepted" });
    const before = structuredClone(state);
    state = await act(clients, state, { type: "END_TURN" });
    expect(state).toEqual(applyAction(before, { type: "END_TURN", playerId: before.activePlayerId }));
  });

  it("authorizes technology purchases and synchronizes separate unlocks across clients", async () => {
    const { clients, state: matchState } = await match();
    let state = matchState;
    const reject = async (index: number, action: unknown, reason: string, expectedRevision = state.revision) => {
      clients[index].send({ type: "GAME_ACTION", requestId: "technology", expectedRevision, action });
      expect(await clients[index].next()).toMatchObject({ type: "ACTION_REJECTED", message: expect.stringContaining(reason) });
    };
    await reject(1, { type: "UNLOCK_TECHNOLOGY", technologyId: "roads" }, "turn");
    await reject(0, { type: "UNLOCK_TECHNOLOGY", technologyId: "unknown" }, "Unknown technology");
    for (const action of [
      { type: "UNLOCK_TECHNOLOGY", technologyId: "archery", playerId: state.players[1].id },
      { type: "UNLOCK_TECHNOLOGY", technologyId: "archery", goldCost: 0 },
      { type: "UNLOCK_TECHNOLOGY", technologyId: "archery", technologies: ["archery"] },
    ]) {
      clients[0].send({ type: "GAME_ACTION", requestId: "spoof", expectedRevision: state.revision, action });
      expect((await clients[0].next()).type).toBe("LOBBY_ERROR");
    }
    state = await act(clients, state, { type: "END_TURN" });
    state = await act(clients, state, { type: "END_TURN" });
    state = await act(clients, state, { type: "END_TURN" });
    state = await act(clients, state, { type: "END_TURN" });
    const goldBeforePurchase = state.players[0].resources.gold;
    state = await act(clients, state, { type: "UNLOCK_TECHNOLOGY", technologyId: "archery" });
    expect(state.players[0].resources.gold).toBe(goldBeforePurchase - 6);
    expect(state.players.map(player => player.technologies)).toEqual([["archery"], []]);
    await reject(0, { type: "UNLOCK_TECHNOLOGY", technologyId: "archery" }, "Already unlocked");
    await reject(0, { type: "UNLOCK_TECHNOLOGY", technologyId: "roads" }, "State changed", state.revision - 1);
    const to = getReachableTiles(state, "warrior-1")[0];
    state = await act(clients, state, { type: "move", unitId: "warrior-1", to: { x: to.x, y: to.y } });
    state = await act(clients, state, { type: "END_TURN" });
    state = await act(clients, state, { type: "UNLOCK_TECHNOLOGY", technologyId: "roads" });
    expect(state.players.map(player => player.technologies)).toEqual([["archery"], ["roads"]]);
    expect(state.players[1].resources.gold).toBe(getProduction(state, state.players[1].id).gold * 3 - 6);
    state = await act(clients, state, { type: "END_TURN" });
    expect(state.players.map(player => player.technologies)).toEqual([["archery"], ["roads"]]);
    expect(state.units[0].movement).toBe(state.units[0].maxMovement);
  });

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

  it.each([2, 4, 6, 8])("starts canonical state with independent player views for %i players", async count => {
    await server.close();
    demo = false;
    server = createLobbyServer({ seed: "fern-104" });
    port = await server.listen(0);
    const { state, clients } = await match(count);
    const size = count === 2 ? 20 : count === 4 ? 24 : count === 6 ? 28 : 30;
    expect(state).toMatchObject({ width: size, height: size });
    expect(state.tiles).toHaveLength(size * size);
    expect(state.players).toHaveLength(count);
    expect(state.units).toHaveLength(count);
    clients[0].send({ type: "START_MATCH" });
    expect((await clients[0].next()).type).toBe("LOBBY_ERROR");
    expect(state.players[0].name).toBe("Fern");
    expect(state.units[0].ownerId).toBe(state.players[0].id);
  });

  it("synchronizes movement, capture, population capacity, upgrades and turns", async () => {
    const { clients, state: matchState } = await match();
    let state = matchState;
    const neutralTerritory = getTerritory(state).filter(tile => tile.cityId === "neutral-1");
    state = await act(clients, state, { type: "move", unitId: "warrior-1", to: { x: 5, y: 5 } });
    expect(getTerritory(state).filter(tile => tile.cityId === "neutral-1")).toEqual(neutralTerritory.map(tile => ({ ...tile, playerId: state.players[0].id })));
    expect(state.cities.find(city => city.id === "neutral-1")!.ownerId).toBe(state.players[0].id);
    for (let i = 0; i < 12; i++) state = await act(clients, state, { type: "END_TURN" });
    state = await act(clients, state, { type: "UPGRADE_TOWN_HALL", cityId: "city-1" });
    expect(state.cities[0].townHallLevel).toBe(2);
    state = await act(clients, state, { type: "END_TURN" });
    expect(state.activePlayerId).toBe(state.players[1].id);
    const to = getReachableTiles(state, "warrior-2")[0];
    state = await act(clients, state, { type: "move", unitId: "warrior-2", to: { x: to.x, y: to.y } });
    expect(state.units[1].x).toBe(to.x);
  });

  it("rejects spoofing, invalid rules, malformed intents and stale revisions without changing state", async () => {
    const { clients, state: matchState } = await match();
    let state = matchState;
    const original = structuredClone(state);
    const cases = [
      [1, { type: "END_TURN" }],
      [0, { type: "move", unitId: "warrior-2", to: { x: 6, y: 3 } }],
      [0, { type: "move", unitId: "warrior-1", to: { x: -1, y: 0 } }],
      [0, { type: "ATTACK_UNIT", unitId: "warrior-1", targetId: "warrior-2" }],
      [0, { type: "GROW_POPULATION", cityId: "city-1" }],
      [0, { type: "UPGRADE_TOWN_HALL", cityId: "city-2" }],
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
    const { clients, state: matchState } = await match();
    let state = matchState;
    state = await act(clients, state, { type: "move", unitId: "warrior-1", to: { x: 5, y: 5 } });
    state = await act(clients, state, { type: "END_TURN" });
    state = await act(clients, state, { type: "END_TURN" });
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

  it("validates recruitment on the server and rejects simultaneous and replayed spending", async () => {
    const { clients, state: matchState } = await match();
    let state = matchState;
    state = await act(clients, state, { type: "move", unitId: "warrior-1", to: { x: 5, y: 5 } });
    for (let i = 0; i < 4; i++) state = await act(clients, state, { type: "END_TURN" });
    const before = structuredClone(state);
    const action = { type: "RECRUIT_UNIT", cityId: "city-1", unitType: "warrior" } as const;
    for (const [client, invalid] of [[clients[1], action], [clients[0], { ...action, unitType: "archer" }], [clients[0], { ...action, unitType: "swordsman" }], [clients[0], { ...action, unitType: "dragon" }], [clients[0], { ...action, cityId: "city-2" }], [clients[0], { ...action, playerId: state.players[1].id }]] as const) {
      client.send({ type: "GAME_ACTION", requestId: "invalid-recruit", expectedRevision: state.revision, action: invalid });
      expect(["ACTION_REJECTED", "LOBBY_ERROR"]).toContain((await client.next()).type);
    }
    clients[0].send({ type: "GAME_ACTION", requestId: "once", expectedRevision: state.revision, action });
    clients[0].send({ type: "GAME_ACTION", requestId: "race", expectedRevision: state.revision, action });
    const response = await clients[0].next();
    if (response.type !== "MATCH_STATE") throw new Error("Expected recruitment");
    state = applyAction(before, { ...action, unitType: "warrior", playerId: before.activePlayerId });
    expect(response.state).toEqual(getPlayerView(state, state.players[0].id));
    const enemyResponse = await clients[1].next();
    expect(enemyResponse).toMatchObject({ type: "MATCH_STATE", state: { perspectiveId: state.players[1].id, revision: response.state.revision } });
    expect((await clients[0].next()).type).toBe("ACTION_REJECTED");
    const id = state.units.at(-1)!.id;
    expect(state.units.at(-1)).toMatchObject({ movement: 0, hasAttacked: true });
    state = await act(clients, state, { type: "END_TURN" });
    state = await act(clients, state, { type: "END_TURN" });
    state = await act(clients, state, { type: "move", unitId: id, to: { x: 3, y: 5 } });
    clients[0].send({ type: "GAME_ACTION", requestId: "once", expectedRevision: state.revision, action });
    const rejected = await clients[0].next();
    expect(rejected).toMatchObject({ type: "ACTION_REJECTED", message: "Request already accepted" });
    const unchanged = structuredClone(state);
    state = await act(clients, state, { type: "END_TURN" });
    expect(state).toEqual(applyAction(unchanged, { type: "END_TURN", playerId: unchanged.activePlayerId }));
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
    await act(first.clients, first.state, { type: "move", unitId: "warrior-1", to: { x: 5, y: 5 } });
    const next = await act(second.clients, second.state, { type: "END_TURN" });
    expect(next.revision).toBe(1);
    expect(getTerritory(next).filter(tile => tile.cityId === "neutral-1").every(tile => tile.playerId === null)).toBe(true);
    first.clients[0].send({ type: "LEAVE_ROOM" });
    expect((await first.clients[1].next()).type).toBe("MATCH_ENDED");
    const newcomer = await connect();
    newcomer.send({ type: "JOIN_ROOM", name: "Late", code: first.code });
    expect((await newcomer.next()).type).toBe("LOBBY_ERROR");
  });
  it("collects a resource for all clients once despite stale and duplicate movement requests", async () => {
    const { clients, state: matchState } = await match();
    let state = matchState;
    const request = { type: "GAME_ACTION", requestId: "collect-once", expectedRevision: state.revision, action: { type: "move", unitId: "warrior-1", to: { x: 4, y: 3 } } };
    state = await act(clients, state, { type: "move", unitId: "warrior-1", to: { x: 4, y: 4 } });
    state = await act(clients, state, { type: "END_TURN" });
    state = await act(clients, state, { type: "END_TURN" });
    const before = structuredClone(state);
    request.expectedRevision = state.revision;
    clients[0].send(request);
    clients[0].send(request);
    const response = await clients[0].next();
    if (response.type !== "MATCH_STATE") throw new Error("Expected collection");
    const enemyResponse = await clients[1].next();
    expect(enemyResponse).toMatchObject({ type: "MATCH_STATE", state: { perspectiveId: state.players[1].id, revision: response.state.revision } });
    expect(await clients[0].next()).toMatchObject({ type: "ACTION_REJECTED", message: "Request already accepted" });
    expect(response.state.players[0].resources.gold).toBe(before.players[0].resources.gold + 2);
    expect(response.state.players[1].resources).toEqual({ gold: 0 });
    expect(response.state.tiles.find(tile => tile.x === 4 && tile.y === 3)!.resource).toBeUndefined();
    clients[0].send({ ...request, requestId: "stale-collection" });
    expect(await clients[0].next()).toMatchObject({ type: "ACTION_REJECTED", message: "State changed. Try again." });
    state = applyAction(before, { type: "move", playerId: before.activePlayerId, unitId: "warrior-1", to: { x: 4, y: 3 } });
    expect(response.state).toEqual(getPlayerView(state, state.players[0].id));
    state = await act(clients, state, { type: "END_TURN" });
  });

  it("resumes stored technologies, depleted resources and Gold without repaying income or allowing request replay", async () => {
    const { clients, state: matchState, code } = await match();
    let state = matchState;
    const session = clients[0].session();
    state = await act(clients, state, { type: "move", unitId: "warrior-1", to: { x: 4, y: 4 } });
    state = await act(clients, state, { type: "END_TURN" });
    state = await act(clients, state, { type: "END_TURN" });
    state = await act(clients, state, { type: "move", unitId: "warrior-1", to: { x: 4, y: 3 } });
    state = await act(clients, state, { type: "UNLOCK_TECHNOLOGY", technologyId: "climbing" });
    const saved = structuredClone(state);
    await clients[0].close();
    const impostor = await connect();
    impostor.send({ type: "RESUME_MATCH", code, token: "00000000-0000-0000-0000-000000000000" });
    expect((await impostor.next()).type).toBe("LOBBY_ERROR");
    const resumed = await connect();
    resumed.send({ type: "RESUME_MATCH", code, token: session.token });
    expect((await clients[1].next()).type).toBe("LOBBY_UPDATE");
    expect(await resumed.next()).toMatchObject({ type: "LOBBY_UPDATE", playerId: state.players[0].id });
    expect(await resumed.next()).toEqual({ type: "MATCH_STATE", state: getPlayerView(saved, saved.players[0].id), action: null });
    resumed.send({ type: "GAME_ACTION", requestId: "test-3", expectedRevision: saved.revision, action: { type: "move", unitId: "warrior-1", to: { x: 4, y: 3 } } });
    expect(await resumed.next()).toMatchObject({ type: "ACTION_REJECTED", message: "Request already accepted" });
    clients[0] = resumed;
    state = await act(clients, state, { type: "END_TURN" });
    expect(state).toEqual(applyAction(saved, { type: "END_TURN", playerId: saved.activePlayerId }));
  });

  it("authoritatively builds Ports and carries units through the same synchronized action boundary", async () => {
    const { clients, state: matchState, code } = await match();
    let state = matchState;
    const distances = (target: { x: number; y: number }) => {
      const unit = state.units.find(unit => unit.id === "warrior-1")!;
      const result = new Map([[positionKey(target), 0]]);
      const pending = [{ ...target, cost: 0 }];
      while (pending.length) {
        pending.sort((a, b) => a.cost - b.cost);
        const current = pending.shift()!;
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const tile = getTile(state, current.x + dx, current.y + dy);
          if (!tile || !canUnitEnterTerrain(state, unit.ownerId, unit, tile.terrain) || state.units.some(other => other.id !== unit.id && positionKey(other) === positionKey(tile))) continue;
          const cost = current.cost + movementCost[getTile(state, current.x, current.y)!.terrain];
          if (cost >= (result.get(positionKey(tile)) ?? Infinity)) continue;
          result.set(positionKey(tile), cost);
          pending.push({ ...tile, cost });
        }
      }
      return result;
    };
    const city = state.cities.filter(city => city.ownerId === null && state.tiles.some(tile => tile.terrain === "water" && Math.abs(tile.x - city.x) + Math.abs(tile.y - city.y) === 1)).sort((a, b) => (distances(a).get(positionKey(state.units[0])) ?? Infinity) - (distances(b).get(positionKey(state.units[0])) ?? Infinity))[0];
    expect(city).toBeDefined();
    for (let i = 0; i < 40 && state.cities.find(candidate => candidate.id === city.id)!.ownerId !== state.players[0].id; i++) {
      const distance = distances(city);
      const next = getReachableTiles(state, "warrior-1").sort((a, b) => (distance.get(positionKey(a)) ?? Infinity) - (distance.get(positionKey(b)) ?? Infinity))[0];
      if (next) state = await act(clients, state, { type: "move", unitId: "warrior-1", to: { x: next.x, y: next.y } });
      if (state.cities.find(candidate => candidate.id === city.id)!.ownerId === state.players[0].id) break;
      state = await act(clients, state, { type: "END_TURN" });
      state = await act(clients, state, { type: "END_TURN" });
    }
    expect(state.cities.find(candidate => candidate.id === city.id)!.ownerId).toBe(state.players[0].id);
    const water = state.tiles.find(tile => tile.terrain === "water" && Math.abs(tile.x - city.x) + Math.abs(tile.y - city.y) === 1)!;
    const action = { type: "BUILD_PORT", to: { x: water.x, y: water.y } } as const;
    clients[0].send({ type: "GAME_ACTION", requestId: "locked-port", expectedRevision: state.revision, action });
    expect(await clients[0].next()).toMatchObject({ type: "ACTION_REJECTED", message: "Requires Fishing" });
    while (state.players[0].resources.gold < getTechnologyCost(state, state.players[0].id, "fishing") + 7) {
      state = await act(clients, state, { type: "END_TURN" });
      state = await act(clients, state, { type: "END_TURN" });
    }
    state = await act(clients, state, { type: "UNLOCK_TECHNOLOGY", technologyId: "fishing" });
    const before = structuredClone(state);
    state = await act(clients, state, action);
    expect(state.players[0].resources.gold).toBe(before.players[0].resources.gold - 7);
    expect(getTile(state, water.x, water.y)?.port).toBe(true);
    clients[0].send({ type: "GAME_ACTION", requestId: `test-${before.revision}`, expectedRevision: state.revision, action });
    expect(await clients[0].next()).toMatchObject({ type: "ACTION_REJECTED", message: "Request already accepted" });
    state = await act(clients, state, { type: "END_TURN" });
    state = await act(clients, state, { type: "END_TURN" });
    state = await act(clients, state, { type: "move", unitId: "warrior-1", to: { x: water.x, y: water.y } });
    const sailor = state.units[0];
    expect(sailor).toMatchObject({ unitType: "warrior", embarked: true, movement: 0, hasAttacked: true });
    expect(getPlayerPopulation(state, state.players[0].id).used).toBe(1);
    state = await act(clients, state, { type: "END_TURN" });
    state = await act(clients, state, { type: "END_TURN" });
    const waterDistances = (target: { x: number; y: number }) => {
      const result = new Map([[positionKey(target), 0]]);
      const pending = [target];
      while (pending.length) {
        const current = pending.shift()!;
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const tile = getTile(state, current.x + dx, current.y + dy);
          if (!tile || tile.terrain !== "water" || result.has(positionKey(tile)) || state.units.some(unit => unit.id !== sailor.id && positionKey(unit) === positionKey(tile))) continue;
          result.set(positionKey(tile), result.get(positionKey(current))! + 1);
          pending.push(tile);
        }
      }
      return result;
    };
    const fish = state.tiles.find(tile => tile.resource === "fishery" && waterDistances(tile).has(positionKey(state.units.find(unit => unit.id === sailor.id)!)))!;
    expect(fish).toBeDefined();
    for (let i = 0; i < 50; i++) {
      const distances = waterDistances(fish);
      const destination = getReachableTiles(state, sailor.id).sort((a, b) => (distances.get(positionKey(a)) ?? Infinity) - (distances.get(positionKey(b)) ?? Infinity))[0];
      if (!destination) {
        state = await act(clients, state, { type: "END_TURN" });
        state = await act(clients, state, { type: "END_TURN" });
        continue;
      }
      if (positionKey(destination) !== positionKey(fish)) {
        state = await act(clients, state, { type: "move", unitId: sailor.id, to: { x: destination.x, y: destination.y } });
        continue;
      }
      const gold = state.players[0].resources.gold;
      const request = { type: "GAME_ACTION", requestId: "fish-once", expectedRevision: state.revision, action: { type: "move", unitId: sailor.id, to: { x: fish.x, y: fish.y } } };
      clients[0].send(request);
      clients[0].send(request);
      const response = await clients[0].next();
      if (response.type !== "MATCH_STATE") throw new Error("Expected Fish collection");
      const enemyResponse = await clients[1].next();
    expect(enemyResponse).toMatchObject({ type: "MATCH_STATE", state: { perspectiveId: state.players[1].id, revision: response.state.revision } });
      expect(await clients[0].next()).toMatchObject({ type: "ACTION_REJECTED", message: "Request already accepted" });
      state = applyAction(state, { type: "move", playerId: state.activePlayerId, unitId: sailor.id, to: { x: fish.x, y: fish.y } });
      expect(response.state).toEqual(getPlayerView(state, state.players[0].id));
      expect(state.players[0].resources.gold).toBe(gold + 2);
      expect(getTile(state, fish.x, fish.y)?.resource).toBeUndefined();
      break;
    }
    expect(getTile(state, fish.x, fish.y)?.resource).toBeUndefined();
    const token = clients[0].session().token;
    await clients[0].close();
    const resumed = await connect();
    resumed.send({ type: "RESUME_MATCH", code, token });
    expect((await clients[1].next()).type).toBe("LOBBY_UPDATE");
    expect((await resumed.next()).type).toBe("LOBBY_UPDATE");
    expect(await resumed.next()).toEqual({ type: "MATCH_STATE", state: getPlayerView(state, state.players[0].id), action: null });
  });

  it("replaces a live session without changing state or permitting two controlling sockets", async () => {
    const { clients, state, code } = await match();
    const replacement = await connect();
    replacement.send({ type: "RESUME_MATCH", code, token: clients[0].session().token });
    expect((await clients[0].next()).type).toBe("MATCH_ENDED");
    expect((await clients[1].next()).type).toBe("LOBBY_UPDATE");
    expect((await replacement.next()).type).toBe("LOBBY_UPDATE");
    expect(await replacement.next()).toEqual({ type: "MATCH_STATE", state: getPlayerView(state, state.players[0].id), action: null });
    clients[0] = replacement;
    expect(await act(clients, state, { type: "END_TURN" })).toEqual(applyAction(state, { type: "END_TURN", playerId: state.activePlayerId }));
  });

  it("recalculates empire prices and broadcasts visible roads once, including reconnect", async () => {
    const { clients, state: initial, code } = await match();
    let state = await act(clients, initial, { type: "move", unitId: "warrior-1", to: { x: 5, y: 5 } });
    expect(getTechnologyCost(state, state.players[0].id, "roads")).toBe(8);
    clients[0].send({ type: "GAME_ACTION", requestId: "locked-road", expectedRevision: state.revision, action: { type: "BUILD_ROAD", to: { x: 4, y: 4 } } });
    expect(await clients[0].next()).toMatchObject({ type: "ACTION_REJECTED", message: "Requires Roads" });
    while (state.players[0].resources.gold < 14) {
      state = await act(clients, state, { type: "END_TURN" });
      state = await act(clients, state, { type: "END_TURN" });
    }
    const gold = state.players[0].resources.gold;
    state = await act(clients, state, { type: "UNLOCK_TECHNOLOGY", technologyId: "roads" });
    expect(state.players[0].resources.gold).toBe(gold - 8);
    state = await act(clients, state, { type: "BUILD_ROAD", to: { x: 4, y: 4 } });
    expect(state.players[0].resources.gold).toBe(gold - 11);
    const neutral = getPlayerView(state, state.players[0].id).tiles.find(tile => tile.terrain === "grass" && !tile.road && !state.cities.some(city => positionKey(city) === positionKey(tile)))!;
    const request = { type: "GAME_ACTION", requestId: "road-once", expectedRevision: state.revision, action: { type: "BUILD_ROAD", to: { x: neutral.x, y: neutral.y } } };
    clients[0].send(request);
    clients[0].send(request);
    clients[0].send({ ...request, requestId: "road-race" });
    const response = await clients[0].next();
    if (response.type !== "MATCH_STATE") throw new Error("Expected road");
    const enemyResponse = await clients[1].next();
    expect(enemyResponse).toMatchObject({ type: "MATCH_STATE", state: { perspectiveId: state.players[1].id, revision: response.state.revision } });
    expect(await clients[0].next()).toMatchObject({ type: "ACTION_REJECTED", message: "Request already accepted" });
    expect(await clients[0].next()).toMatchObject({ type: "ACTION_REJECTED", message: "State changed. Try again." });
    state = applyAction(state, { type: "BUILD_ROAD", playerId: state.activePlayerId, to: { x: neutral.x, y: neutral.y } });
    expect(response.state).toEqual(getPlayerView(state, state.players[0].id));
    expect(state.players[0].resources.gold).toBe(gold - 14);
    expect(getTile(state, neutral.x, neutral.y)?.road).toBe(true);
    clients[0].send({ ...request, requestId: "road-existing", expectedRevision: state.revision });
    expect(await clients[0].next()).toMatchObject({ type: "ACTION_REJECTED", message: "Already road-connected" });
    const token = clients[0].session().token;
    await clients[0].close();
    const resumed = await connect();
    resumed.send({ type: "RESUME_MATCH", code, token });
    expect((await clients[1].next()).type).toBe("LOBBY_UPDATE");
    expect((await resumed.next()).type).toBe("LOBBY_UPDATE");
    expect(await resumed.next()).toEqual({ type: "MATCH_STATE", state: getPlayerView(state, state.players[0].id), action: null });
    clients[0] = resumed;
    const next = await act(clients, state, { type: "END_TURN" });
    expect(next).toEqual(applyAction(state, { type: "END_TURN", playerId: state.activePlayerId }));
  });

});
