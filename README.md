# Verdant Reach

An original browser strategy prototype: a miniature island with local pass-and-play or server-authoritative matches for 2-8 players, each with one starting Warrior. All visuals are procedural Babylon geometry. No copied game assets are used.

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

`packages/game-core` owns deterministic seeded terrain generation, weighted shortest paths, occupancy, ownership, turn validation and immutable state transitions. `applyAction(state, action)` returns a new state or throws for an illegal action without partial mutation. Cardinal movement uses Dijkstra traversal, allowing grass and forest at cost 1, or connected road edges at cost 0.5; mountains require Climbing and water requires naval units. Accepted moves deduct their path cost.

Game state holds an ordered player roster, activePlayerId, turnNumber and per-unit ownerId, movement and maxMovement. Existing `move` actions remain compatible. `{ type: 'END_TURN', playerId }` requires the active player's identity, advances to the next roster entry, increments revision and turnNumber, and refills only that player's units. Turn 1 is the initial player's turn; each handoff increments it, including wraparound. Inactive units can retain unspent points but cannot act. The second player's initial movement is zero until its first turn starts. Roster cycling is tested for 1, 2, 3 and 8 players; createGame(seed, playerCount) supports 2-8 deterministic starting positions and owner colors. The UI defaults to two players.

`apps/web` owns React overlays and Babylon rendering. Input submits actions through core; accepted state is stored immediately while the renderer animates the accepted path for the unit ID. Movement, selection changes, resets and End Turn are locked during movement and combat animations. Handoffs clear selection and movement highlights. Visual positions, owner colors, camera motion and selection are presentation state. The local pass-and-play adapter submits as the active player; network matches instead submit intents using socket-bound identity and render server snapshots.

`packages/protocol` provides shared lobby and match messages with strict runtime validation of gameplay intents. `apps/server` owns one canonical GameState per room. Starting a match calls the existing seeded initialization for the lobby roster size, maps ownership to server-issued player IDs, and preserves join order for deterministic turns. Lobby colors remain presentation data.

Gameplay follows client intent -> WebSocket -> connection-derived player ID -> revision check -> game-core `applyAction` -> player-specific snapshot broadcast. Intents omit player identity and never contain replacement states. Malformed shapes, extra fields, identity claims, stale revisions and invalid rules are rejected before state replacement. The server reuses core rules for every action. The web client queues accepted snapshots and movement/combat animations in wire order, with no optimistic gameplay mutation. Input is locked during pending requests and animations; inactive clients cannot select or control the active player's assets.

## Multiplayer

Run `npm run dev` to start the web app and WebSocket server. Alternatively run `npm run dev:web` and `npm run dev:server` separately. Open two browser windows, open Multiplayer lobby, enter names, create a room in one window and join with its six-character code in the other. Only the host can Start game, with 2-8 connected players. Both clients switch to the same match; the current player moves, attacks, manages cities and ends their turn while everyone receives authoritative updates.

The web development server proxies `/lobby` to `ws://127.0.0.1:3001`. Set `VITE_LOBBY_URL` for a separately hosted WebSocket service; HTTPS pages need a `wss://` endpoint. The server binds to loopback by default. The authoritative server chooses a fresh seed and the map dimensions for each match, then sends each participant a sanitized player view. The map seed remains server-side. Set `MATCH_SEED` for reproducible server scenarios; `MATCH_SCENARIO=demo` explicitly selects the compact two-player interaction fixture. Normal matches use spread-out procedural starts. Local pass-and-play remains available before starting a network match, and local restart/debug reseeding is blocked during a match.

Rooms have independent states. Late joins and duplicate starts are rejected. Explicit departure ends the match for all participants. Disconnected players have 60 seconds to resume using their private browser session token. Resume restores the stored snapshot and request history; a replacement socket revokes the previous connection. Persistence and accounts remain outside this milestone.

Integration tests use real WebSockets to cover host authority, shared starts for two/eight players, movement/capture, combat/deaths, Gold income, population development and city rewards, synchronized turns, invalid and malformed actions, revision checks, room isolation and disconnect cleanup. The multiplayer Playwright test uses independent browser contexts and real canvas clicks to verify movement by both players, automatic income, combat and synchronized revisions with independent player views. Screenshots are saved as `test-results/multiplayer-host.png` and `test-results/multiplayer-guest.png`.

## Combat rules

Warriors have 10 max HP, 2 attack, 2 defense, range 1 and a one-point movement budget. `ATTACK_UNIT` includes playerId, unitId and targetId. Only an active owner with an unspent attack can target an orthogonally adjacent enemy. `getAttackTargets` and `previewCombat` live in game-core; the attack transition uses the same preview calculation.

Damage is `max(1, round(5 × attack × currentHP / maxHP / max(1, targetDefense)))`, capped at the target's remaining HP. A surviving defender retaliates with its post-hit HP if the attacker is in range. A dead defender never retaliates. Dead units leave authoritative state immediately; rendering plays the accepted attack, hit, death and advance effects before removing their models. A surviving melee killer advances onto the defeated tile when it is passable, even with no movement left. Attacking sets movement to zero and hasAttacked to true; only the owner's next turn resets both action availability and movement. HP never refills on turn handoff.

The board shows owner colors, HP labels, golden movement tiles and red attack targets. Combat confirmation can be canceled without changing game state. All gameplay input and resets remain locked through combat and movement animations. Empty armies display a restart prompt; turn order continues to follow the full player roster.

## Population economy and technologies

Gold is the only currency. Players start with 5 Gold; city income is its level plus original-capital, Workshop and Park bonuses, paid on subsequent incoming turns. Population grows cities rather than paying Gold when a unit walks onto a resource. A level-L city needs L+1 additional population and offers a reward choice when it levels. City levels are not capped at three. Each city independently supports level+1 units, with one slot per unit.

Select an owned tile to harvest fruit, hunt animals, harvest fish or build Farms, Lumber Huts, Mines, Sawmills and Forges. Units are not needed for development. Forestry also permits clearing undeveloped forests for Gold. Roads connect cities for population and unlock Bridges; Ports supply population and water access. Organization reveals crops, Climbing reveals metal, and Fishing reveals Starfish. Buildings and harvesting require their technologies and sufficient Gold, with immutable authoritative validation.

The 16 retained technologies are implemented. Aquatism, Construction, Diplomacy and Spiritualism are removed. Farming and Strategy follow Organization; Forestry and Archery follow Hunting; Mathematics follows Forestry; Sailing and Ramming follow Fishing; Navigation follows Sailing; Mining follows Climbing; Smithery follows Mining; Roads follows Riding. Research prices remain `4 + tier * current owned city count`.

Fishing enables Rafts through friendly Ports, Sailing enables Scouts and deep ocean travel, Ramming enables Rammers, and Navigation enables Bombers and Starfish harvesting. Giants embark as Juggernauts. Ships preserve their passenger's health and home city; landing restores the original land unit. Upgrading consumes Gold and the unit's turn. Naval combat uses centralized stats and generic Dash, Stiff, Splash and Stomp abilities.

Archery and Climbing add forest and mountain defense bonuses. City Walls strengthen the shared Fortify bonus. Strategy enables peace offers, acceptance and breaking treaties. The HUD distinguishes city growth from unit support slots, and the development panel explains costs, population and eligibility.

See [population economy](docs/population-economy.md) for costs, rewards, buildings, connections, naval mechanics and retained Polytop conventions. The WebSocket server binds actions to socket identity, validates revisions and request IDs, runs `applyAction`, and sends independent fog-filtered views. Reloads resume the same state within 60 seconds, without replaying income or accepted actions. Matches remain memory-only.

## City territory

`territoryRules.radius` centralizes the initial radius (1). `getTerritory` and `getTileTerritory` in game-core derive city IDs and controlling player IDs from authoritative cities using square Chebyshev distance, with lexical city ID breaking equal-distance ties. City centers belong to themselves; tiles beyond the radius remain unclaimed. Neutral claims retain a city ID and a null player ID. Terrain does not block territory, so water and mountains can be claimed. Ownership changes through existing movement/combat actions transfer every tile of a captured city without storing duplicate ownership state. The level-4 Border Growth reward expands the square radius to 2.

Borders use flat geometry batched by shared owner material, with gray neutral boundaries. Adjacent claims with the same player owner omit their shared edge, including claims belonging to different cities. Selecting any city highlights just its own tiles in one extra geometry batch. Geometry only rebuilds when map, city ownership/positions or selection change. There are at most ten territory batches for eight players, neutral territory and selection; no territory materials or shadow casters are added.

Development snapshots expose `getTerritory`, `getTileTerritory` and `getTerritoryRenderStats`. Tests cover deterministic ownership, overlapping cities, radius limits, captures, neutral territory and multiple players; WebSocket and browser tests compare territory across clients and verify room isolation. The browser selection test checks bounded mesh counts and material reuse. To run alongside existing development servers, set `PLAYWRIGHT_BASE_URL` and `PLAYWRIGHT_SERVER_PORT` to unused local ports before `npm run test:e2e`.

Territory identifies city control; resource collection belongs to the collecting unit owner regardless of territorial claims. Borders follow tile surfaces and can be partially occluded by existing trees, mountains and city models.

## Scope and limitations

This is a desktop-first strategy slice with a compact local two-player demo and scalable network matches for 2-8 players. All generated city centers are connected by passable land. Start neighborhoods retain usable land and nearby forests, but geography and travel distances beyond them are not competitively balanced. There is no siege, accounts or persistence across server restarts. Owned cities can recruit units even when their owner has no army. The Babylon bundle-size build warning remains nonblocking.

## Technologies

Technology definitions provide stable IDs, tiers and descriptions. `getTechnologyCost` calculates current Gold prices from authoritative city ownership. Mining requires Climbing. `getTechnologyUnlockReason` and `canUnlockTechnology` share purchase rules between core and UI, while `hasTechnology` supports terrain, mineral exploitation and recruitment. All purchases pass through `applyAction`; full snapshots preserve separate player unlocks. The technology panel displays costs, prerequisites, descriptions and purchase restrictions, and local restart resets unlocks.

## Recruitment

Select an owned city and open Recruit units. `packages/game-core/src/units.ts` centralizes the complete land roster and its stats, technology requirements, costs and abilities. Warrior, Rider, Archer, Defender, Swordsman and Catapult are normal recruits; Giants are level-5-and-later city rewards. See [core land units](docs/land-units.md).

Recruitment requires the current turn, city ownership, technology, enough Gold, a free support slot in that city and an empty passable city center. `getRecruitmentReason`, `canRecruitUnit` and `getRecruitSpawn` share eligibility and placement between rules and UI. New units retain their home city, and casualties free support slots.

`RECRUIT_UNIT` carries only `cityId` and `unitType` through the existing revisioned `GAME_ACTION` envelope. The server binds socket identity, checks the revision, and runs `applyAction` before broadcasting the full state. Invalid actions are immutable. Same-revision racing requests cannot both commit, and accepted recruitment request IDs are recorded per participant to reject replay even with a newer revision. Newly recruited units have zero movement and their action spent until their next owner turn. Movement, ranged combat, death, selection, rendering and synchronization use the existing unit mechanics. Restarting resets the local roster, economy and technologies. Recruitment panels scroll when expanded on constrained screens.

## Roads

Research Riding followed by Tier 2 Roads, choose Build Roads, select a map tile, and confirm Build Road for 3 Gold. Placement is allowed on friendly or neutral Grass/Forest, including neutral links between territories. Enemy land, Mountains, Water, existing segments and city endpoints are rejected without spending. Roads do not claim territory and have no builder ownership. Connected road-to-road or road-to-city edges cost 0.5 movement for any legally entering land unit. Other edges cost normal terrain movement; Town Halls need no road graphic. Water is shared navigable space for Rafts regardless of visual territory ownership.

`BUILD_ROAD` sends only a tile intent. Core validates turn, Roads, land, territory, occupancy of existing infrastructure and Gold; the existing server revision and request-ID checks prevent stale or repeated spending. Complete snapshots carry roads along with technologies, units, Gold and depleted resources to all clients and resumed sessions.

## Scalable world generation

`mapSizes` in `packages/game-core/src/world.ts` centralizes match sizes: 2 players use 20×20, 3–4 use 24×24, 5–6 use 28×28, and 7–8 use 30×30. The server calls `createGame` with its room roster size; clients receive authoritative tiles and city locations rather than regenerating worlds. Seeds are created by the server and kept private from player views. Territory is derived from those same city snapshots, so captures require no second ownership broadcast.

`terrainRules` centralizes Perlin elevation scale and terrain coverage. Seeded gradient Perlin noise, with a smaller detail octave, ranks tiles by elevation: the lowest tiles become ponds/lakes and mountains use independent seeded rolls on remaining land. Water and ocean combined, mountains and forests each cover 13.33% of the entire board, rounded to whole tiles and balanced after city protection. There is no forced island outline or surrounding ocean. Forests use a seeded shuffle to spread individual tiles across the board, preferring tiles without orthogonally adjacent forests while preserving the configured whole-board coverage. Player starts favor existing suitable land and remain separated; required connections prefer passable land. The four immediate start neighbors remain passable, while mountains carry metal deposits that require Climbing to discover and Mining to develop. Start protection and connections happen before coverage is balanced again, preserving city routes and safe neighborhoods. Resource opportunities use independent seeded rolls rather than a second clustering field. City neighborhoods retain the minimum opportunity/agricultural safeguards.

`createGame(seed, playerCount, { width, height, terrain })` supports rectangular worlds and terrain tuning. Dimensions must be integers from 10 to 128 and leave enough interior room for cities. The explicit `scenario: "demo"` preserves the compact 20×20 two-player interaction fixture; normal generation has no hardcoded starting coordinates. Local pass-and-play continues to use that fixture.

Development-only `setWorld(seed, playerCount, dimensions?)` previews larger or rectangular boards without replacing a network match. `getState`, `getTile`, `getTileTerritory`, `getTerritory`, and `getTerritoryRenderStats` expose dimensions, seed, terrain, city claims, player claims and border build counts. Hover does not rebuild territory. Border materials remain shared, static matrices and terrain instances remain batched, and camera framing and clipping derive from dimensions.

`npm test` includes generation determinism, size tiers, rectangular movement, safe starts, city reachability across seeds, terrain coherence, and real WebSocket tests for 2/4/6/8-player authoritative worlds and independent room seeds. `npm run test:e2e` adds eight-player capture with two rendered browser clients and six WebSocket clients, checking state and territory equality across all eight participants and actual city selection. Run `node scripts/profile-worlds.mjs` against a development web server to compare the 20×20 and 30×30 scenes; see `docs/scene-performance.md` for measurements.

## Fog of war

Each unit reveals its tile and cardinal neighbors (Manhattan radius 1); owned cities reveal Manhattan radius 2. Unit definitions can override `visionRadius`. Terrain does not block sight. `applyAction` centrally recalculates vision and stores exploration for every player, including tiles revealed along accepted movement paths.

`GameState.exploration[playerId]` contains serializable `visibleTiles` and `exploredTiles` arrays plus remembered tile, city and territory snapshots. Exploration only grows. Terrain, resources, improvements, city levels and ownership stop updating when unseen; last-seen enemy units are remembered until the authoritative unit moves or is removed. JSON serialization preserves this memory, and the existing 60-second WebSocket resume window retains it in the room's authoritative state.

`getPlayerView` produces the presentation and network state. Unexplored tile objects are omitted, enemy units require current vision, enemy economy/technologies are redacted, and only the requesting player's exploration is included. The seed is withheld to prevent reconstructing hidden terrain. Enemy action events are suppressed, so visible enemy units update directly from snapshots without exposing a hidden movement path. Local play retains a separate authoritative state and switches its sanitized view on handoff; network clients keep their own perspective even during another player's turn. Development snapshots expose the same sanitized view.

Babylon draws unexplored cells in a single opaque fog geometry batch. Remembered terrain, cities and improvements reuse darkened/desaturated materials. Models leaving vision are removed during snapshot updates; visibility calculations never run in the render loop. Hidden tiles provide no inspection panels or hover metadata. Roads, Ports and attacks require current vision. Movement highlights use remembered information and an optimistic terrain assumption for unknown tiles; the authoritative rules can reject blocked routes without revealing the hidden object. Players can continue exploring by choosing another route.

The server still exposes public turn order and revisions, so opponents can observe that an action occurred without its private details. There is no durable save system yet; fog survives reconnect within the existing room lifetime, not a server restart. Visible enemies show their combat stats, while their home city and action availability remain private. Historical enemy city ownership may be stale until rediscovered.
