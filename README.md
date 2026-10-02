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

Game state holds an ordered player roster, activePlayerId, turnNumber and per-unit ownerId, movement and maxMovement. Existing `move` actions remain compatible. `{ type: 'END_TURN', playerId }` requires the active player's identity, advances to the next roster entry, increments revision and turnNumber, and refills only that player's units. Turn 1 is the initial player's turn; each handoff increments it, including wraparound. Inactive units can retain unspent points but cannot act. The second player's initial movement is zero until its first turn starts. Roster cycling is tested for 1, 2, 3 and 8 players; createGame(seed, playerCount) supports 2-8 deterministic starting positions and owner colors. The UI defaults to two players.

`apps/web` owns React overlays and Babylon rendering. Input submits actions through core; accepted state is stored immediately while the renderer animates the accepted path for the unit ID. Movement, selection changes, resets and End Turn are locked during movement and combat animations. Handoffs clear selection and movement highlights. Visual positions, owner colors, camera motion and selection are presentation state. The local pass-and-play adapter submits as the active player; a future server must instead bind actions to authenticated identity.

`packages/protocol` provides shared lobby messages and runtime validators, alongside future request/revision and snapshot/rejection envelopes. `apps/server` runs a Node/TypeScript WebSocket lobby service. Socket-bound identities, membership, capacity, colors and host assignment belong to the server. Gameplay requests are rejected by the lobby validator; no authoritative GameState is created or synchronized. Future authority should bind authenticated identity to actions, verify revisions, run core transitions and publish snapshots.

## Multiplayer lobby

Run `npm run dev` to start both the web app and lobby server. To run them separately, use `npm run dev:web` and `npm run dev:server` in two terminals. Open **Multiplayer lobby**, enter a player name, then create a room or join using its six-character code. Share the code with another browser client. All members receive live roster updates with distinct server-assigned IDs and colors; the first member is host. A room starts with its host alone while waiting for a second player and accepts up to eight players. The host badge moves to the earliest remaining member when the host leaves. Empty rooms are deleted.

Vite proxies `/lobby` to `ws://127.0.0.1:3001`. The server supports `PORT` and `HOST` environment variables; it binds to loopback by default. For a separately hosted frontend, set `VITE_LOBBY_URL` at build time to the lobby WebSocket URL, or configure a same-origin WebSocket reverse proxy at `/lobby`. Use `wss://` for an HTTPS frontend. `npm run start -w @reach/server` runs the TypeScript server without watch mode.

Rooms exist only in one server process's memory. Names are display labels, not accounts, and may repeat. Each connection receives a new identity on joining. Leaving, closing a browser, or losing the connection removes membership; silent dead connections are detected by a 15-second heartbeat, normally within 30 seconds. Rejoining is manual and does not restore the old identity or host status. There is no Start Game control or gameplay synchronization. The board remains the independent local demo. Authentication, rate limiting, multi-process coordination, persistence and deployment hardening remain outside this milestone.

Server integration tests use real WebSocket clients and cover room creation, joins, eight-player capacity, rejection of a ninth player, missing rooms, malformed and oversized payloads, host transfer and cleanup. Playwright starts both services and includes a two-browser lobby test that checks both rosters and disconnect handling.

Development exposes `window.__GAME_DEBUG__`: `getState`, `getActivePlayer`, `getTurnNumber`, `getUnits`, `getTile`, `setSeed`, `getReachableTiles`, `getSelectedUnitId`, `getTileScreenPosition`, `getUnitScreenPosition`, `isAnimating`, `getVisualPosition`, `getMarkerCount`, and `getHoveredTile`. Returned state is cloned. Reachability, unit screen coordinates and visual positions accept an optional unit ID, defaulting to the selected or active player's unit. `setSeed` resets the demo and refuses resets during animation. The API is absent in production builds. Browser tests cover both owners moving, enemy-control rejection, two handoffs, movement restoration and screenshots, alongside the original animation tests. A pointer-driven duel checks previews, cancellation, both owners attacking, retaliation, action locks, defender death, automatic advance, empty-army UI and restart. Set `PLAYWRIGHT_BASE_URL` to a localhost URL with a different port to test an isolated worktree.

## Combat rules

Warriors have 10 max HP, 2 attack, 2 defense, range 1 and the existing two-point movement budget. `ATTACK_UNIT` includes playerId, unitId and targetId. Only an active owner with an unspent attack can target an orthogonally adjacent enemy. `getAttackTargets` and `previewCombat` live in game-core; the attack transition uses the same preview calculation.

Damage is `max(1, round(5 × attack × currentHP / maxHP / max(1, targetDefense)))`, capped at the target's remaining HP. A surviving defender retaliates with its post-hit HP if the attacker is in range. A dead defender never retaliates. Dead units leave authoritative state immediately; rendering plays the accepted attack, hit, death and advance effects before removing their models. A surviving melee killer advances onto the defeated tile when it is passable, even with no movement left. Attacking sets movement to zero and hasAttacked to true; only the owner's next turn resets both action availability and movement. HP never refills on turn handoff.

The board shows owner colors, HP labels, golden movement tiles and red attack targets. Combat confirmation can be canceled without changing game state. All gameplay input and resets remain locked through combat and movement animations. Empty armies display a restart prompt; turn order continues to follow the full player roster.

## Cities and economy

Players hold civilization-wide Gold, Food, Wood and Steel balances. Each city starts with three people and a level 1 Town Hall. Starting Warriors cost one population and retain their home-city association even after capture. Military population is the sum of surviving home-city units' population costs; civilian population is total population minus military population. Death removes that unit's population from its home city, without turning casualties into civilians. Capture retains Town Hall level, population and assignments; deployed units keep their original owner and home city.

All tuning lives in `economy` in game-core. Town Hall levels 1/2/3 cap population at 5/8/12 and generate 2/3/5 Gold per turn. Upgrades cost 4/8 Gold. Growing one civilian costs 4 Food. `GROW_POPULATION`, `ASSIGN_WORKER`, `UNASSIGN_WORKER` and `UPGRADE_TOWN_HALL` use `applyAction` with active-player and city-ownership validation. Invalid actions do not mutate state.

One civilian works one tile; assigned civilians remain civilians. Unassigned resource tiles produce nothing. Orchard/wheat/fishery produce 2/3/2 Food, forest produces 2 Wood and mine produces 2 Steel. Opportunities are deterministic overlays on the existing terrain: grass alternates orchard/wheat by coordinate parity, forests provide lumber, mountains provide metal and water provides fish. Working water and mountains does not change movement restrictions. City tiles have no resource opportunity. Each resource tile belongs to the nearest city within Manhattan distance 2, with lexical city ID breaking ties, regardless of ownership. This allocation stays stable through captures and prevents shared tile production.

Only the incoming player's cities produce on turn handoff. The first player receives starting Town Hall Gold on turn 1; all workers initially remain unassigned. Click a city to inspect population, Town Hall, available civilians and its resource list. Assign/remove controls mark worked tiles and show yields. Spend Food to grow or Gold to upgrade. Town Hall progression adds houses to the existing city model. If a selected warrior can reach a city, clicking moves as before; Escape deselects for city inspection. Animation blocks economy actions and handoff clears selection.

The worker list is the resource visualization for this milestone; dedicated orchard, fish and mine models are deferred. There are no Wood/Steel spending actions yet and no recruitment or gameplay synchronization. The population costs and home-city model support future units with different costs. Tests cover production, caps, affordability, assignment validation, immutable rejection, casualties, deterministic multi-city/multi-player turns and a pointer-driven browser economy loop.

## Scope and limitations

This is a desktop-first local pass-and-play slice on a 20 x 20 map. The core setup supports 2-8 players; the UI launches two. City locations are deterministic test positions rather than balanced procedural expansion placement, and distant cities are not guaranteed reachable for every terrain seed. There is no recruitment, siege, technology, multiplayer, accounts, persistence or fog of war. Existing empty-army restart messaging remains; cities do not create units or change victory rules. The Babylon bundle-size build warning remains nonblocking.
