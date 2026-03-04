import React, { useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";

type HighlightBox = { left: number; top: number; width: number; height: number };

type Props = {
  open: boolean;
  onClose: () => void;
  pdfData: ArrayBuffer | null;
  pageNumber: number;
  highlightPhrase: string;
  header?: string;
};

function normalize(s: string) {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// worker is still required in your environment (you saw that error before)
function ensureWorkerSrc() {
  try {
    const gwo = (pdfjsLib as any).GlobalWorkerOptions;
    if (!gwo) return;
    if (typeof gwo.workerSrc === "string" && gwo.workerSrc.length > 0) return;
    gwo.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.js";
  } catch {
    // ignore
  }
}

export default function PdfCitationPreview({
  open,
  onClose,
  pdfData,
  pageNumber,
  highlightPhrase,
  header,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<string>("");
  const [boxes, setBoxes] = useState<HighlightBox[]>([]);
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const wanted = useMemo(() => normalize(highlightPhrase), [highlightPhrase]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!open) return;

      setBoxes([]);
      setStatus("");

      if (!pdfData) {
        setStatus("No PDF data found. Upload the PDF again.");
        return;
      }
      if (!canvasRef.current) return;

      try {
        ensureWorkerSrc();

        // ✅ IMPORTANT: avoid "detached ArrayBuffer" by using a fresh copy every time
        const dataCopy = pdfData.slice(0);

        setStatus("Loading PDF…");
        const loadingTask = (pdfjsLib as any).getDocument({
          data: dataCopy,
          // keep this; workerSrc still must exist in your build
          disableWorker: true,
        });

        const pdf = await loadingTask.promise;
        if (cancelled) return;

        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;

        const baseViewport = page.getViewport({ scale: 1.0 });
        const targetWidth = 900;
        const scale = Math.min(2.0, Math.max(1.0, targetWidth / baseViewport.width));
        const viewport = page.getViewport({ scale });

        const canvas = canvasRef.current!;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas context not available.");

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        setCanvasSize({ w: canvas.width, h: canvas.height });

        setStatus("Rendering page…");
        await page.render({ canvasContext: ctx, viewport }).promise;
        if (cancelled) return;

        // No highlight phrase → just show the page
        if (!wanted || wanted.length < 6) {
          setStatus("");
          return;
        }

        setStatus("Finding highlight…");
        const tc = await page.getTextContent();
        if (cancelled) return;

        const items: any[] = (tc as any).items || [];
        if (!items.length) {
          setStatus("No selectable text on this page (maybe scanned PDF).");
          return;
        }

        const itemTexts = items.map((it) => normalize(it.str || ""));

        // Find a range of items whose combined text includes the phrase
        let bestRange: { start: number; end: number } | null = null;

        for (let start = 0; start < itemTexts.length; start++) {
          let joined = "";
          for (let end = start; end < Math.min(itemTexts.length, start + 60); end++) {
            const t = itemTexts[end];
            if (t) joined = joined ? joined + " " + t : t;

            if (joined.includes(wanted)) {
              bestRange = { start, end };
              break;
            }
            if (joined.length > wanted.length + 220) break;
          }
          if (bestRange) break;
        }

        // fallback: shorter phrase
        if (!bestRange) {
          const shorter = wanted.split(" ").slice(0, 10).join(" ");
          for (let start = 0; start < itemTexts.length; start++) {
            let joined = "";
            for (let end = start; end < Math.min(itemTexts.length, start + 60); end++) {
              const t = itemTexts[end];
              if (t) joined = joined ? joined + " " + t : t;

              if (joined.includes(shorter)) {
                bestRange = { start, end };
                break;
              }
              if (joined.length > shorter.length + 220) break;
            }
            if (bestRange) break;
          }
        }

        if (!bestRange) {
          setStatus("Highlight not found (showing page only).");
          return;
        }

        // ✅ Accurate box conversion using viewport.convertToViewportRectangle
        const newBoxes: HighlightBox[] = [];

        for (let i = bestRange.start; i <= bestRange.end; i++) {
          const it = items[i];
          if (!it?.transform) continue;

          // it.transform: [a,b,c,d,e,f] where e,f are x,y in PDF space
          const e = it.transform[4];
          const f = it.transform[5];

          // width/height are in PDF space units for text item
          const w = it.width ?? 0;
          const h = it.height ?? 0;

          if (!(w > 0 && h > 0)) continue;

          // Convert PDF-rect -> viewport rect
          const [vx1, vy1, vx2, vy2] = viewport.convertToViewportRectangle([
            e,
            f,
            e + w,
            f + h,
          ]);

          const left = Math.min(vx1, vx2);
          const top = Math.min(vy1, vy2);
          const width = Math.abs(vx2 - vx1);
          const height = Math.abs(vy2 - vy1);

          // Filter tiny junk boxes
          if (width > 2 && height > 2) {
            newBoxes.push({ left, top, width, height });
          }
        }

        setBoxes(newBoxes);
        setStatus("");
      } catch (e: any) {
        setStatus(`PDF preview error: ${e?.message ?? "Unknown error"}`);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [open, pdfData, pageNumber, wanted]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.55)",
        zIndex: 9999,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "min(980px, 95vw)",
          maxHeight: "92vh",
          background: "white",
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "12px 14px",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ fontWeight: 700 }}>
            {header ?? `PDF Preview — Page ${pageNumber}`}
          </div>
          <button
            onClick={onClose}
            style={{
              border: "1px solid #e5e7eb",
              background: "#fff",
              borderRadius: 10,
              padding: "6px 10px",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>

        <div style={{ padding: 14, overflow: "auto", maxHeight: "82vh" }}>
          {status && (
            <div style={{ marginBottom: 10, color: "#64748B", fontSize: 13 }}>
              {status}
            </div>
          )}

          <div style={{ position: "relative", display: "inline-block" }}>
            <canvas ref={canvasRef} style={{ display: "block" }} />
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: canvasSize.w,
                height: canvasSize.h,
                pointerEvents: "none",
              }}
            >
              {boxes.map((b, idx) => (
                <div
                  key={idx}
                  style={{
                    position: "absolute",
                    left: b.left,
                    top: b.top,
                    width: b.width,
                    height: b.height,
                    background: "rgba(250, 204, 21, 0.32)",
                    outline: "1px solid rgba(250, 204, 21, 0.55)",
                    borderRadius: 3,
                  }}
                />
              ))}
            </div>
          </div>

          {highlightPhrase && (
            <div style={{ marginTop: 12, fontSize: 12, color: "#475569" }}>
              <b>Highlight phrase:</b> {highlightPhrase}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
