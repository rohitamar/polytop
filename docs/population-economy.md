# Population economy and retained technologies

Gold remains the currency and all map models use Polytop's procedural rendering. Aquatism, Construction, Diplomacy and Spiritualism are removed from the technology registry and tree. Every remaining technology has working gameplay effects. This implements the retained branches, rather than adding omitted branches, special tribes, score modes or AI.

## City growth

Players start with 5 Gold. A city produces Gold equal to its level, plus one for an original capital, a Workshop and each Park. Income arrives at the beginning of subsequent turns; a player's initial turn does not pay income twice. Enemy occupation blocks production. Negative population reduces income without lowering the city's established level.

Population grows a city and is independent from military support. A level-L city needs L+1 additional population. Overflow carries forward, with a reward choice required before the next level. Level 2 offers Workshop or Explorer; level 3 offers Walls or 5 Gold; level 4 offers Border Growth or 3 population; level 5 and later offer Park or Giant. Explorer movement and discoveries are deterministic. Parks add one Gold per turn; Polytop has no score mode. A Giant waits for a clear city tile and is ready next turn. Reaching another level can award another Giant.

Initial territory is a 3x3 square, enlarged to 5x5 by Border Growth; existing closest-city ownership resolves overlaps. Every unit takes one support slot in its home city; a city's capacity is its level plus one. Recruitment checks that city rather than aggregate empire capacity. Capturing a city rehomes the capturing unit and removes the captured city's support from surviving enemy units, without destroying those units.

## Paid tile development

An owned visible tile can be developed without sending a unit there. Moving onto resources never pays Gold or automatically harvests them.

| Action | Gold | City population | Technology |
| --- | ---: | ---: | --- |
| Harvest fruit | 2 | 1 | Organization |
| Hunt animals | 2 | 1 | Hunting |
| Harvest fish | 2 | 1 | Fishing |
| Farm on crops | 5 | 2 | Farming |
| Lumber Hut in forest | 3 | 1 | Forestry |
| Mine on mountain metal | 5 | 2 | Mining |
| Sawmill | 5 | 1 per adjacent friendly Lumber Hut | Mathematics |
| Forge | 5 | 2 per adjacent friendly Mine | Smithery |
| Port | 7 | 1 | Fishing |
| Clear undeveloped forest | gains 1 | 0 | Forestry |
| Road | 3 | connection dependent | Roads |
| Bridge across shallow water | 5 | connection dependent | Roads |

Sawmills and Forges are limited to one of each per city. Their adjacency contribution is derived from current friendly improvements and ownership, including diagonal neighbors. Building a Port or Bridge consumes any resource on its tile. Crops, metal and Starfish become visible through Organization, Climbing and Fishing respectively. Harvesting consumes a resource once and saves its population on its city. Existing buildings contribute population dynamically. Connections to the original capital add one population to each connected city and one to the capital, using roads, bridges and Port routes of at most four water steps.

Archery adds forest defense and Climbing adds mountain defense through the shared combat bonus function. Walls increase the friendly city bonus for Fortify units. Strategy supports proposing, accepting and breaking peace. Peace prevents attacking and capturing allied cities. Breaking it ends the aggressor's units' actions and removes its units inside the former ally's territory.

## Naval branch

Fishing provides shallow-water embarkation at friendly Ports. Ordinary land units become Rafts; Giants become Juggernauts. Sailing enables ocean travel and Scout upgrades, Ramming enables Rammer upgrades, and Navigation enables Bomber upgrades and 8-Gold Starfish harvesting. Naval movement permits diagonal steps. Landing restores the carried land unit, retaining current and maximum health; paid ship upgrades are lost. Embarking, landing and upgrading consume the turn. Rafts have no attack. Scouts and Rammers use Dash, Bombers use Splash and Stiff, and Juggernauts use Stomp and Stiff. Splash uses half the shared combat damage against visible adjacent enemies; Stomp deals four damage after movement. Hidden units do not become attack targets or receive area damage.

Unit definitions and generic abilities include naval types, and existing simulation rules can disable any unit type or ability. Disabled embarkation/disembarkation types and upgrades are rejected through the same authoritative validation as other actions.

## Architecture and validation

All gameplay changes pass through immutable `applyAction`. The server supplies authenticated identity, revision checks, duplicate-request protection and independent fog-filtered views. Protocol intents accept exact fields and cannot override Gold, population, health, rewards or ownership. Development definitions and city growth live in pure game-core; React reads eligibility reasons and sends actions, and Babylon only renders accepted state.

Polytop retains its existing orthogonal land movement, Manhattan attack ranges, combat formula and immediate city capture. Giant rewards retain deferred spawning rather than introducing forced displacement. There is no veteran system, enemy zone of control, score mode, Market, Windmill or omitted technology branch.

Automated coverage includes paid development, adjacency, capture, overflow and city reward choices, income, support, resource discovery, bridges and connections, terrain defense, treaties, naval upgrades and cargo health, ocean gates, area attacks, Starfish, rulesets and atomic rejection. WebSocket tests cover development, rewards, upgrades, duplicate/stale intents, private views and reconnect. Browser tests use actual pointer controls and read-only debug snapshots for recruitment, economy, city growth, Giant progression, embarkation and landing, technology research, narrow layouts, multiplayer synchronization, reconnect, fog and combat.
