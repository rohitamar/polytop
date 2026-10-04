import type { GameState } from "./index";

export const technologies = [
  { id: "farming", name: "Farming", tier: 1, description: "Foundation for future farming improvements." },
  { id: "archery", name: "Archery", tier: 2, description: "Unlocks Archer recruitment." },
  { id: "climbing", name: "Climbing", tier: 1, description: "Allows land units to enter Mountains." },
  { id: "mining", name: "Mining", tier: 2, description: "Allows collection of mineral deposits for Gold." },
  { id: "fishing", name: "Fishing", tier: 1, description: "Build Ports for 7 Gold on owned coastal Water. Move land units onto Ports to embark as Rafts." },
  { id: "sailing", name: "Sailing", tier: 2, description: "Foundation for future naval upgrades." },
  { id: "roads", name: "Roads", tier: 2, description: "Allows construction of Roads for 3 Gold per tile. Connected roads cost 0.5 movement." },
  { id: "riding", name: "Riding", tier: 1, description: "Unlocks Rider recruitment." },
  { id: "smithery", name: "Smithery", tier: 3, description: "Unlocks Swordsman recruitment." },
] as const;

export type TechnologyId = (typeof technologies)[number]["id"];
export const technologyPrerequisites: Partial<Record<TechnologyId, readonly TechnologyId[]>> = { mining: ["climbing"] };
export const getTechnology = (technologyId: string) => technologies.find(technology => technology.id === technologyId);

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
  if (hasTechnology(state, playerId, technology.id)) return "Already unlocked";
  for (const prerequisite of technologyPrerequisites[technology.id] ?? []) {
    if (!hasTechnology(state, playerId, prerequisite)) return `Requires ${getTechnology(prerequisite)!.name}`;
  }
  const cost = getTechnologyCost(state, playerId, technology.id);
  if (player.resources.gold < cost) return `Not enough Gold: need ${cost - player.resources.gold} more`;
  return null;
}

export const canUnlockTechnology = (state: GameState, playerId: string, technologyId: string) =>
  getTechnologyUnlockReason(state, playerId, technologyId) === null;
