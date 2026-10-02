# Project invariants

- Do not add comments or docstrings to code unless explicitly requested by the user.
- `packages/game-core` is pure TypeScript with no rendering, networking, DOM, React, Babylon, or server dependencies.
- State transitions and map generation are deterministic. Inject seeds; never use time or Math.random in game rules.
- `applyAction` is the only gameplay transition boundary. Invalid actions throw without changing the input state.
- Rendering reads state and animates accepted paths. Never move rule validation into scene code.
- Preserve future server authority: a server can run game-core unchanged. Authentication, player identity, revision checks and broadcasts belong in the future server.
- Clients will submit actions, never replacement authoritative states. Ownership and active-turn validation belong in game-core, including END_TURN.
- Turn numbers start at 1 and advance on each player handoff, not each complete round. Player array order defines the deterministic cycle.
- Only incoming-player units refill to maxMovement. Inactive units may retain unspent movement but cannot act or produce legal movement highlights.
- Selection uses unit IDs. Clear it on turn handoff; block movement, resets, selection changes and End Turn during animation. Presentation colors stay outside game-core.
- New gameplay rules need unit tests. Use debug snapshots to assert canvas game state in Playwright; exercise real pointer interactions.
- Keep dependencies minimal. This milestone excludes multiplayer, combat, cities, economy, progression, accounts, persistence and fog of war.
- Debug tools are development-only; production behavior must never depend on them.

# Commands

- `npm install`
- `npm run dev` — http://127.0.0.1:5173
- `npm run build` — TypeScript validation and production web build
- `npm test` — game-core unit tests
- `npx playwright install chromium` — browser setup
- `npm run test:e2e` — starts Vite if needed, runs browser tests, captures screenshots
- `npx playwright show-report` — inspect browser report and attachments

# Layout

- `apps/web/src/main.tsx`: React application, client state/action adapter, development debug API.
- `apps/web/src/world.ts`: Babylon scene, camera, picking and transient animation.
- `packages/game-core/src/index.ts`: seeded generation, weighted shortest paths and immutable actions.
- `packages/protocol/src/index.ts`: future transport envelope types only.
- `apps/server`: reserved Node.js service boundary, no runtime yet.

Movement is orthogonal and spends each warrior's two-point turn budget. Grass costs one, forest two, water and mountains block passage. The default scenario has two local players with one warrior each. END_TURN goes through applyAction; restart resets the entire demo to turn 1. Tests should use the known seed `fern-104` for screenshots. Debug unit helpers take an optional unit ID and default to the selected or active player's unit. Screen positions are CSS viewport coordinates.
