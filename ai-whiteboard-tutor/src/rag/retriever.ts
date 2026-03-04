import type { PdfChunk } from "./chunking";

function tokenize(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9ก-๙\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

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

function scoreChunk(query: string, chunkText: string): number {
  const qTF = termFreq(tokenize(query));
  const cTF = termFreq(tokenize(chunkText));

  let score = 0;
  for (const [term, qCount] of qTF.entries()) {
    const cCount = cTF.get(term) ?? 0;
    if (cCount > 0) score += (1 + Math.log(1 + cCount)) * (1 + Math.log(1 + qCount));
  }

  const len = Math.max(120, chunkText.length);
  score *= 1 / Math.log(10 + len);
  return score;
}

/** Basic top-k */
export function retrieveTopChunks(query: string, chunks: PdfChunk[], k = 6): PdfChunk[] {
  const scored = chunks
    .map((c) => ({ c, score: scoreChunk(query, c.text) }))
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, k).map((x) => x.c);
}

/**
 * Diverse top-k: tries to cover multiple pages and avoids taking everything from page 1.
 * - maxPerPage: cap chunks per page
 * - minDistinctPages: try to include at least this many pages (if available)
 */
export function retrieveTopChunksDiverse(params: {
  query: string;
  chunks: PdfChunk[];
  k: number;
  maxPerPage?: number;
  minDistinctPages?: number;
}): PdfChunk[] {
  const { query, chunks, k } = params;
  const maxPerPage = params.maxPerPage ?? 2;
  const minDistinctPages = params.minDistinctPages ?? 2;

  const scored = chunks
    .map((c) => ({ c, score: scoreChunk(query, c.text) }))
    .sort((a, b) => b.score - a.score);

  // group by page
  const byPage = new Map<number, Array<{ c: PdfChunk; score: number }>>();
  for (const s of scored) {
    if (!byPage.has(s.c.page)) byPage.set(s.c.page, []);
    byPage.get(s.c.page)!.push(s);
  }

  const pages = Array.from(byPage.keys()).sort((a, b) => a - b);

  const picked: PdfChunk[] = [];
  const pickedPages = new Set<number>();
  const perPageCount = new Map<number, number>();

  // Pass 1: pick best 1 from as many pages as needed
  for (const p of pages) {
    const list = byPage.get(p)!;
    if (!list.length) continue;
    picked.push(list[0].c);
    pickedPages.add(p);
    perPageCount.set(p, 1);
    if (picked.length >= k) return picked.slice(0, k);
    if (pickedPages.size >= minDistinctPages && picked.length >= Math.min(k, minDistinctPages)) break;
  }

  // Pass 2: fill remaining slots with cap per page
  for (const s of scored) {
    if (picked.length >= k) break;
    const p = s.c.page;
    const cnt = perPageCount.get(p) ?? 0;
    if (cnt >= maxPerPage) continue;
    if (picked.find((x) => x.id === s.c.id)) continue;

    picked.push(s.c);
    perPageCount.set(p, cnt + 1);
    pickedPages.add(p);
  }

  return picked.slice(0, k);
}
