export type ConceptNode = { id: string; label: string };
export type ConceptEdge = { from: string; to: string; label?: string };

export type ConceptMap = {
  type: "concept_map";
  nodes: ConceptNode[];
  edges: ConceptEdge[];
};

export type PositionedNode = ConceptNode & { x: number; y: number };

const NODE_W = 150;
const NODE_H = 38;
const PAD = 18;

// Prettier fixed angles to reduce collisions.
// Order: top, right, bottom, left, then diagonals.
const ANGLES = [
  -Math.PI / 2,
  0,
  Math.PI / 2,
  Math.PI,
  -Math.PI / 4,
  Math.PI / 4,
  (3 * Math.PI) / 4,
  (-3 * Math.PI) / 4,
];

function overlaps(a: PositionedNode, b: PositionedNode) {
  return (
    Math.abs(a.x - b.x) < NODE_W + PAD &&
    Math.abs(a.y - b.y) < NODE_H + PAD
  );
}

export function layoutStar(
  nodes: ConceptNode[],
  width: number,
  height: number
): PositionedNode[] {
  const cx = width / 2;
  const cy = height / 2;

  if (nodes.length === 0) return [];
  if (nodes.length === 1) return [{ ...nodes[0], x: cx, y: cy }];

  const [center, ...rest] = nodes;

  // Larger radius = less overlap
  const r = Math.min(width, height) * 0.42;

  const positioned: PositionedNode[] = [{ ...center, x: cx, y: cy }];

  rest.forEach((node, i) => {
    const angle = ANGLES[i % ANGLES.length];
    positioned.push({
      ...node,
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    });
  });

  // Simple relaxation: push overlapping outer nodes apart a bit
  for (let iter = 0; iter < 10; iter++) {
    for (let i = 1; i < positioned.length; i++) {
      for (let j = i + 1; j < positioned.length; j++) {
        const a = positioned[i];
        const b = positioned[j];
        if (!overlaps(a, b)) continue;

        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const mag = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const ux = dx / mag;
        const uy = dy / mag;

        // push them apart
        positioned[i] = { ...a, x: a.x + ux * 14, y: a.y + uy * 14 };
        positioned[j] = { ...b, x: b.x - ux * 14, y: b.y - uy * 14 };
      }
    }
  }

  return positioned;
}

export function normalizeLabels(nodes: ConceptNode[]): ConceptNode[] {
  // Trim, dedupe by label (keeps first occurrence)
  const seen = new Set<string>();
  const out: ConceptNode[] = [];
  for (const n of nodes) {
    const label = String(n.label ?? "").trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    // Hard truncate to avoid UI collisions
    const short = label.length > 22 ? label.slice(0, 22) + "…" : label;
    out.push({ ...n, label: short });
  }
  return out;
}
