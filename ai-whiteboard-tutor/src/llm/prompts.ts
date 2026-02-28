export function buildLessonPrompt(params: {
  explainLevel: "simple" | "normal";
  context: string; // PDF text with page markers
}) {
  const levelInstr =
    params.explainLevel === "simple"
      ? "Explain simply for a beginner. Use short sentences and concrete examples."
      : "Explain clearly with a bit more detail, still beginner-friendly.";

  return `
You MUST follow these rules:
- You are in STRICT PDF MODE. Use ONLY the provided PDF context.
- If the context is insufficient, say so inside the output JSON in a field called "notes".
- Output MUST be valid JSON ONLY. No markdown. No extra commentary.

Goal:
Generate a short whiteboard lesson from the PDF context.

${levelInstr}

Return JSON in EXACTLY this schema:

{
  "title": "string",
  "bullets": ["string", "string", "string", ...],
  "diagram": {
    "type": "concept_map",
    "nodes": [{"id":"n1","label":"string"}, ...],
    "edges": [{"from":"n1","to":"n2","label":"string"} , ...]
  },
  "citations": [1,2,3],
  "notes": "string"
}

Constraints:
- bullets: 5 to 9 items max
- nodes: 4 to 7 nodes max
- edges: 3 to 7 edges max
- citations: list of page numbers you used (from the context headings)

PDF CONTEXT (with page numbers):
${params.context}
`.trim();
}

export function extractFirstJsonObject(text: string): string | null {
  // Tries to find the first {...} JSON object in a messy model output.
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth === 0) {
      return text.slice(start, i + 1);
    }
  }
  return null;
}
