import { getHarvestReason, getImprovementReason, getClearForestReason, getBridgeBuildingReason, getImprovementPopulation, improvementDefinitions, type GameAction, type GameState, type Tile } from "@reach/game-core";
import { opportunityNames } from "./resources";

export function DevelopmentPanel({ state, tile, playerId, blocked, onAction, onClose }: { state: GameState; tile: Tile; playerId: string; blocked: boolean; onAction: (action: GameAction) => void; onClose: () => void }) {
  const actions: { label: string; reason: string | null; benefit?: string; action: GameAction }[] = [];
  if (tile.resource === "orchard" || tile.resource === "animal" || tile.resource === "fishery") actions.push({ label: `Harvest ${opportunityNames[tile.resource]} · 2 Gold · +1 population`, reason: getHarvestReason(state, playerId, tile), action: { type: "HARVEST_RESOURCE", playerId, to: { x: tile.x, y: tile.y } } });
  for (const [type, definition] of Object.entries(improvementDefinitions)) {
    if (tile.terrain !== definition.terrain || definition.resource && tile.resource !== definition.resource || tile.improvement || tile.port || tile.bridge) continue;
    actions.push({ label: `Build ${definition.name} · ${definition.cost} Gold`, benefit: definition.adjacent ? `+${definition.population} population per adjacent friendly ${improvementDefinitions[definition.adjacent].name}` : `+${definition.population} city population`, reason: getImprovementReason(state, playerId, tile, type), action: { type: "BUILD_IMPROVEMENT", playerId, to: { x: tile.x, y: tile.y }, improvement: type as keyof typeof improvementDefinitions } });
  }
  if (tile.terrain === "forest" && !tile.improvement) actions.push({ label: "Clear Forest · +1 Gold", reason: getClearForestReason(state, playerId, tile), action: { type: "CLEAR_FOREST", playerId, to: { x: tile.x, y: tile.y } } });
  if (tile.terrain === "water" && !tile.bridge && !tile.port) actions.push({ label: "Build Bridge · 5 Gold", reason: getBridgeBuildingReason(state, playerId, tile), action: { type: "BUILD_BRIDGE", playerId, to: { x: tile.x, y: tile.y } } });
  return <section className="resource-panel development-panel" aria-label="Develop tile">
    <div className="panel-heading"><span className="eyebrow">TILE DEVELOPMENT</span><button aria-label="Close development" disabled={blocked} onClick={onClose}>×</button></div>
    <h2>{tile.improvement ? improvementDefinitions[tile.improvement].name : tile.resource ? opportunityNames[tile.resource] : tile.bridge ? "Bridge" : tile.port ? "Port" : tile.terrain[0].toUpperCase() + tile.terrain.slice(1)}</h2>
    <p>Tile {tile.x + 1}, {tile.y + 1}</p>
    {tile.improvement || tile.port ? <p>Contributes {getImprovementPopulation(state, tile)} city population.</p> : <p>Develop owned tiles to grow your city. Units do not collect resources automatically.</p>}
    {actions.map(({ label, reason, benefit, action }) => <div className="development-action" key={label}><button className="worker-action" disabled={blocked || reason !== null} onClick={() => onAction(action)}>{label}</button>{benefit && <small>{benefit}</small>}{reason && <small>{reason}</small>}</div>)}
    {!actions.length && <p>No development actions available.</p>}
  </section>;
}
