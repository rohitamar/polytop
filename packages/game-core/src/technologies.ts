import type { GameState } from "./index";

export type TechEffect =
  | { type: "unlock-unit"; description: string }
  | { type: "capability"; description: string };

export type TechnologyDefinition = {
  id: TechnologyId;
  name: string;
  tier: number;
  prerequisites: readonly TechnologyId[];
  effects: readonly TechEffect[];
  implemented: boolean;
};

export const technologies = [
  { id: "organization", name: "Organization", tier: 1, prerequisites: [], effects: [{ type: "capability", description: "Harvest fruit for 2 Gold and 1 population; reveals crops." }], implemented: true },
  { id: "farming", name: "Farming", tier: 2, prerequisites: ["organization"], effects: [{ type: "capability", description: "Build Farms on crops for 5 Gold and 2 population." }], implemented: true },
  { id: "strategy", name: "Strategy", tier: 2, prerequisites: ["organization"], effects: [{ type: "capability", description: "Recruit Defenders and propose peace treaties." }], implemented: true },
  { id: "hunting", name: "Hunting", tier: 1, prerequisites: [], effects: [{ type: "capability", description: "Hunt animals for 2 Gold and 1 population." }], implemented: true },
  { id: "forestry", name: "Forestry", tier: 2, prerequisites: ["hunting"], effects: [{ type: "capability", description: "Build Lumber Huts for 3 Gold and 1 population; clear forests for 1 Gold." }], implemented: true },
  { id: "mathematics", name: "Mathematics", tier: 3, prerequisites: ["forestry"], effects: [{ type: "unlock-unit", description: "Recruit Catapults; build Sawmills for 5 Gold and 1 population per adjacent Lumber Hut." }], implemented: true },
  { id: "archery", name: "Archery", tier: 2, prerequisites: ["hunting"], effects: [{ type: "unlock-unit", description: "Recruit Archers; units receive a defense bonus in forests." }], implemented: true },
  { id: "fishing", name: "Fishing", tier: 1, prerequisites: [], effects: [{ type: "capability", description: "Harvest fish for 2 Gold and 1 population; reveal Starfish. Build Ports for 7 Gold and 1 population; embark as Rafts." }], implemented: true },
  { id: "sailing", name: "Sailing", tier: 2, prerequisites: ["fishing"], effects: [{ type: "unlock-unit", description: "Upgrade Rafts into Scouts for 5 Gold; travel on deep ocean." }], implemented: true },
  { id: "navigation", name: "Navigation", tier: 3, prerequisites: ["sailing"], effects: [{ type: "unlock-unit", description: "Upgrade Rafts into Bombers for 15 Gold; harvest Starfish for 8 Gold." }], implemented: true },
  { id: "ramming", name: "Ramming", tier: 2, prerequisites: ["fishing"], effects: [{ type: "unlock-unit", description: "Upgrade Rafts into Rammers for 5 Gold." }], implemented: true },
  { id: "climbing", name: "Climbing", tier: 1, prerequisites: [], effects: [{ type: "capability", description: "Enter Mountains, receive a mountain defense bonus, and reveal metal." }], implemented: true },
  { id: "mining", name: "Mining", tier: 2, prerequisites: ["climbing"], effects: [{ type: "capability", description: "Build Mines on metal for 5 Gold and 2 population." }], implemented: true },
  { id: "riding", name: "Riding", tier: 1, prerequisites: [], effects: [{ type: "unlock-unit", description: "Rider recruitment." }], implemented: true },
  { id: "roads", name: "Roads", tier: 2, prerequisites: ["riding"], effects: [{ type: "capability", description: "Build Roads for 3 Gold per tile. Connected roads cost 0.5 movement. Build Bridges for 5 Gold; connect cities for population." }], implemented: true },
  { id: "smithery", name: "Smithery", tier: 3, prerequisites: ["mining"], effects: [{ type: "unlock-unit", description: "Recruit Swordsmen; build Forges for 5 Gold and 2 population per adjacent Mine." }], implemented: true },
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
