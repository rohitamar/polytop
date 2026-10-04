# Authoritative match server

Run `npm run dev:server` from the repository root, or `npm run start -w @reach/server`. The default endpoint is `ws://127.0.0.1:3001/lobby`. `HOST` and `PORT` configure the listener. The web development server proxies `/lobby` to it.

Rooms accept 2–8 players. The host starts a match; the server creates a fresh seed, selects the centralized map-size tier from the roster count, generates terrain/cities/units once, remaps owners to connection-bound player IDs, and sends each member a sanitized `PlayerView` through game-core `getPlayerView`. The seed, unexplored terrain, unseen enemy units, private economies and other players' exploration remain server-side. Territory snapshots preserve previously observed ownership. `MATCH_SEED` fixes generation for repeatable scenarios. `MATCH_SCENARIO=demo` opts two-player matches into the compact interaction fixture; larger matches still use normal world generation.

Validated game intents omit player identity and replacement states. The server checks membership and revision, supplies trusted identity, and calls `applyAction`. Accepted actions broadcast player-specific snapshots; invalid actions leave state unchanged. Captures transfer territory through the same city ownership transition. Every room has independent state.

Explicit departure ends an active match for all participants. Disconnected matches retain their authoritative state for a 60-second resume window; the private session token binds a new socket to the existing player and request history. Resume broadcasts the current snapshot without applying turn income. In a lobby, the earliest remaining member becomes host. Ping/pong heartbeats terminate dead connections. Malformed and binary messages are rejected; payloads exceeding 4 KiB close the connection. There are no accounts or persistence across server restarts.

Exploration is stored in the authoritative room state and survives socket resume. Opponent gameplay events are suppressed except public turn handoffs, preventing hidden paths or recruitment from leaking through action payloads. Visible opponent models update from sanitized snapshots.
