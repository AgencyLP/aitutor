// ai-whiteboard-tutor/src/llm/prompts.ts

export function buildLessonPrompt(params: {
  explainLevel: "simple" | "normal";
  evidence: Array<{ chunkId: string; page: number; text: string }>;
}) {
  const levelInstr =
    params.explainLevel === "simple"
      ? "Explain simply for a beginner. Use short sentences and concrete examples."
      : "Explain clearly with a bit more detail, still beginner-friendly.";

  const evidenceBlock = params.evidence
    .map((e) => `[[${e.chunkId} | p.${e.page}]]\n${e.text}`)
    .join("\n\n");

  return `
You MUST follow these rules:
- You are in STRICT PDF MODE. Use ONLY the EVIDENCE CHUNKS below.
- If evidence is insufficient, say so in "notes" and do NOT invent facts.
- Output MUST be valid JSON ONLY. No markdown. No extra commentary.

Goal:
Generate a short whiteboard lesson grounded in the PDF evidence.

${levelInstr}

Return JSON in EXACTLY this schema:
{
  "title": "string",
  "bullets": ["string", "string", ...],
  "diagram": {
    "type": "concept_map",
    "nodes": [{"id":"n1","label":"string"}, ...],
    "edges": [{"from":"n1","to":"n2","label":"string"}, ...]
  },
  "citations": [
    { "page": 1, "chunkId": "p1_c1", "quote": "short exact quote from that chunk" }
  ],
  "notes": "string"
}

Constraints:
- bullets: 5 to 9 items max
- nodes: exactly 1 center node + 3 to 6 outer nodes
- node labels: max 3 words AND max 22 characters
- edges: star shape only: every edge MUST be from center node to an outer node
- quote: MUST be a short substring copied from the cited chunk text (8–20 words)

EVIDENCE CHUNKS:
${evidenceBlock}
`.trim();
}

/**
 * Pull the first JSON object from an LLM response that may contain extra text.
 */
export function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth === 0) return text.slice(start, i + 1);
  }
  return null;
}
