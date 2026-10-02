# Lobby server

Run `npm run dev:server` from the repository root, or `npm run start -w @reach/server` without watch mode. The default endpoint is `ws://127.0.0.1:3001/lobby`. `HOST` and `PORT` configure the listener. The web development server proxies `/lobby` to this endpoint.

The service accepts only validated `CREATE_ROOM`, `JOIN_ROOM` and `LEAVE_ROOM` messages from `@reach/protocol`. The server generates six-character room codes using cryptographic randomness, assigns UUID player IDs and distinct palette colors, and sends recipient-specific `LOBBY_UPDATE` snapshots. Rooms accept eight members, including the host. A newly created room waits for guests.

Membership is bound to the WebSocket connection. Closing it removes the player, promotes the earliest remaining member if necessary and deletes empty rooms. Ping/pong heartbeats terminate dead connections. Binary, malformed and gameplay messages are rejected; payloads exceeding 4 KiB close the connection. Room membership and identities are not persisted or restored after reconnecting.

No gameplay state or rules run here yet. Future gameplay requests must use action envelopes, bind identity to a trusted session, validate membership and revisions, and call game-core's `applyAction`. Clients must never replace authoritative state. The existing future protocol envelopes are not accepted by this lobby service.
