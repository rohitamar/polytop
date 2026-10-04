import { describe, expect, it } from "vitest";
import { technologies, type TechnologyDefinition } from "@reach/game-core";
import { layoutTechnologies, technologyNodeSize } from "./technology-tree-layout";

describe("technology tree layout", () => {
  it("places every technology without overlap and draws every prerequisite edge", () => {
    const { nodes, edges, width, height } = layoutTechnologies();
    expect(nodes).toHaveLength(technologies.length);
    expect(edges).toHaveLength(technologies.reduce((count, technology) => count + technology.prerequisites.length, 0));
    for (const node of nodes) {
      expect(node.x - technologyNodeSize / 2).toBeGreaterThanOrEqual(0);
      expect(node.x + technologyNodeSize / 2).toBeLessThanOrEqual(width);
      expect(node.y + technologyNodeSize / 2).toBeLessThanOrEqual(height);
      for (const other of nodes.filter(other => other !== node)) {
        expect(Math.hypot(node.x - other.x, node.y - other.y)).toBeGreaterThan(technologyNodeSize);
      }
    }
    for (const { parent, child } of edges) expect(parent.y).toBeLessThan(child.y);
  });

  it("renders both parents of a technology with multiple prerequisites", () => {
    const definitions: TechnologyDefinition[] = [
      { id: "hunting", name: "Hunting", tier: 1, prerequisites: [], effects: [], implemented: true },
      { id: "fishing", name: "Fishing", tier: 1, prerequisites: [], effects: [], implemented: true },
      { id: "archery", name: "Archery", tier: 2, prerequisites: ["hunting", "fishing"], effects: [], implemented: true },
    ];
    const { nodes, edges } = layoutTechnologies(definitions);
    expect(nodes).toHaveLength(3);
    expect(edges.map(edge => [edge.parent.technology.id, edge.child.technology.id])).toEqual([["hunting", "archery"], ["fishing", "archery"]]);
  });
});
