# Verdant Reach

An original browser strategy prototype: a miniature island with local pass-and-play or server-authoritative matches for 2-8 players, each with one warrior and two movement points per turn. All visuals are procedural Babylon geometry. No copied game assets are used.

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

`apps/web` owns React overlays and Babylon rendering. Input submits actions through core; accepted state is stored immediately while the renderer animates the accepted path for the unit ID. Movement, selection changes, resets and End Turn are locked during movement and combat animations. Handoffs clear selection and movement highlights. Visual positions, owner colors, camera motion and selection are presentation state. The local pass-and-play adapter submits as the active player; network matches instead submit intents using socket-bound identity and render server snapshots.

`packages/protocol` provides shared lobby and match messages with strict runtime validation of gameplay intents. `apps/server` owns one canonical GameState per room. Starting a match calls the existing seeded initialization for the lobby roster size, maps ownership to server-issued player IDs, and preserves join order for deterministic turns. Lobby colors remain presentation data.

Gameplay follows client intent -> WebSocket -> connection-derived player ID -> revision check -> game-core `applyAction` -> authoritative snapshot broadcast. Intents omit player identity and never contain replacement states. Malformed shapes, extra fields, identity claims, stale revisions and invalid rules are rejected before state replacement. The server reuses core rules for every action. The web client queues accepted snapshots and movement/combat animations in wire order, with no optimistic gameplay mutation. Input is locked during pending requests and animations; inactive clients cannot select or control the active player's assets.

## Multiplayer

Run `npm run dev` to start the web app and WebSocket server. Alternatively run `npm run dev:web` and `npm run dev:server` separately. Open two browser windows, open Multiplayer lobby, enter names, create a room in one window and join with its six-character code in the other. Only the host can Start game, with 2-8 connected players. Both clients switch to the same match; the current player moves, attacks, manages cities and ends their turn while everyone receives authoritative updates.

The web development server proxies `/lobby` to `ws://127.0.0.1:3001`. Set `VITE_LOBBY_URL` for a separately hosted WebSocket service; HTTPS pages need a `wss://` endpoint. The server binds to loopback by default. Matches use the reproducible `fern-104` seed and existing starting cities/warriors. Local pass-and-play remains available before starting a network match, and local restart/debug reseeding is blocked during a match.

Rooms have independent states. Late joins and duplicate starts are rejected. Leaving or disconnecting ends the match for all participants and deletes its state and memberships; clients can create or join another room. There is no reconnect/resume or persistence. Player identities are bound to live connections; accounts and authentication are outside this milestone.

Integration tests use real WebSockets to cover host authority, shared starts for two/eight players, movement/capture, combat/deaths, workers/population/upgrades, synchronized turns, invalid and malformed actions, revision checks, room isolation and disconnect cleanup. The multiplayer Playwright test uses independent browser contexts and real canvas clicks to verify movement by both players, worker assignment, combat and exact snapshot equality. Screenshots are saved as `test-results/multiplayer-host.png` and `test-results/multiplayer-guest.png`.

## Combat rules

Warriors have 10 max HP, 2 attack, 2 defense, range 1 and the existing two-point movement budget. `ATTACK_UNIT` includes playerId, unitId and targetId. Only an active owner with an unspent attack can target an orthogonally adjacent enemy. `getAttackTargets` and `previewCombat` live in game-core; the attack transition uses the same preview calculation.

Damage is `max(1, round(5 × attack × currentHP / maxHP / max(1, targetDefense)))`, capped at the target's remaining HP. A surviving defender retaliates with its post-hit HP if the attacker is in range. A dead defender never retaliates. Dead units leave authoritative state immediately; rendering plays the accepted attack, hit, death and advance effects before removing their models. A surviving melee killer advances onto the defeated tile when it is passable, even with no movement left. Attacking sets movement to zero and hasAttacked to true; only the owner's next turn resets both action availability and movement. HP never refills on turn handoff.

The board shows owner colors, HP labels, golden movement tiles and red attack targets. Combat confirmation can be canceled without changing game state. All gameplay input and resets remain locked through combat and movement animations. Empty armies display a restart prompt; turn order continues to follow the full player roster.

## Cities and economy

Players hold civilization-wide Gold, Food, Wood and Steel balances. Each city starts with three people and a level 1 Town Hall. Starting Warriors cost one population and retain their home-city association even after capture. Military population is the sum of surviving home-city units' population costs; civilian population is total population minus military population. Death removes that unit's population from its home city, without turning casualties into civilians. Capture retains Town Hall level, population and assignments; deployed units keep their original owner and home city.

All tuning lives in `economy` in game-core. Town Hall levels 1/2/3 cap population at 5/8/12 and generate 2/3/5 Gold per turn. Upgrades cost 4/8 Gold. Growing one civilian costs 4 Food. `GROW_POPULATION`, `ASSIGN_WORKER`, `UNASSIGN_WORKER` and `UPGRADE_TOWN_HALL` use `applyAction` with active-player and city-ownership validation. Invalid actions do not mutate state.

One civilian works one tile; assigned civilians remain civilians. Unassigned resource tiles produce nothing. Orchard/wheat/fishery produce 2/3/2 Food, forest produces 2 Wood and mine produces 2 Steel. Opportunities are deterministic overlays on the existing terrain: grass alternates orchard/wheat by coordinate parity, forests provide lumber, mountains provide metal and water provides fish. Working water and mountains does not change movement restrictions. City tiles have no resource opportunity. Each resource tile belongs to the nearest city within Manhattan distance 2, with lexical city ID breaking ties, regardless of ownership. This allocation stays stable through captures and prevents shared tile production.

Only the incoming player's cities produce on turn handoff. The first player receives starting Town Hall Gold on turn 1; all workers initially remain unassigned. Click a city to inspect population, Town Hall, available civilians and its resource list. Assign/remove controls mark worked tiles and show yields. Spend Food to grow or Gold to upgrade. Town Hall progression adds houses to the existing city model. If a selected warrior can reach a city, clicking moves as before; Escape deselects for city inspection. Animation blocks economy actions and handoff clears selection.

The worker list is the resource visualization for this milestone; dedicated orchard, fish and mine models are deferred. There are no Wood/Steel spending actions yet and no recruitment. The population costs and home-city model support future units with different costs. Tests cover production, caps, affordability, assignment validation, immutable rejection, casualties, deterministic multi-city/multi-player turns and a pointer-driven browser economy loop.

## City territory

`territoryRules.radius` centralizes the V1 radius (2). `getTerritory` and `getTileTerritory` in game-core derive city IDs and controlling player IDs from authoritative cities using Manhattan distance, with lexical city ID breaking equal-distance ties. City centers belong to themselves; tiles beyond the radius remain unclaimed. Neutral claims retain a city ID and a null player ID. Terrain does not block territory, so water and mountains can be claimed. Ownership changes through existing movement/combat actions transfer every tile of a captured city without storing duplicate ownership state. Town Hall levels do not affect territory.

Borders use flat geometry batched by shared owner material, with gray neutral boundaries. Adjacent claims with the same player owner omit their shared edge, including claims belonging to different cities. Selecting any city highlights just its own tiles in one extra geometry batch. Geometry only rebuilds when map, city ownership/positions or selection change. There are at most ten territory batches for eight players, neutral territory and selection; no territory materials or shadow casters are added.

Development snapshots expose `getTerritory`, `getTileTerritory` and `getTerritoryRenderStats`. Tests cover deterministic ownership, overlapping cities, radius limits, captures, neutral territory and multiple players; WebSocket and browser tests compare territory across clients and verify room isolation. The browser selection test checks bounded mesh counts and material reuse. To run alongside existing development servers, set `PLAYWRIGHT_BASE_URL` and `PLAYWRIGHT_SERVER_PORT` to unused local ports before `npm run test:e2e`.

Territory does not add or change resource opportunities, worker assignment rules, buildings or movement restrictions. Borders follow tile surfaces and can be partially occluded by existing trees, mountains and city models.

## Scope and limitations

This is a desktop-first strategy slice on a 20 x 20 map, with local two-player pass-and-play and network matches for 2-8 players. City locations are deterministic test positions rather than balanced procedural expansion placement, and distant cities are not guaranteed reachable for every terrain seed. There is no recruitment, siege, technology, accounts, persistence or fog of war. Existing empty-army restart messaging remains; cities do not create units or change victory rules. The Babylon bundle-size build warning remains nonblocking.
