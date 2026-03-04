import type { PdfChunk } from "./chunking";

function tokenize(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9ก-๙\s]/g, " ") // keep Thai chars too
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

// Tiny stopword list (you can expand later)
const STOP = new Set([
  "the","a","an","and","or","to","of","in","on","for","with","is","are","was","were",
  "this","that","it","as","at","by","from","be","can","will","you","your",
  "คือ","และ","หรือ","ของ","ใน","บน","ที่","เป็น","ได้","ให้","กับ","จาก"
]);

function termFreq(tokens: string[]) {
  const tf = new Map<string, number>();
  for (const t of tokens) {
    if (t.length < 2) continue;
    if (STOP.has(t)) continue;
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }
  return tf;
}

/**
 * Simple TF overlap score (fast, dependency-free).
 * Good enough to start showing believable citations.
 */
export function retrieveTopChunks(
  query: string,
  chunks: PdfChunk[],
  k = 6
): PdfChunk[] {
  const qTokens = tokenize(query);
  const qTF = termFreq(qTokens);

  const scored = chunks.map((c) => {
    const cTF = termFreq(tokenize(c.text));
    let score = 0;

    // weighted overlap
    for (const [term, qCount] of qTF.entries()) {
      const cCount = cTF.get(term) ?? 0;
      if (cCount > 0) score += (1 + Math.log(1 + cCount)) * (1 + Math.log(1 + qCount));
    }

    // small boost for shorter chunks (tends to be cleaner evidence)
    const len = Math.max(100, c.text.length);
    score *= 1 / Math.log(10 + len);

    return { c, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((x) => x.c);
}
