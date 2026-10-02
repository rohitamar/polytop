import { expect, it } from "vitest";
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
