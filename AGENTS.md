# Project invariants

- Do not add comments or docstrings to code unless explicitly requested by the user.
- `packages/game-core` is pure TypeScript with no rendering, networking, DOM, React, Babylon, or server dependencies.
- State transitions and map generation are deterministic. Inject seeds; never use time or Math.random in game rules.
- `applyAction` is the only gameplay transition boundary. Invalid actions throw without changing the input state.
- Rendering reads state and animates accepted paths. Never move rule validation into scene code.
- Preserve future server authority: a server can run game-core unchanged. Authentication, player identity, revision checks and broadcasts belong in the future server.
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

Movement is orthogonal and spends the two-point expedition budget. Grass costs one, forest two, water and mountains block passage. Reset is a demo lifecycle operation, not a turn system. Tests should use the known seed `fern-104` for screenshots. Screen positions from the debug API are CSS viewport coordinates.
