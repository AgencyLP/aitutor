import * as pdfjsLib from "pdfjs-dist";

// For Vite/browser builds, use the worker shipped by pdfjs-dist
// This prevents "workerSrc" errors in production.
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";

(pdfjsLib as any).GlobalWorkerOptions.workerSrc = pdfjsWorker;

export type ExtractedPdf = {
  pages: Array<{ pageNumber: number; text: string }>;
  numPages: number;
};

export async function extractPdfText(file: File): Promise<ExtractedPdf> {
  const buf = await file.arrayBuffer();
  const loadingTask = (pdfjsLib as any).getDocument({ data: buf });
  const pdf = await loadingTask.promise;

  const pages: ExtractedPdf["pages"] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = (content.items || [])
      .map((it: any) => (typeof it.str === "string" ? it.str : ""))
      .filter(Boolean);

    // Join with spaces so it reads naturally
    const text = strings.join(" ").replace(/\s+/g, " ").trim();
    pages.push({ pageNumber: i, text });
  }

  return { pages, numPages: pdf.numPages };
}
