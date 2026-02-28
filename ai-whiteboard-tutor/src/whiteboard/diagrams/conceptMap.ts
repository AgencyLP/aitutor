export type ConceptNode = { id: string; label: string };
export type ConceptEdge = { from: string; to: string; label?: string };

export type ConceptMap = {
  type: "concept_map";
  nodes: ConceptNode[];
  edges: ConceptEdge[];
};

export type PositionedNode = ConceptNode & { x: number; y: number };

export function layoutRadial(
  nodes: ConceptNode[],
  width: number,
  height: number
): PositionedNode[] {
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) * 0.32;

  if (nodes.length === 0) return [];
  if (nodes.length === 1) return [{ ...nodes[0], x: cx, y: cy }];

  // Put first node in center, rest around circle
  const [center, ...rest] = nodes;
  const positioned: PositionedNode[] = [{ ...center, x: cx, y: cy }];

  const n = rest.length;
  rest.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / n;
    positioned.push({
      ...node,
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    });
  });

  return positioned;
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
