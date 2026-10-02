# Scene profiling

Measured on Chromium with ANGLE Vulkan SwiftShader (software rendering), 1440×1000 CSS viewport, seed `fern-104`, 20×20 map. Five-second warmup followed by five-second idle and selected samples; hover uses 100 real pointer moves. These are local software-renderer results, not a prediction of hardware GPU FPS. Frame intervals include scheduling and GPU backpressure; CPU time measures `scene.render()` submission. Draw calls include shadow and blur passes. No resolution, geometry, colors, lighting strength, shadow resolution, or blur quality was reduced.

| Metric (mean) | Before idle | After idle | Before selected | After selected |
| --- | ---: | ---: | ---: | ---: |
| Active meshes | 1500 | 1500 | 1524 | 1524 |
| Draw calls/frame | 2756 | 322 | 2780 | 346 |
| CPU render time (ms) | 8.27 | 3.71 | 10.70 | 4.23 |
| Frame interval (ms) | 100.19 | 46.08 | 122.23 | 48.27 |
| Effective FPS | 9.98 | 21.70 | 8.18 | 20.72 |
| Frame interval p95 (ms) | 103.50 | 56.50 | 130.70 | 57.70 |

Hover frame interval: 103.03 → 47.89 ms; CPU render time: 8.09 → 3.90 ms. Picking: 100 calls before and after, mean 0.478 → 0.582 ms, p95 0.60 → 1.00 ms. Picking did not improve and is a minor cost relative to frame intervals. Babylon lazily generates pointer picks; using `info.pickInfo` reuses the event result rather than explicitly requesting another pick. A move predicate preserves hover on all pickable terrain and unit meshes.

React renders: zero while idle or selected, 42 across the 100-move hover sweep, both before and after. Scene rebuilds and updates: zero during each sample. Render loops: exactly one. Total scene meshes: 1502 idle and 1524 selected, unchanged; material count: 41, unchanged. Materials were already shared. Instances retain individual transforms and picking metadata while sharing geometry and hardware draw batches. Transparent ripples remain separate to preserve alpha ordering.

The biggest measured cost was redundant shadow generation and blur, with mesh submission a secondary bottleneck. An intermediate run using instances and frozen static matrices alone reduced idle draws to 400 and CPU time to 5.26 ms, but frame interval remained 118.31 ms. Adding shadow caching reduced interval to 46.08 ms. This isolates shadow work as the dominant measured cost; draw-call reduction alone did not improve FPS on SwiftShader. Exact GPU execution timings were not available; the conclusion is based on controlled removal of redundant work and wall-clock frame intervals.

The shadow texture now refreshes for map/state changes, movement and combat, camera angle/zoom/resize changes, and the final frame after animation. Selection pulse and the continuous render loop remain intact. Static terrain matrices are frozen; map rebuilding tracks newly created meshes directly instead of scanning all scene meshes for each tile. Game initialization is lazy in React, and unchanged HP labels no longer upload textures on selection/turn updates.

Raw samples are in `scene-profile-before.json` and `scene-profile-after.json`. The development-only `window.__GAME_DEBUG__.getProfile()` and `resetProfile()` expose bounded frame/pick samples, React render counts, mesh/material counts, rebuild/update counts, and loop count. Production gameplay does not depend on these measurements.

To repeat, start `npm run dev:web -- --strictPort --port 5183`, then run `node scripts/profile-scene.mjs after`. Set `PLAYWRIGHT_BASE_URL` for another port. The script writes JSON and screenshots to the current directory. Run benchmarks separately from browser tests to avoid competing software GPU workloads. All gameplay decisions remain in game-core.

## Economy integration verification

The economy was committed as `3df6148`, profiling as `a5b238f`, and both combined on local `main` in merge `ca1b6c0`. The same benchmark was repeated on the combined version, without concurrent browser tests. Raw results are in `scene-profile-economy.json`. The `economy` argument additionally assigns two workers, completes four handoffs, grows city population, and upgrades its Town Hall through real UI controls, then samples the settled scene with the city panel and selected unit visible.

| Combined scenario | Active meshes | Draw calls/frame | CPU render mean (ms) | Frame interval mean / p95 (ms) | Effective FPS |
| --- | ---: | ---: | ---: | ---: | ---: |
| Idle | 1500 | 322 | 2.78 | 36.94 / 38.60 | 27.07 |
| Hover | 1501 p95 | 323 p95 | 2.75 | 38.90 / 41.20 | 25.71 |
| Selected unit + city panel | 1524 | 346 | 2.97 | 39.19 / 39.70 | 25.52 |
| Grown population + level 2 Town Hall | 1526 | 348 | 2.99 | 38.56 / 39.90 | 25.93 |

Picking averages 0.45 ms, p95 0.60 ms across 100 hover moves. Idle, selected, and upgraded-city samples have zero React renders, rebuilds, or world updates; hover has 42 React renders. Every sample has one render loop. The upgrade adds two house/roof meshes and two steady draw calls. There is no observed performance regression from the economy integration. The faster wall-clock results relative to the earlier optimized run should be treated as run-to-run variation, not evidence that the economy itself improves FPS. These remain SwiftShader measurements, not hardware GPU timings.

Integration testing exposed a timing-sensitive input issue: Babylon's camera subscribes to double taps, so a rapid second click can be classified as a double tap instead of the single tap the old gameplay handler accepted. Diagnostic pointer logs confirmed the reclassification during select-then-move and select-then-attack. The centralized observer now handles pointer down/move/up, accepting left-button releases only when the pointer has not exceeded the existing 10px drag threshold. Hover and clicks share the same pickable/visible/enabled predicate, preserving the original explicit-pick eligibility while reusing event pick results. Right-drag orbiting remains intact. The final measurements above include this fix. All 101 unit tests, all six browser regressions in one complete run, typechecking, and the production build pass. The existing production bundle-size warning remains.

Repeat with `node scripts/profile-scene.mjs economy`. It also captures `profile-economy-upgradedCity.png`. The benchmark always closes its browser, including on failure.
