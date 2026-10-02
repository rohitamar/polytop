# Verdant Reach

An original browser strategy prototype: a miniature island and two companies taking turns, each with one warrior and two movement points per turn. All visuals are procedural Babylon geometry. No copied game assets are used.

## Run

Requires Node.js 22.12+ and npm.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173. Sunward (orange) goes first; select its warrior, then a golden tile. End Turn passes control to Tideward (blue). Click an adjacent enemy on a red target tile to review the combat preview, then confirm Attack. Moving before attacking is allowed, and attacking finishes that warrior's actions. A warrior refills when its owner's next turn begins. Inactive warriors cannot be controlled. Right-drag to orbit, scroll to zoom, Escape to deselect. The compass reset restores the camera. Restart expedition restores the same map, positions and turn 1.

## Verify

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npx playwright show-report
```

Playwright starts the application automatically. Tests click actual canvas coordinates, check state and animation through the debug API, and capture selected/moved screenshots under `test-results`. The HTML report includes an attached final screenshot and traces on failures.

In restricted environments, use `npm install --cache .npm-cache`. Set `PLAYWRIGHT_BROWSERS_PATH` to a writable location consistently for browser install and tests if the default browser cache is unavailable.

## Architecture

`packages/game-core` owns deterministic seeded terrain generation, weighted shortest paths, occupancy, ownership, turn validation and immutable state transitions. `applyAction(state, action)` returns a new state or throws for an illegal action without partial mutation. Cardinal movement uses Dijkstra traversal, allowing grass at cost 1 and forest at cost 2; mountains and water are impassable. Accepted moves deduct their path cost.

Game state holds an ordered player roster, activePlayerId, turnNumber and per-unit ownerId, movement and maxMovement. Existing `move` actions remain compatible. `{ type: 'END_TURN', playerId }` requires the active player's identity, advances to the next roster entry, increments revision and turnNumber, and refills only that player's units. Turn 1 is the initial player's turn; each handoff increments it, including wraparound. Inactive units can retain unspent points but cannot act. The second player's initial movement is zero until its first turn starts. Roster cycling is tested for 1, 2, 3 and 8 players; the scenario and visual palette are currently for two.

`apps/web` owns React overlays and Babylon rendering. Input submits actions through core; accepted state is stored immediately while the renderer animates the accepted path for the unit ID. Movement, selection changes, resets and End Turn are locked during movement and combat animations. Handoffs clear selection and movement highlights. Visual positions, owner colors, camera motion and selection are presentation state. The local pass-and-play adapter submits as the active player; a future server must instead bind actions to authenticated identity.

`packages/protocol` provides shared lobby messages and runtime validators, alongside future request/revision and snapshot/rejection envelopes. `apps/server` runs a Node/TypeScript WebSocket lobby service. Socket-bound identities, membership, capacity, colors and host assignment belong to the server. Gameplay requests are rejected by the lobby validator; no authoritative GameState is created or synchronized. Future authority should bind authenticated identity to actions, verify revisions, run core transitions and publish snapshots.

## Multiplayer lobby

Run `npm run dev:server` in a second terminal alongside `npm run dev`. Open **Multiplayer lobby**, enter a player name, then create a room or join using its six-character code. Share the code with another browser client. All members receive live roster updates with distinct server-assigned IDs and colors; the first member is host. A room starts with its host alone while waiting for a second player and accepts up to eight players. The host badge moves to the earliest remaining member when the host leaves. Empty rooms are deleted.

Vite proxies `/lobby` to `ws://127.0.0.1:3001`. The server supports `PORT` and `HOST` environment variables; it binds to loopback by default. For a separately hosted frontend, set `VITE_LOBBY_URL` at build time to the lobby WebSocket URL, or configure a same-origin WebSocket reverse proxy at `/lobby`. Use `wss://` for an HTTPS frontend. `npm run start -w @reach/server` runs the TypeScript server without watch mode.

Rooms exist only in one server process's memory. Names are display labels, not accounts, and may repeat. Each connection receives a new identity on joining. Leaving, closing a browser, or losing the connection removes membership; silent dead connections are detected by a 15-second heartbeat, normally within 30 seconds. Rejoining is manual and does not restore the old identity or host status. There is no Start Game control or gameplay synchronization. The board remains the independent local demo. Authentication, rate limiting, multi-process coordination, persistence and deployment hardening remain outside this milestone.

Server integration tests use real WebSocket clients and cover room creation, joins, eight-player capacity, rejection of a ninth player, missing rooms, malformed and oversized payloads, host transfer and cleanup. Playwright starts both services and includes a two-browser lobby test that checks both rosters and disconnect handling.

Development exposes `window.__GAME_DEBUG__`: `getState`, `getActivePlayer`, `getTurnNumber`, `getUnits`, `getTile`, `setSeed`, `getReachableTiles`, `getSelectedUnitId`, `getTileScreenPosition`, `getUnitScreenPosition`, `isAnimating`, `getVisualPosition`, `getMarkerCount`, and `getHoveredTile`. Returned state is cloned. Reachability, unit screen coordinates and visual positions accept an optional unit ID, defaulting to the selected or active player's unit. `setSeed` resets the demo and refuses resets during animation. The API is absent in production builds. Browser tests cover both owners moving, enemy-control rejection, two handoffs, movement restoration and screenshots, alongside the original animation tests. A pointer-driven duel checks previews, cancellation, both owners attacking, retaliation, action locks, defender death, automatic advance, empty-army UI and restart. Set `PLAYWRIGHT_BASE_URL` to a localhost URL with a different port to test an isolated worktree.

## Combat rules

Warriors have 10 max HP, 2 attack, 2 defense, range 1 and the existing two-point movement budget. `ATTACK_UNIT` includes playerId, unitId and targetId. Only an active owner with an unspent attack can target an orthogonally adjacent enemy. `getAttackTargets` and `previewCombat` live in game-core; the attack transition uses the same preview calculation.

Damage is `max(1, round(5 × attack × currentHP / maxHP / max(1, targetDefense)))`, capped at the target's remaining HP. A surviving defender retaliates with its post-hit HP if the attacker is in range. A dead defender never retaliates. Dead units leave authoritative state immediately; rendering plays the accepted attack, hit, death and advance effects before removing their models. A surviving melee killer advances onto the defeated tile when it is passable, even with no movement left. Attacking sets movement to zero and hasAttacked to true; only the owner's next turn resets both action availability and movement. HP never refills on turn handoff.

The board shows owner colors, HP labels, golden movement tiles and red attack targets. Combat confirmation can be canceled without changing game state. All gameplay input and resets remain locked through combat and movement animations. Empty armies display a restart prompt; turn order continues to follow the full player roster.

## Scope and next milestone

This is a desktop-first local pass-and-play slice with two placeholder warriors, a 20×20 map (400 tiles), and an expedition reset, plus a separate 2–8 player multiplayer lobby. Health, melee combat and retaliation are deterministic rules. Synchronized gameplay, cities, resources, technology, accounts, matchmaking, persistence and fog of war are intentionally absent. The existing Babylon bundle-size build warning remains nonblocking.

Future work can add authenticated, revision-checked gameplay actions through the server and shared game-core. This milestone stops at rooms and lobby membership.
