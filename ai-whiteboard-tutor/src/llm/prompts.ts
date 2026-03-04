type ExplainLevel = "simple" | "normal";
type DiagramType = "concept_map" | "flowchart" | "timeline";

export function buildLessonPrompt(params: {
  explainLevel: ExplainLevel;
  evidence: Array<{ chunkId: string; page: number; text: string }>;
  numPages: number;
}) {
  const isSimple = params.explainLevel === "simple";

  // Controlled differences between modes:
  const bulletMin = isSimple ? 5 : 6;
  const bulletMax = isSimple ? 7 : 9;
  const bulletCharCap = isSimple ? 110 : 160;
  const notesCharCap = isSimple ? 140 : 220;

  const requireDistinctPages = params.numPages >= 2 ? 2 : 1;

  const evidenceBlock = params.evidence
    .map((e) => `[[${e.chunkId} | p.${e.page}]]\n${e.text}`)
    .join("\n\n");

  return `
You MUST follow these rules:
- STRICT PDF MODE: use ONLY the EVIDENCE CHUNKS below.
- Do NOT invent. If evidence is insufficient, say so in "notes".
- Output MUST be valid JSON ONLY (no markdown, no prose).
- IMPORTANT: citations must reference ONLY the provided chunkIds.

Return JSON with EXACT schema:
{
  "title": "string",
  "bullets": ["string", ...],
  "diagram": {
    "type": "concept_map" | "flowchart" | "timeline",
    "nodes": [{"id":"n1","label":"string"}, ...],
    "edges": [{"from":"n1","to":"n2","label":"string"}, ...]
  },
  "citations": [
    { "page": 1, "chunkId": "p1_c1", "quote": "exact substring from that chunk (8–20 words)" }
  ],
  "notes": "string"
}

Constraints:
- bullets: ${bulletMin} to ${bulletMax} items
- each bullet: <= ${bulletCharCap} characters
- notes: <= ${notesCharCap} characters
- diagram.type: choose the BEST of (concept_map, flowchart, timeline) for the content
- nodes: 4 to 8 nodes total
- edges: 3 to 10 edges total
- node labels: <= 22 characters
- citations: include at least ${requireDistinctPages} DISTINCT page(s) if available in the evidence
- citations: 2 to 5 items
- quote MUST be copied verbatim from the cited chunk text

Quality rules:
- Avoid vague wording. Prefer concrete terms from the PDF.
- If you mention a number/stat, include a citation for it.

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

/**
 * Used only if JSON parsing fails: ask the model to rewrite into valid JSON.
 */
export function buildJsonRepairPrompt(badText: string) {
  return `
Rewrite the following into VALID JSON only (no markdown, no explanation).
It MUST match this schema exactly:
{
  "title": "string",
  "bullets": ["string", ...],
  "diagram": { "type": "concept_map" | "flowchart" | "timeline", "nodes": [{"id":"n1","label":"string"}], "edges": [{"from":"n1","to":"n2","label":"string"}] },
  "citations": [{ "page": 1, "chunkId": "p1_c1", "quote": "string" }],
  "notes": "string"
}

TEXT:
${badText}
`.trim();
}
