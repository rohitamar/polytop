import type { TechnologyId } from "./technologies";

export type UnitAbility = "DASH" | "ESCAPE" | "FORTIFY" | "STIFF" | "STATIC" | "SPLASH" | "STOMP";

export type UnitDefinition = {
  visionRadius?: number;
  id: string;
  name: string;
  goldCost: number | null;
  recruitable: boolean;
  abilities: readonly UnitAbility[];
  populationCost: number;
  requiredTechnology: TechnologyId | null;
  maxMovement: number;
  maxHp: number;
  attack: number;
  defense: number;
  range: number;
  domain: "land" | "naval";
};

export const unitDefinitions = [
  { id: "warrior", recruitable: true, abilities: ["DASH", "FORTIFY"], name: "Warrior", domain: "land", goldCost: 2, populationCost: 1, requiredTechnology: null, maxMovement: 1, maxHp: 10, attack: 2, defense: 2, range: 1 },
  { id: "archer", recruitable: true, abilities: ["DASH", "FORTIFY"], name: "Archer", domain: "land", goldCost: 3, populationCost: 1, requiredTechnology: "archery", maxMovement: 1, maxHp: 10, attack: 2, defense: 1, range: 2 },
  { id: "rider", recruitable: true, abilities: ["DASH", "ESCAPE", "FORTIFY"], name: "Rider", domain: "land", goldCost: 3, populationCost: 1, requiredTechnology: "riding", maxMovement: 2, maxHp: 10, attack: 2, defense: 1, range: 1 },
  { id: "swordsman", recruitable: true, abilities: ["DASH"], name: "Swordsman", domain: "land", goldCost: 5, populationCost: 1, requiredTechnology: "smithery", maxMovement: 1, maxHp: 15, attack: 3, defense: 3, range: 1 },
  { id: "defender", name: "Defender", domain: "land", recruitable: true, abilities: ["FORTIFY"], goldCost: 3, populationCost: 1, requiredTechnology: "strategy", maxMovement: 1, maxHp: 15, attack: 1, defense: 3, range: 1 },
  { id: "catapult", name: "Catapult", domain: "land", recruitable: true, abilities: ["STIFF"], goldCost: 8, populationCost: 1, requiredTechnology: "mathematics", maxMovement: 1, maxHp: 10, attack: 4, defense: 0, range: 3 },
  { id: "giant", name: "Giant", domain: "land", recruitable: false, abilities: ["STATIC"], goldCost: null, populationCost: 1, requiredTechnology: null, maxMovement: 1, maxHp: 40, attack: 5, defense: 4, range: 1 },
  { id: "raft", name: "Raft", domain: "naval", recruitable: false, abilities: ["STIFF", "STATIC"], goldCost: null, populationCost: 1, requiredTechnology: "fishing", maxMovement: 2, maxHp: 10, attack: 0, defense: 1, range: 0 },
  { id: "scout", name: "Scout", domain: "naval", recruitable: false, abilities: ["DASH", "STATIC"], goldCost: 5, populationCost: 1, requiredTechnology: "sailing", maxMovement: 3, maxHp: 10, attack: 2, defense: 1, range: 2, visionRadius: 2 },
  { id: "rammer", name: "Rammer", domain: "naval", recruitable: false, abilities: ["DASH", "STATIC"], goldCost: 5, populationCost: 1, requiredTechnology: "ramming", maxMovement: 3, maxHp: 10, attack: 3, defense: 3, range: 1 },
  { id: "bomber", name: "Bomber", domain: "naval", recruitable: false, abilities: ["SPLASH", "STIFF", "STATIC"], goldCost: 15, populationCost: 1, requiredTechnology: "navigation", maxMovement: 2, maxHp: 10, attack: 3, defense: 2, range: 3 },
  { id: "juggernaut", name: "Juggernaut", domain: "naval", recruitable: false, abilities: ["STOMP", "STIFF", "STATIC"], goldCost: null, populationCost: 1, requiredTechnology: "fishing", maxMovement: 2, maxHp: 40, attack: 4, defense: 4, range: 1 },
] as const satisfies readonly UnitDefinition[];

export type UnitType = (typeof unitDefinitions)[number]["id"];
export const getUnitDefinition = (unitType: string): UnitDefinition | undefined => unitDefinitions.find(unit => unit.id === unitType);
export const getUnitStats = (unitType: UnitType) => {
  const definition = getUnitDefinition(unitType)!;
  return { unitType, populationCost: definition.populationCost, maxMovement: definition.maxMovement, maxHp: definition.maxHp, attack: definition.attack, defense: definition.defense, range: definition.range };
};

export type GameRules = { enabledUnitTypes: readonly UnitType[]; enabledUnitAbilities: readonly UnitAbility[] };
export const fullRuleset: GameRules = {
  enabledUnitTypes: unitDefinitions.map(definition => definition.id),
  enabledUnitAbilities: ["DASH", "ESCAPE", "FORTIFY", "STIFF", "STATIC", "SPLASH", "STOMP"],
};
export const isUnitEnabled = (rules: GameRules | undefined, unitType: UnitType) => (rules ?? fullRuleset).enabledUnitTypes.includes(unitType);
export const hasUnitAbility = (rules: GameRules | undefined, unitType: UnitType, ability: UnitAbility) =>
  (rules ?? fullRuleset).enabledUnitAbilities.includes(ability) && !!getUnitDefinition(unitType)?.abilities.includes(ability);
