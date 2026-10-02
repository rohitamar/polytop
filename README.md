# Verdant Reach

An original browser strategy prototype: a miniature island, one Sunward warrior, and two movement points. All visuals are procedural Babylon geometry. No copied game assets are used.

## Run

Requires Node.js 22.12+ and npm.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173. Click the warrior, then a golden tile. Right-drag to orbit, scroll to zoom, Escape to deselect. The compass reset restores the camera. Restart expedition restores the same map and movement budget.

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

`packages/game-core` owns deterministic seeded terrain generation, weighted shortest paths, occupancy and immutable state transitions. `applyAction(state, action)` returns a new state or throws for an illegal action. Cardinal movement uses Dijkstra traversal, allowing grass at cost 1 and forest at cost 2; mountains and water are impassable. The warrior starts with two points and accepted moves deduct their path cost.

`apps/web` owns React overlays and Babylon rendering. Input submits actions through core; accepted state is stored immediately while the renderer animates the accepted path. Input and resets are locked during movement. Visual positions are transient and never feed rule validation. Camera motion and selection are presentation state.

`packages/protocol` provides future request/revision and snapshot/rejection envelopes. `apps/server` reserves the Node.js authority boundary. No sockets or server runtime exist yet. Future authority should bind authenticated identity to actions, verify revisions, run core transitions and publish snapshots.

Development exposes `window.__GAME_DEBUG__`: `getState`, `getUnits`, `getTile`, `setSeed`, `getReachableTiles`, `getSelectedUnitId`, `getTileScreenPosition`, `getUnitScreenPosition`, `isAnimating`, `getVisualPosition`, `getMarkerCount`, and `getHoveredTile`. Returned state is cloned. `setSeed` resets the demo and refuses resets during animation. The API is absent in production builds.

## Scope and next milestone

This is a desktop-first local movement slice with a single placeholder warrior, a fixed 10×10 map, an expedition reset, and no turn loop. Health is a presentation placeholder. Multiplayer, combat, cities, resources, technology, accounts, matchmaking, persistence and fog of war are intentionally absent.

Next: add a tested two-player turn state machine and action ownership to core, then build a minimal authoritative Node/WebSocket room with invite codes, revision checks and reconnect snapshots. Expand toward 2–8 players after the two-client synchronization path is reliable.
