# Verdant Reach

An original browser strategy prototype: a miniature island and two companies taking turns, each with one warrior and two movement points per turn. All visuals are procedural Babylon geometry. No copied game assets are used.

## Run

Requires Node.js 22.12+ and npm.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173. Sunward (orange) goes first; select its warrior, then a golden tile. End Turn passes control to Tideward (blue). A warrior refills when its owner's next turn begins. Inactive warriors cannot be controlled. Right-drag to orbit, scroll to zoom, Escape to deselect. The compass reset restores the camera. Restart expedition restores the same map, positions and turn 1.

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

`apps/web` owns React overlays and Babylon rendering. Input submits actions through core; accepted state is stored immediately while the renderer animates the accepted path for the unit ID. Movement, selection changes, resets and End Turn are locked during movement animation. Handoffs clear selection and movement highlights. Visual positions, owner colors, camera motion and selection are presentation state. The local pass-and-play adapter submits as the active player; a future server must instead bind actions to authenticated identity.

`packages/protocol` provides future request/revision and snapshot/rejection envelopes. `apps/server` reserves the Node.js authority boundary. No sockets or server runtime exist yet. Future authority should bind authenticated identity to actions, verify revisions, run core transitions and publish snapshots.

Development exposes `window.__GAME_DEBUG__`: `getState`, `getActivePlayer`, `getTurnNumber`, `getUnits`, `getTile`, `setSeed`, `getReachableTiles`, `getSelectedUnitId`, `getTileScreenPosition`, `getUnitScreenPosition`, `isAnimating`, `getVisualPosition`, `getMarkerCount`, and `getHoveredTile`. Returned state is cloned. Reachability, unit screen coordinates and visual positions accept an optional unit ID, defaulting to the selected or active player's unit. `setSeed` resets the demo and refuses resets during animation. The API is absent in production builds. Browser tests cover both owners moving, enemy-control rejection, two handoffs, movement restoration and screenshots, alongside the original animation tests.

## Scope and next milestone

This is a desktop-first local pass-and-play slice with two placeholder warriors, a fixed 10×10 map, and an expedition reset. Health is a presentation placeholder. Multiplayer, combat, cities, resources, technology, accounts, matchmaking, persistence and fog of war are intentionally absent. The existing Babylon bundle-size build warning remains nonblocking.

Next: build a minimal authoritative Node/WebSocket room with invite codes and revision-checked actions. Expand toward 2–8 players after two-client synchronization is reliable. No networking or reconnection logic is implemented in this milestone.
