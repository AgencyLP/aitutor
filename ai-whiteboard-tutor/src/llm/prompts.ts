type ExplainLevel = "simple" | "normal";

export function buildLessonPrompt(params: {
  explainLevel: ExplainLevel;
  evidence: Array<{ chunkId: string; page: number; text: string }>;
  numPages: number;
}) {
  const isSimple = params.explainLevel === "simple";

  // Controlled differences (prevents Normal from exploding)
  const bulletMin = isSimple ? 6 : 8;
  const bulletMax = isSimple ? 8 : 10;
  const bulletCharCap = isSimple ? 140 : 190;

  // Require at least 2 distinct pages if PDF has >=2 pages
  const requireDistinctPages = params.numPages >= 2 ? 2 : 1;

  const evidenceBlock = params.evidence
    .map((e) => `[[${e.chunkId} | p.${e.page}]]\n${e.text}`)
    .join("\n\n");

  return `
You MUST follow these rules:
- STRICT PDF MODE: use ONLY the EVIDENCE CHUNKS below.
- Do NOT invent. If evidence is insufficient, say so in "notes".
- Output MUST be valid JSON ONLY (no markdown, no prose).
- Every bullet MUST include citations ("cites") referencing the chunkIds provided.

Return JSON with EXACT schema:
{
  "title": "string",
  "bullets": [
    {
      "text": "string",
      "cites": [
        { "page": 1, "chunkId": "p1_c1", "quote": "exact substring from that chunk (8–20 words)" }
      ]
    }
  ],
  "diagram": {
    "type": "concept_map" | "flowchart" | "timeline",
    "nodes": [{"id":"n1","label":"string"}, ...],
    "edges": [{"from":"n1","to":"n2","label":"string"}, ...]
  },
  "notes": "string"
}

Constraints:
- bullets: ${bulletMin} to ${bulletMax} items
- each bullet.text: <= ${bulletCharCap} characters
- each bullet.cites: 1 to 2 items
- quotes MUST be copied verbatim from cited chunk text
- Across ALL bullet citations, include at least ${requireDistinctPages} DISTINCT page(s) if possible.
- diagram.type: choose the BEST of (concept_map, flowchart, timeline)
- nodes: 4 to 8, edges: 3 to 10
- node labels <= 22 characters

Quality rules:
- If you mention a number/stat, cite it in that bullet.
- Prefer concrete wording from the PDF.

EVIDENCE CHUNKS:
${evidenceBlock}
`.trim();
}

/** Pull the first JSON object from an LLM response that may contain extra text. */
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
 * If parsing fails, we do a 2nd pass: rewrite into valid JSON only.
 * (This is what makes Normal mode stop failing.)
 */
export function buildJsonRepairPrompt(badText: string) {
  return `
Output VALID JSON ONLY. No markdown. No extra keys. No commentary.

It MUST match EXACT schema:
{
  "title": "string",
  "bullets": [
    { "text": "string", "cites": [{ "page": 1, "chunkId": "p1_c1", "quote": "string" }] }
  ],
  "diagram": {
    "type": "concept_map" | "flowchart" | "timeline",
    "nodes": [{"id":"n1","label":"string"}],
    "edges": [{"from":"n1","to":"n2","label":"string"}]
  },
  "notes": "string"
}

Fix quoting/escaping. Remove anything not JSON.

TEXT TO FIX:
${badText}
`.trim();
}
