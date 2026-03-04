import React, { useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";

(pdfjsLib as any).GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.js";

(pdfjsLib as any).GlobalWorkerOptions.workerSrc =
`https://cdn.jsdelivr.net/npm/pdfjs-dist@${(pdfjsLib as any).version}/build/pdf.worker.min.js`;

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
      if (!pdfData) {
        setStatus("No PDF bytes found. Upload the PDF again.");
        return;
      }
      if (!canvasRef.current) return;

      try {
        setStatus("Loading PDF…");

        const loadingTask = (pdfjsLib as any).getDocument({ data: pdfData });
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
        let bestRange: { start: number; end: number } | null = null;

        for (let start = 0; start < itemTexts.length; start++) {
          let joined = "";
          for (let end = start; end < Math.min(itemTexts.length, start + 70); end++) {
            const t = itemTexts[end];
            if (t) joined = joined ? joined + " " + t : t;

            if (joined.includes(wanted)) {
              bestRange = { start, end };
              break;
            }
            if (joined.length > wanted.length + 260) break;
          }
          if (bestRange) break;
        }

        if (!bestRange) {
          const shorter = wanted.split(" ").slice(0, 10).join(" ");
          if (shorter.length > 6) {
            for (let start = 0; start < itemTexts.length; start++) {
              let joined = "";
              for (let end = start; end < Math.min(itemTexts.length, start + 70); end++) {
                const t = itemTexts[end];
                if (t) joined = joined ? joined + " " + t : t;

                if (joined.includes(shorter)) {
                  bestRange = { start, end };
                  break;
                }
                if (joined.length > shorter.length + 260) break;
              }
              if (bestRange) break;
            }
          }
        }

        if (!bestRange) {
          setStatus("Highlight not found (showing page only).");
          return;
        }

        const util = (pdfjsLib as any).Util;
        const newBoxes: HighlightBox[] = [];

        for (let i = bestRange.start; i <= bestRange.end; i++) {
          const it = items[i];
          if (!it?.transform) continue;

          const tx = util.transform(viewport.transform, it.transform);
          const x = tx[4];
          const y = tx[5];

          const w = (it.width ?? 0) * scale;
          const h = (it.height ?? 0) * scale || 12;
          const top = canvas.height - y - h;

          if (w > 2 && h > 2) {
            newBoxes.push({ left: x, top, width: w, height: h });
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
                    background: "rgba(250, 204, 21, 0.35)",
                    outline: "1px solid rgba(250, 204, 21, 0.6)",
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
