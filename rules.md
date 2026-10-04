# Polytop gameplay rules

Gold is the only spendable currency. Population is military capacity, not a currency.

## Town Halls and turns

Town Hall levels 1/2/3 provide 2/3/5 Gold each turn and 3/6/9 population capacity. Existing upgrades cost 4/8 Gold. Configuration lives in game-core `economy`.

Only the incoming player receives Town Hall income, once per accepted turn handoff. Player one receives first-turn income during initial state creation. Capturing a Town Hall transfers future income and capacity, never deployed unit ownership. Population used sums the costs of surviving owned units; available population is capacity minus used. Existing armies survive lost capacity; recruitment requires available support.

## One-time resources

Orchard, Wheat, Forest and Fish award 2 Gold; Mine awards 3 Gold and requires Mining. Configuration lives in `resourceDefinitions`. No map resource provides passive income or a separate currency.

An accepted move collects an eligible resource on its destination automatically and removes the node in the same transition. Resources crossed along a path remain. Combat advancement shares this collection rule. Unlocking Mining collects deposits beneath eligible owned units. Territorial ownership does not restrict collection.

## Terrain and technologies

Land movement is orthogonal and weighted; Rafts and embarkation also allow diagonals. Grass, Forest, accessible Mountain and Water cost 1 when accessible. `canUnitEnterTile` validates movement and Port access; `canUnitEnterTerrain` validates terrain domains.

- Land units can enter grass and forest.
- Climbing is Tier 1 and permits all existing land unit types on mountains.
- Mining is Tier 2, requires Climbing and permits mineral collection.
- Fishing is Tier 1 and unlocks Ports for 7 Gold on empty, owned coastal Water.
- Land units enter Water through a friendly Port, becoming a Raft carrying the original unit.
- Rafts can move up to 2 tiles in one move per turn, with no attack and 1 defense. Embarking and landing end all actions for the turn. Landing restores the original unit; identity, health, home city and population remain intact.
- Water is one terrain type; separate shallow water and Ocean rules and advanced ship upgrades are not implemented. Sailing remains reserved for future upgrades.

Technology cost is `4 + tier * current owned Town Hall count`, recalculated by the authoritative rules at purchase time. Fishing, Climbing and Riding are Tier 1; Archery, Mining, Roads and Sailing are Tier 2; Smithery is Tier 3. Existing Farming remains Tier 1. Archery unlocks Archers, Riding unlocks Riders, and Smithery unlocks Swordsmen.

## Recruitment and combat

All recruitment validates active turn, owned town, technology, Gold, population and an unoccupied legal spawn. Existing land units spawn at the town center. Direct naval recruitment is disabled. Recruits act on their owner's next turn.

Rafts cannot attack or retaliate. They may land on unoccupied land, subject to the original unit's mountain access. Paths stop at embarkation and landing, so a unit cannot continue through either transition in the same turn.

Unit definitions centralize costs and stats: Warrior 2 Gold, 1 population, 10 HP, 2 attack, 2 defense, 1 movement, range 1; Archer 3 Gold, 1 population, 10 HP, 2 attack, 1 defense, 1 movement, range 2; Rider 3 Gold, 1 population, 10 HP, 2 attack, 1 defense, 2 movement, range 1; Swordsman 5 Gold, existing 2 population, 15 HP, 3 attack, 3 defense, 1 movement, range 1.

## Roads and shared water

Roads technology permits construction for 3 Gold on friendly or neutral Grass/Forest. Enemy territory, Mountains, Water, existing roads and city endpoints are rejected without spending. Neutral roads do not claim territory. Roads have no builder ownership; every legally entering land unit can use them. Connected road edges cost 0.5 movement, including a road adjoining a Town Hall endpoint. Unconnected edges cost the normal terrain amount. Adjacent Town Halls without a road use normal cost.

Water ownership does not restrict sailing. Rafts traverse neutral and enemy-owned Water subject to occupancy and movement budgets. Ports must be constructed within owned territory; embarking requires a friendly Port. Existing land movement still permits invading enemy territory.

## Authority and synchronization

`applyAction` is the sole deterministic immutable gameplay boundary. The WebSocket server binds player identity, validates expected revisions and rejects accepted request IDs before committing rules and broadcasting complete snapshots. Invalid actions never partially spend Gold, deplete resources or change units.

Browser session tokens permit reconnect/reload within 60 seconds, restoring current roads, units, technologies, resources, Gold and turn state without awarding income. Only one socket can control each session. Explicit departure or expiration ends a match. Sessions are memory-only and do not survive server restarts.

## Presentation and scope

HUD income includes Town Halls only. Resource panels display one-time Gold and technology requirements; depletion removes their shared geometry. Collection uses the existing +Gold status message. New rule behavior requires unit tests and pointer-based browser validation.

Future milestones may add persistence or deeper naval geography. This milestone excludes extra currencies, workers, passive resource income, advanced ships, markets, supply chains, fog of war, AI and a combat redesign.

Starting cities retain safe land immediately around their centers and receive coastal Water within their territory when the default map includes water. Deterministic coastal placement preserves terrain totals and land routes. Port placement highlights currently buildable tiles using the same rule validator as authoritative construction.

## Fog of war

Vision uses Manhattan distance: unit radius 1, owned Town Hall radius 2, without terrain blocking. Each player's explored tiles persist independently. Unexplored tiles reveal nothing; explored tiles retain their last observed map and city information; currently visible tiles show live information. Unseen enemy units are removed from player views, and ranged attacks require current visibility. Roads and Ports require a visible construction site. Movement may enter unknown tiles when authoritative terrain and occupancy permit it.
