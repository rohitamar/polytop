import { expect, it } from "vitest";
import { createGame, getPlayerView } from "@reach/game-core";
import {
  parseLobbyClientMessage,
  parseLobbyServerMessage,
  PLAYER_COLORS,
} from "./lobby";

it("validates names and exact client envelopes", () => {
  expect(
    parseLobbyClientMessage({ type: "CREATE_ROOM", name: " Fern " }),
  ).toEqual({ type: "CREATE_ROOM", name: "Fern" });
  expect(
    parseLobbyClientMessage({ type: "CREATE_ROOM", name: "Fern\nMoss" }),
  ).toBeNull();
  expect(parseLobbyClientMessage({ type: "LEAVE_ROOM", state: {} })).toBeNull();
});

it("accepts technology intents without allowing client identity or economy fields", () => {
  const envelope = { type: "GAME_ACTION", requestId: "tech", expectedRevision: 0 };
  const action = { type: "UNLOCK_TECHNOLOGY", technologyId: "archery" };
  expect(parseLobbyClientMessage({ ...envelope, action })).toEqual({ ...envelope, action });
  for (const invalid of [{ ...action, playerId: "other" }, { ...action, goldCost: 0 }, { ...action, technologies: ["archery"] }, { ...action, technologyId: "" }, { ...action, technologyId: 3 }]) {
    expect(parseLobbyClientMessage({ ...envelope, action: invalid })).toBeNull();
  }
});

it("accepts recruitment intents without client identity, placement or cost overrides", () => {
  const envelope = { type: "GAME_ACTION", requestId: "recruit", expectedRevision: 0 };
  const action = { type: "RECRUIT_UNIT", cityId: "city-1", unitType: "archer" };
  expect(parseLobbyClientMessage({ ...envelope, action })).toEqual({ ...envelope, action });
  for (const invalid of [{ ...action, playerId: "other" }, { ...action, foodCost: 0 }, { ...action, to: { x: 0, y: 0 } }, { ...action, unitType: "" }, { ...action, cityId: 3 }]) expect(parseLobbyClientMessage({ ...envelope, action: invalid })).toBeNull();
});

it("validates server snapshots and rejects invalid identities, hosts, and colors", () => {
  const room = {
    code: "ABC234",
    hostId: "one",
    players: [{ id: "one", name: "Fern", color: PLAYER_COLORS[0] }],
  };
  expect(
    parseLobbyServerMessage({ type: "LOBBY_UPDATE", playerId: "one", room }),
  ).not.toBeNull();
  for (const invalid of [
    null,
    {},
    { type: "LOBBY_ERROR", code: "UNKNOWN", message: "Error" },
    { type: "LOBBY_UPDATE", playerId: "other", room },
    {
      type: "LOBBY_UPDATE",
      playerId: "one",
      room: { ...room, hostId: "other" },
    },
    {
      type: "LOBBY_UPDATE",
      playerId: "one",
      room: { ...room, players: [...room.players, ...room.players] },
    },
  ]) {
    expect(parseLobbyServerMessage(invalid)).toBeNull();
  }
});

it("accepts road tile intents and rejects cost, ownership and fractional-coordinate claims", () => {
  const envelope = { type: "GAME_ACTION", requestId: "road", expectedRevision: 0 };
  const action = { type: "BUILD_ROAD", to: { x: 4, y: 4 } };
  expect(parseLobbyClientMessage({ ...envelope, action })).toEqual({ ...envelope, action });
  for (const invalid of [{ ...action, playerId: "other" }, { ...action, goldCost: 0 }, { ...action, ownerId: "other" }, { ...action, to: { x: 4.5, y: 4 } }, { ...action, to: { x: 4, y: 4, road: true } }]) {
    expect(parseLobbyClientMessage({ ...envelope, action: invalid })).toBeNull();
  }
});

it("accepts Port intents without client cost or ownership overrides", () => {
  const envelope = { type: "GAME_ACTION", requestId: "port", expectedRevision: 0 };
  const action = { type: "BUILD_PORT", to: { x: 4, y: 4 } };
  expect(parseLobbyClientMessage({ ...envelope, action })).toEqual({ ...envelope, action });
  for (const invalid of [{ ...action, goldCost: 0 }, { ...action, playerId: "other" }, { ...action, to: { x: 4.5, y: 4 } }]) expect(parseLobbyClientMessage({ ...envelope, action: invalid })).toBeNull();
});

it("requires a player-specific exploration snapshot in match messages", () => {
  const state = createGame();
  expect(parseLobbyServerMessage({ type: "MATCH_STATE", state, action: null })).toBeNull();
  const message = { type: "MATCH_STATE", state: getPlayerView(state, "player-1"), action: null };
  expect(parseLobbyServerMessage(message)).toEqual(message);
  expect(parseLobbyServerMessage({ ...message, state: { ...message.state, exploration: state.exploration } })).toBeNull();
});
