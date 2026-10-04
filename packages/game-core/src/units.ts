import type { TechnologyId } from "./technologies";

export type UnitDefinition = {
  id: string;
  name: string;
  goldCost: number;
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
  { id: "warrior", name: "Warrior", domain: "land", goldCost: 2, populationCost: 1, requiredTechnology: null, maxMovement: 1, maxHp: 10, attack: 2, defense: 2, range: 1 },
  { id: "archer", name: "Archer", domain: "land", goldCost: 3, populationCost: 1, requiredTechnology: "archery", maxMovement: 1, maxHp: 10, attack: 2, defense: 1, range: 2 },
  { id: "rider", name: "Rider", domain: "land", goldCost: 3, populationCost: 1, requiredTechnology: "riding", maxMovement: 2, maxHp: 10, attack: 2, defense: 1, range: 1 },
  { id: "swordsman", name: "Swordsman", domain: "land", goldCost: 5, populationCost: 2, requiredTechnology: "smithery", maxMovement: 1, maxHp: 15, attack: 3, defense: 3, range: 1 },
  { id: "sailor", name: "Sailor", domain: "naval", goldCost: 5, populationCost: 1, requiredTechnology: "sailing", maxMovement: 3, maxHp: 10, attack: 2, defense: 1, range: 2 },
] as const satisfies readonly UnitDefinition[];

export type UnitType = (typeof unitDefinitions)[number]["id"];
export const getUnitDefinition = (unitType: string): UnitDefinition | undefined => unitDefinitions.find(unit => unit.id === unitType);
export const getUnitStats = (unitType: UnitType) => {
  const definition = getUnitDefinition(unitType)!;
  return { unitType, populationCost: definition.populationCost, maxMovement: definition.maxMovement, maxHp: definition.maxHp, attack: definition.attack, defense: definition.defense, range: definition.range };
};
