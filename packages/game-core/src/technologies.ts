import type { GameState, Opportunity } from "./index";

export type TechEffect =
  | { type: "unlock-unit"; description: string }
  | { type: "capability"; description: string }
  | { type: "collect-resource"; resource: Opportunity; description: string };

export type TechnologyDefinition = {
  id: TechnologyId;
  name: string;
  tier: number;
  prerequisites: readonly TechnologyId[];
  effects: readonly TechEffect[];
  implemented: boolean;
};

export const technologies = [
  { id: "organization", name: "Organization", tier: 1, prerequisites: [], effects: [{ type: "capability", description: "Future foundation for the Farming and Strategy branches." }], implemented: false },
  { id: "farming", name: "Farming", tier: 1, prerequisites: ["organization"], effects: [{ type: "capability", description: "Future farming improvements." }], implemented: false },
  { id: "construction", name: "Construction", tier: 3, prerequisites: ["farming"], effects: [{ type: "capability", description: "Future construction improvements." }], implemented: false },
  { id: "strategy", name: "Strategy", tier: 2, prerequisites: ["organization"], effects: [{ type: "capability", description: "Future strategic capabilities." }], implemented: false },
  { id: "diplomacy", name: "Diplomacy", tier: 3, prerequisites: ["strategy"], effects: [{ type: "capability", description: "Future diplomatic capabilities." }], implemented: false },
  { id: "hunting", name: "Hunting", tier: 1, prerequisites: [], effects: [{ type: "capability", description: "Opens the Forestry and Archery branches." }], implemented: true },
  { id: "forestry", name: "Forestry", tier: 2, prerequisites: ["hunting"], effects: [{ type: "capability", description: "Future forestry improvements." }], implemented: false },
  { id: "mathematics", name: "Mathematics", tier: 3, prerequisites: ["forestry"], effects: [{ type: "unlock-unit", description: "Catapult (coming soon)." }], implemented: false },
  { id: "archery", name: "Archery", tier: 2, prerequisites: ["hunting"], effects: [{ type: "unlock-unit", description: "Archer recruitment." }], implemented: true },
  { id: "spiritualism", name: "Spiritualism", tier: 3, prerequisites: ["archery"], effects: [{ type: "capability", description: "Future spiritual capabilities." }], implemented: false },
  { id: "fishing", name: "Fishing", tier: 1, prerequisites: [], effects: [{ type: "capability", description: "Build Ports for 7 Gold on owned coastal Water. Move land units onto Ports to embark as Rafts." }], implemented: true },
  { id: "sailing", name: "Sailing", tier: 2, prerequisites: ["fishing"], effects: [{ type: "unlock-unit", description: "Future naval upgrades and Scout recruitment." }], implemented: false },
  { id: "navigation", name: "Navigation", tier: 3, prerequisites: ["sailing"], effects: [{ type: "unlock-unit", description: "Bomber (coming soon)." }], implemented: false },
  { id: "ramming", name: "Ramming", tier: 2, prerequisites: ["fishing"], effects: [{ type: "unlock-unit", description: "Rammer (coming soon)." }], implemented: false },
  { id: "aquatism", name: "Aquatism", tier: 3, prerequisites: ["ramming"], effects: [{ type: "capability", description: "Future aquatic capabilities." }], implemented: false },
  { id: "climbing", name: "Climbing", tier: 1, prerequisites: [], effects: [{ type: "capability", description: "Allows land units to enter Mountains." }], implemented: true },
  { id: "mining", name: "Mining", tier: 2, prerequisites: ["climbing"], effects: [{ type: "collect-resource", resource: "mine", description: "Collect mineral deposits for Gold, including deposits beneath existing units." }], implemented: true },
  { id: "riding", name: "Riding", tier: 1, prerequisites: [], effects: [{ type: "unlock-unit", description: "Rider recruitment." }], implemented: true },
  { id: "roads", name: "Roads", tier: 2, prerequisites: [], effects: [{ type: "capability", description: "Build Roads for 3 Gold per tile. Connected roads cost 0.5 movement." }], implemented: true },
  { id: "smithery", name: "Smithery", tier: 3, prerequisites: [], effects: [{ type: "unlock-unit", description: "Swordsman recruitment." }], implemented: true },
] as const;

export type TechnologyId = (typeof technologies)[number]["id"];
const definitions: readonly TechnologyDefinition[] = technologies;
export const getTechnology = (technologyId: string): TechnologyDefinition | undefined => definitions.find(technology => technology.id === technologyId);

export function getTechnologyCost(state: GameState, playerId: string, technologyId: string): number {
  const technology = getTechnology(technologyId);
  if (!technology) throw new Error("Unknown technology");
  return 4 + technology.tier * state.cities.filter(city => city.ownerId === playerId).length;
}

export const hasTechnology = (state: GameState, playerId: string, technologyId: TechnologyId) =>
  state.players.find(player => player.id === playerId)?.technologies.includes(technologyId) ?? false;

export function getTechnologyUnlockReason(state: GameState, playerId: string, technologyId: string): string | null {
  const player = state.players.find(player => player.id === playerId);
  if (!player || playerId !== state.activePlayerId) return "Not your turn";
  const technology = getTechnology(technologyId);
  if (!technology) return "Unknown technology";
  if (!technology.implemented) return "Technology not implemented yet · Coming Soon";
  if (hasTechnology(state, playerId, technology.id)) return "Already researched";
  const missing = technology.prerequisites.filter(id => !hasTechnology(state, playerId, id));
  if (missing.length) return `Requires ${missing.map(id => getTechnology(id)!.name).join(", ")}`;
  const cost = getTechnologyCost(state, playerId, technology.id);
  if (player.resources.gold < cost) return `Not enough Gold: need ${cost - player.resources.gold} more`;
  return null;
}

export const canUnlockTechnology = (state: GameState, playerId: string, technologyId: string) =>
  getTechnologyUnlockReason(state, playerId, technologyId) === null;
