# Future authoritative server

Reserved for a Node.js WebSocket service. No server or multiplayer is implemented in this milestone.

The server will authenticate a player, validate room membership and action revision, call the shared game-core applyAction, and broadcast the resulting state. Client-supplied player IDs must never substitute for authenticated identity. Protocol types live in packages/protocol. Rendering and animation remain browser concerns.
