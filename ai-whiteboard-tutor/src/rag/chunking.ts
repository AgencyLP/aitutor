export type PdfChunk = {
  id: string;          // e.g. "p3_c2"
  page: number;        // page number in PDF
  text: string;        // chunk text
};

function normalizeSpaces(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Chunk each page into ~maxChars pieces with a small overlap.
 * This is simple + fast, and good enough to start getting real citations.
 */
export function chunkPdfPages(
  pages: Array<{ pageNumber: number; text: string }>,
  opts?: { maxChars?: number; overlapChars?: number }
): PdfChunk[] {
  const maxChars = opts?.maxChars ?? 900;
  const overlapChars = opts?.overlapChars ?? 120;

  const chunks: PdfChunk[] = [];

  for (const p of pages) {
    const raw = normalizeSpaces(p.text || "");
    if (!raw) continue;

    let start = 0;
    let chunkIndex = 0;

    while (start < raw.length) {
      const end = Math.min(raw.length, start + maxChars);
      const text = raw.slice(start, end).trim();
      if (text.length > 0) {
        chunkIndex += 1;
        chunks.push({
          id: `p${p.pageNumber}_c${chunkIndex}`,
          page: p.pageNumber,
          text,
        });
      }
      // move forward with overlap
      start = end - overlapChars;
      if (start < 0) start = 0;
      if (end === raw.length) break;
    }
  }

  return chunks;
}
