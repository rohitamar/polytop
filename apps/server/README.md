# Authoritative match server

Run `npm run dev:server` from the repository root, or `npm run start -w @reach/server`. The default endpoint is `ws://127.0.0.1:3001/lobby`. `HOST` and `PORT` configure the listener. The web development server proxies `/lobby` to it.

Rooms accept 2–8 players. The host starts a match; the server creates a fresh seed, selects the centralized map-size tier from the roster count, generates terrain/cities/units once, remaps owners to connection-bound player IDs, and broadcasts complete state. Territory is deterministically derived from the broadcast city locations and owners in game-core. `MATCH_SEED` fixes generation for repeatable scenarios. `MATCH_SCENARIO=demo` opts two-player matches into the compact interaction fixture; larger matches still use normal world generation.

Validated game intents omit player identity and replacement states. The server checks membership and revision, supplies trusted identity, and calls `applyAction`. Accepted actions broadcast authoritative snapshots; invalid actions leave state unchanged. Captures transfer territory through the same city ownership transition. Every room has independent state.

Leaving or disconnecting ends an active match for all participants and removes it. In a lobby, the earliest remaining member becomes host. Ping/pong heartbeats terminate dead connections. Malformed and binary messages are rejected; payloads exceeding 4 KiB close the connection. There are no accounts, persistence or reconnect/resume.
