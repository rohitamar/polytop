import { technologies, type TechnologyDefinition } from "@reach/game-core";

const spacing = 136;
const rowWidth = spacing * 6;
export const technologyNodeSize = 110;

export function layoutTechnologies(definitions: readonly TechnologyDefinition[] = technologies) {
  const children = (id: string) => definitions.filter(technology => technology.prerequisites[0] === id);
  const leaves = (technology: TechnologyDefinition): number => {
    const descendants = children(technology.id);
    return descendants.length ? descendants.reduce((total, child) => total + leaves(child), 0) : 1;
  };
  const depth = (technology: TechnologyDefinition): number => technology.prerequisites.length
    ? 1 + Math.max(...technology.prerequisites.map(id => depth(definitions.find(parent => parent.id === id)!))) : 0;
  const nodes: { technology: TechnologyDefinition; x: number; y: number }[] = [];
  let rowX = 0;
  let rowY = 0;
  let rowHeight = 0;
  const place = (technology: TechnologyDefinition, left: number) => {
    const x = left + leaves(technology) * spacing / 2;
    const y = rowY + depth(technology) * spacing + spacing / 2;
    nodes.push({ technology, x, y });
    rowHeight = Math.max(rowHeight, y - rowY + spacing / 2);
    let childLeft = left;
    for (const child of children(technology.id)) {
      place(child, childLeft);
      childLeft += leaves(child) * spacing;
    }
  };
  for (const root of definitions.filter(technology => !technology.prerequisites.length)) {
    const width = leaves(root) * spacing;
    if (rowX + width > rowWidth && rowX > 0) {
      rowY += rowHeight + 24;
      rowX = 0;
      rowHeight = 0;
    }
    place(root, rowX);
    rowX += width;
  }
  const edges = nodes.flatMap(child => child.technology.prerequisites.map(id => ({
    parent: nodes.find(node => node.technology.id === id)!, child,
  })));
  return { nodes, edges, width: Math.max(rowWidth, ...nodes.map(node => node.x + spacing / 2)), height: rowY + rowHeight };
}

export const technologyTreeLayout = layoutTechnologies();
