# Core land units

`packages/game-core/src/units.ts` owns unit stats, recruitment costs, technology requirements, population costs and abilities. Recruitment and city rewards use the same unit constructor. Existing Swordsman population cost remains two; other normal land recruits cost one population. The free Giant reward uses zero recruitment population and has no Gold price.

## Actions and abilities

Units serialize `actionPhase` alongside the existing `hasAttacked` attack-spent flag. Older states without a phase retain their existing ready/spent behavior. New games and recruited units always initialize the phase.

- `ready`: normal movement and attack are available.
- `moved`: normal remaining movement is available; only enabled Dash permits an attack.
- `escape`: the attack is spent and one movement action with the full normal allowance is available.
- `complete`: movement and attack are unavailable.

Any Escape move ends the action phase even when its path uses less than the available allowance. Retaliation death removes the unit. A surviving melee kill advances before Escape is granted. Embarking still ends all actions. Only the incoming player's units reset on turn handoff.

Dash, Escape, Fortify and Stiff are checked through `hasUnitAbility`. Fortify multiplies defense by 1.5 on a friendly city tile, through the shared combat defense calculation. There was no previous city defense bonus. Stiff suppresses retaliation independently of Dash. Static is metadata for future veteran eligibility; it does not restrict movement.

## City reward

Upgrading a Town Center to the existing maximum level (3) makes a single Giant reward available. `CLAIM_GIANT` validates ownership, active turn, enabled unit type and an empty passable city tile. An occupied city can be upgraded; the reward waits until its tile is cleared. Claiming is free, creates a unit that waits until the next owner turn, and consumes the reward permanently. Capturing the city preserves its reward status and never recreates a claimed reward.

## Simulations and synchronization

Pass `rules` to `createGame` with `enabledUnitTypes` and `enabledUnitAbilities`. Omitting rules enables the full existing roster and all five abilities. Both legal-action generation and authoritative validation read these rules. Player views include a copy of the rules and the owner's action phases; enemy action phases are masked with the existing enemy turn data. Clients submit actions and cannot submit replacement unit state or enable abilities.

Escape uses the same pathfinder, movement costs, roads, occupancy, terrain, Ports and fog exploration update as every other move. It adds no separate path validation or visibility channel. Ranged attacks use the existing Manhattan range and visibility checks. The current engine has no enemy zone-of-control rule; this change preserves the existing movement restrictions.

## Verification

`land-units.test.ts` covers the roster, technology gates, Dash, Escape, Stiff, Fortify, ranged visibility, rulesets, serialized views and Giant rewards. WebSocket tests exercise Rider recruitment/combat/Escape, rejection of duplicate actions, locked recruitment and Giant rewards. Protocol tests reject forged phases, movement budgets and reward state. `tests/land-units.spec.ts` uses real pointer controls and read-only debug snapshots for all six recruits, ranges, action restrictions, Giant rendering and multiplayer Escape/reconnect.
