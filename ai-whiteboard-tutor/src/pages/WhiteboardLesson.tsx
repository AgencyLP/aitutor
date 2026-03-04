import React, { useMemo, useRef, useState } from "react";
import { extractPdfText, type ExtractedPdf } from "../rag/pdfExtract";
import {
  buildLessonPrompt,
  buildJsonRepairPrompt,
  extractFirstJsonObject,
} from "../llm/prompts";
import { generateText, hasWebGPU } from "../llm/webllmClient";
import { chunkPdfPages } from "../rag/chunking";
import { retrieveTopChunks, retrieveTopChunksDiverse } from "../rag/retriever";
import {
  layoutStar,
  normalizeLabels,
  type PositionedNode,
} from "../whiteboard/diagrams/conceptMap";

// ✅ NEW: PDF preview modal
import PdfCitationPreview from "../components/PdfCitationPreview";

type IndexState =
  | { status: "idle" }
  | { status: "indexing"; filename: string }
  | { status: "indexed"; filename: string; numPages: number; pdf: ExtractedPdf }
  | { status: "error"; message: string };

type Citation = { page: number; chunkId: string; quote: string };

type Bullet = {
  text: string;
  cites: Citation[];
};

type Diagram = {
  type: "concept_map" | "flowchart" | "timeline";
  nodes: Array<{ id: string; label: string }>;
  edges: Array<{ from: string; to: string; label?: string }>;
};

type Lesson = {
  title: string;
  bullets: Bullet[];
  diagram: Diagram;
  notes?: string;
};

type LessonState =
  | { status: "idle" }
  | { status: "loadingModel"; message: string }
  | { status: "generating"; message: string }
  | { status: "ready"; lesson: Lesson; raw: string }
  | { status: "error"; message: string; raw?: string };

function safeParseLesson(text: string): Lesson | null {
  const candidate = extractFirstJsonObject(text) ?? text;
  try {
    const obj = JSON.parse(candidate);

    if (!obj || typeof obj !== "object") return null;
    if (!obj.title || !Array.isArray(obj.bullets) || !obj.diagram) return null;

    const diagramType =
      obj.diagram?.type === "flowchart" || obj.diagram?.type === "timeline"
        ? obj.diagram.type
        : "concept_map";

    const bullets: Bullet[] = Array.isArray(obj.bullets)
      ? obj.bullets
          .map((b: any) => ({
            text: String(b?.text ?? ""),
            cites: Array.isArray(b?.cites)
              ? b.cites
                  .map((c: any) => ({
                    page: Number(c?.page),
                    chunkId: String(c?.chunkId ?? ""),
                    quote: String(c?.quote ?? ""),
                  }))
                  .filter(
                    (c: any) =>
                      Number.isFinite(c.page) &&
                      c.page > 0 &&
                      c.chunkId &&
                      c.quote
                  )
              : [],
          }))
          .filter((b: any) => b.text)
          .slice(0, 12)
      : [];

    const lesson: Lesson = {
      title: String(obj.title),
      bullets,
      diagram: {
        type: diagramType,
        nodes: Array.isArray(obj.diagram?.nodes)
          ? obj.diagram.nodes
              .map((n: any, i: number) => ({
                id: String(n.id ?? `n${i + 1}`),
                label: String(n.label ?? ""),
              }))
              .filter((n: any) => n.label)
              .slice(0, 8)
          : [],
        edges: Array.isArray(obj.diagram?.edges)
          ? obj.diagram.edges
              .map((e: any) => ({
                from: String(e.from ?? ""),
                to: String(e.to ?? ""),
                label: e.label ? String(e.label) : "",
              }))
              .filter((e: any) => e.from && e.to)
              .slice(0, 10)
          : [],
      },
      notes: obj.notes ? String(obj.notes) : "",
    };

    // Must have bullets with citations to be considered valid
    if (lesson.bullets.length === 0) return null;
    if (lesson.bullets.every((b) => (b.cites?.length ?? 0) === 0)) return null;

    return lesson;
  } catch {
    return null;
  }
}

// ---- VOICE (free, local) ----
function speakText(text: string) {
  if (!("speechSynthesis" in window)) return;

  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1.0;
  utter.pitch = 1.0;
  utter.volume = 1.0;

  const voices = window.speechSynthesis.getVoices();
  const preferThai =
    voices.find((v) => (v.lang || "").toLowerCase().startsWith("th")) || null;
  const preferEnglish =
    voices.find((v) => (v.lang || "").toLowerCase().startsWith("en")) || null;

  if (preferThai) utter.voice = preferThai;
  else if (preferEnglish) utter.voice = preferEnglish;
  else if (voices[0]) utter.voice = voices[0];

  window.speechSynthesis.speak(utter);
}

// ✅ NEW: choose a highlight phrase from real PDF chunk text
function pickHighlightPhrase(chunkText: string) {
  const clean = (chunkText || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const words = clean.split(" ");
  return words.slice(0, 14).join(" "); // first ~14 words usually match
}

// ✅ NEW: snippet for showing a real PDF-backed quote
function snippetFromChunkText(chunkText: string) {
  const clean = (chunkText || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.slice(0, 220);
}

export default function WhiteboardLesson() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [indexState, setIndexState] = useState<IndexState>({ status: "idle" });
  const [lessonState, setLessonState] = useState<LessonState>({
    status: "idle",
  });

  const [explainLevel, setExplainLevel] = useState<"simple" | "normal">(
    "simple"
  );

  // ✅ Inline citations per bullet (toggle open)
  const [openBulletIndex, setOpenBulletIndex] = useState<number | null>(null);

  // ✅ NEW: store PDF bytes so we can render it later
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);

  // ✅ NEW: map chunkId -> real chunk text (from extraction)
  const chunkMapRef = useRef<Map<string, { page: number; text: string }>>(
    new Map()
  );

  // ✅ NEW: preview modal state
  const [preview, setPreview] = useState<null | {
    page: number;
    chunkId: string;
    phrase: string;
  }>(null);

  // Default model; can override via Netlify env var.
  const modelId =
    (import.meta as any).env?.VITE_WEBLLM_MODEL ??
    "Llama-3.2-3B-Instruct-q4f16_1-MLC";

  const [lastSpoken, setLastSpoken] = useState<string>("");

  const statusBadge = useMemo(() => {
    if (indexState.status === "idle") return "No PDF yet";
    if (indexState.status === "indexing") return "Indexing…";
    if (indexState.status === "indexed")
      return `Indexed ✅ (${indexState.numPages} pages)`;
    return "Error";
  }, [indexState]);

  const onPickFile = () => fileInputRef.current?.click();

  const handleFile = async (file: File) => {
    try {
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        setIndexState({ status: "error", message: "Please upload a PDF file." });
        return;
      }
      setIndexState({ status: "indexing", filename: file.name });
      setLessonState({ status: "idle" });
      setOpenBulletIndex(null);
      setPreview(null);

      // ✅ Store bytes for later preview rendering
      const bytes = await file.arrayBuffer();
      setPdfData(bytes);

      const pdf = await extractPdfText(file);

      setIndexState({
        status: "indexed",
        filename: file.name,
        numPages: pdf.numPages,
        pdf,
      });
    } catch (e: any) {
      setIndexState({
        status: "error",
        message: e?.message ?? "Failed to read PDF.",
      });
    }
  };

  const onDrop: React.DragEventHandler<HTMLDivElement> = async (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) await handleFile(file);
  };

  const onDragOver: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
  };

  async function startLesson() {
    if (indexState.status !== "indexed") return;

    if (!hasWebGPU()) {
      setLessonState({
        status: "error",
        message:
          "WebGPU not detected. This free demo uses in-browser AI (WebGPU). Try Chrome desktop on a supported laptop.",
      });
      return;
    }

    // ✅ Build chunks for all pages
    const allChunks = chunkPdfPages(indexState.pdf.pages, {
      maxChars: 900,
      overlapChars: 120,
    });

    // ✅ Build real chunk map (for trustworthy previews/snippets)
    const map = new Map<string, { page: number; text: string }>();
    for (const c of allChunks) map.set(c.id, { page: c.page, text: c.text });
    chunkMapRef.current = map;

    const seedQuery =
      "summary key concepts definitions statistics findings implications conclusion";

    // ✅ GUARANTEE multi-page evidence (best 1 chunk per page)
    const chunksByPage = new Map<number, typeof allChunks>();
    for (const c of allChunks) {
      if (!chunksByPage.has(c.page)) chunksByPage.set(c.page, []);
      chunksByPage.get(c.page)!.push(c);
    }

    const guaranteed: typeof allChunks = [];
    const pages = Array.from(chunksByPage.keys()).sort((a, b) => a - b);

    for (const p of pages) {
      const best = retrieveTopChunks(seedQuery, chunksByPage.get(p)!, 1);
      if (best[0]) guaranteed.push(best[0]);
    }

    // ✅ Add extra chunks (diverse) for richness (still capped)
    const extra = retrieveTopChunksDiverse({
      query: seedQuery,
      chunks: allChunks,
      k: 6,
      maxPerPage: 2,
      minDistinctPages: Math.min(2, indexState.numPages),
    });

    // Merge unique
    const merged = [...guaranteed];
    const seen = new Set(merged.map((c) => c.id));
    for (const c of extra) {
      if (!seen.has(c.id)) {
        merged.push(c);
        seen.add(c.id);
      }
      if (merged.length >= 10) break;
    }

    const evidence = merged.map((c) => ({
      chunkId: c.id,
      page: c.page,
      text: c.text,
    }));

    const prompt = buildLessonPrompt({
      explainLevel,
      evidence,
      numPages: indexState.numPages,
    });

    try {
      setLessonState({ status: "loadingModel", message: "Loading model…" });

      const raw = await generateText(modelId, prompt, (msg) => {
        setLessonState({ status: "loadingModel", message: msg });
      });

      setLessonState({ status: "generating", message: "Generating lesson…" });

      let parsed = safeParseLesson(raw);

      // ✅ JSON repair fallback (fixes Normal mode)
      if (!parsed) {
        const repairPrompt = buildJsonRepairPrompt(raw);
        const repaired = await generateText(modelId, repairPrompt);
        parsed = safeParseLesson(repaired);

        if (!parsed) {
          setLessonState({
            status: "error",
            message:
              "Model output wasn’t valid JSON. Try again (or smaller PDF).",
            raw,
          });
          return;
        }
      }



            // ✅ Force citations to match each bullet text (code-grounded)
      const fixedBullets = parsed.bullets.map((b) => {
        const best = retrieveTopChunks(b.text, allChunks, 2);
        const cites = best.map((c) => ({
          page: c.page,
          chunkId: c.id,
          quote: snippetFromChunkText(c.text),
        }));
        return { ...b, cites };
      });

      parsed = { ...parsed, bullets: fixedBullets };

      
      setLessonState({ status: "ready", lesson: parsed, raw });
      setOpenBulletIndex(null);
      setPreview(null);

      // Auto-speak
      const speech = `${parsed.title}. ${parsed.bullets
        .map((b) => b.text)
        .join(" ")}`;
      setLastSpoken(speech);
      speakText(speech);
    } catch (e: any) {
      setLessonState({
        status: "error",
        message: e?.message ?? "Failed to generate lesson.",
      });
    }
  }

  return (
    <>
      <header className="app-header">
        <div className="brand">THAI ED-AI TUTOR</div>

        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <div className="mode-badge">
            <span>🔒 PDF Strict Mode</span>
          </div>

          <div className="mode-badge" style={{ gap: 10 }}>
            <span style={{ opacity: 0.75 }}>Explain:</span>
            <button
              className="video-btn"
              style={{
                padding: "6px 10px",
                fontSize: "0.8rem",
                background:
                  explainLevel === "simple" ? "var(--primary-grad)" : "#E8F0FE",
                color: explainLevel === "simple" ? "white" : "#2C3E50",
              }}
              onClick={() => setExplainLevel("simple")}
            >
              Simple
            </button>
            <button
              className="video-btn"
              style={{
                padding: "6px 10px",
                fontSize: "0.8rem",
                background:
                  explainLevel === "normal" ? "var(--primary-grad)" : "#E8F0FE",
                color: explainLevel === "normal" ? "white" : "#2C3E50",
              }}
              onClick={() => setExplainLevel("normal")}
            >
              Normal
            </button>
          </div>

          <button
            className="video-btn"
            onClick={startLesson}
            disabled={indexState.status !== "indexed"}
            style={{
              opacity: indexState.status === "indexed" ? 1 : 0.5,
              cursor:
                indexState.status === "indexed" ? "pointer" : "not-allowed",
            }}
          >
            Start Lesson
          </button>

          <button
            className="video-btn"
            onClick={() => window.speechSynthesis.cancel()}
            style={{
              padding: "6px 12px",
              fontSize: "0.8rem",
              background: "#E8F0FE",
              color: "#2C3E50",
            }}
          >
            Stop Voice
          </button>

          <button
            className="video-btn"
            onClick={() => lastSpoken && speakText(lastSpoken)}
            disabled={!lastSpoken}
            style={{
              padding: "6px 12px",
              fontSize: "0.8rem",
              background: lastSpoken ? "var(--primary-grad)" : "#E8F0FE",
              color: lastSpoken ? "white" : "#2C3E50",
              opacity: lastSpoken ? 1 : 0.5,
              cursor: lastSpoken ? "pointer" : "not-allowed",
            }}
          >
            Replay Voice
          </button>
        </div>
      </header>

      <div className="workspace">
        {/* LEFT DRAWER */}
        <aside className="drawer-left">
          <div
            className="upload-zone"
            role="button"
            tabIndex={0}
            onClick={onPickFile}
            onDrop={onDrop}
            onDragOver={onDragOver}
            title="Click to upload or drag a PDF here"
          >
            <p style={{ margin: 0 }}>
              {indexState.status === "indexed"
                ? `PDF: ${indexState.filename}`
                : "Click or drag PDF here"}
            </p>

            <div className="status-badge">{statusBadge}</div>

            {indexState.status === "error" && (
              <div style={{ marginTop: 10, color: "#B91C1C", fontSize: 12 }}>
                {indexState.message}
              </div>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.currentTarget.value = "";
            }}
          />

          <div className="topic-list">
            <h4>STATUS</h4>
            <ul>
              <li>
                • Model: <span style={{ opacity: 0.8 }}>{modelId}</span>
              </li>
              {lessonState.status === "idle" && <li>• Ready to start lesson</li>}
              {lessonState.status === "loadingModel" && (
                <li>• Loading: {lessonState.message}</li>
              )}
              {lessonState.status === "generating" && (
                <li>• {lessonState.message}</li>
              )}
              {lessonState.status === "ready" && <li>• Lesson generated ✅</li>}
              {lessonState.status === "error" && (
                <li style={{ color: "#B91C1C" }}>• {lessonState.message}</li>
              )}
            </ul>
          </div>
        </aside>

        {/* CENTER WHITEBOARD */}
        <main className="whiteboard-stage">
          <div className="whiteboard-surface">
            {lessonState.status !== "ready" ? (
              <>
                <div className="lesson-chunk">
                  <strong>
                    {indexState.status === "indexed"
                      ? "Ready. Click Start Lesson."
                      : "Upload a PDF to start."}
                  </strong>
                  <div style={{ marginTop: 10, color: "#64748B", fontSize: 14 }}>
                    This demo runs AI on your laptop (WebGPU) and teaches from
                    the PDF only.
                  </div>
                </div>

                <div className="diagram-box">
                  {indexState.status === "indexed"
                    ? "[ Waiting to generate lesson… ]"
                    : "[ Whiteboard area — waiting for PDF ]"}
                </div>
              </>
            ) : (
              <>
                <div className="lesson-chunk">
                  <strong>{lessonState.lesson.title}</strong>
                </div>

                {lessonState.lesson.bullets.map((b, i) => {
                  const open = openBulletIndex === i;
                  return (
                    <div
                      key={i}
                      className="lesson-chunk"
                      style={{ marginBottom: 12 }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 8,
                        }}
                      >
                        <div style={{ marginTop: 2 }}>•</div>
                        <div style={{ flex: 1 }}>{b.text}</div>

                        {/* Icon next to each bullet */}
                        <button
                          className="source-pill"
                          title="Show PDF source"
                          style={{
                            border: "none",
                            cursor: "pointer",
                            padding: "4px 8px",
                          }}
                          onClick={() => setOpenBulletIndex(open ? null : i)}
                        >
                          📄
                        </button>
                      </div>

                      {/* Inline citations under that bullet */}
                      {open && b.cites?.length > 0 && (
                        <div
                          style={{
                            marginTop: 8,
                            marginLeft: 18,
                            padding: 10,
                            border: "1px solid #e5e7eb",
                            borderRadius: 10,
                            background: "#fff",
                            fontSize: 12,
                            color: "#334155",
                          }}
                        >
                          {b.cites.map((c, idx) => {
                            const real = chunkMapRef.current.get(c.chunkId);
                            const page = real?.page ?? c.page;
                            const phrase = pickHighlightPhrase(real?.text ?? "");
                            return (
                              <div
                                key={idx}
                                style={{
                                  marginBottom: 10,
                                  paddingBottom: 10,
                                  borderBottom: "1px solid #f1f5f9",
                                  cursor: "pointer",
                                }}
                                title="Click to open PDF preview + highlight"
                                onClick={() =>
                                  setPreview({
                                    page,
                                    chunkId: c.chunkId,
                                    phrase,
                                  })
                                }
                              >
                                <div>
                                  <b>p.{page}</b> — <code>{c.chunkId}</code>
                                </div>
                                <div style={{ opacity: 0.9 }}>
                                  "{phrase ? phrase + "…" : c.quote}"
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}

                <DiagramPanel diagram={lessonState.lesson.diagram} />

                {lessonState.lesson.notes &&
                  lessonState.lesson.notes !== "string" && (
                    <div
                      style={{ marginTop: 16, fontSize: 12, color: "#64748B" }}
                    >
                      Note: {lessonState.lesson.notes}
                    </div>
                  )}
              </>
            )}
          </div>
        </main>

        {/* RIGHT DRAWER */}
        <aside className="drawer-right">
          <div className="evidence-header">Source Evidence</div>
          <div className="evidence-content">
            <div className="quote-box">
              <em style={{ color: "#64748B" }}>
                Click 📄 next to a bullet, then click a citation to open PDF
                preview with highlight.
              </em>
            </div>

            {lessonState.status === "error" && lessonState.raw && (
              <details>
                <summary style={{ cursor: "pointer" }}>
                  Show raw model output
                </summary>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
                  {lessonState.raw}
                </pre>
              </details>
            )}
          </div>
        </aside>
      </div>

      {/* ✅ PDF Preview Modal */}
      <PdfCitationPreview
        open={!!preview}
        onClose={() => setPreview(null)}
        pdfData={pdfData}
        pageNumber={preview?.page ?? 1}
        highlightPhrase={preview?.phrase ?? ""}
        header={
          preview
            ? `PDF Preview — p.${preview.page} (${preview.chunkId})`
            : undefined
        }
      />
    </>
  );
}

function DiagramPanel({ diagram }: { diagram: Diagram }) {
  const width = 800;
  const height = 340;

  if (diagram?.type === "flowchart") {
    const nodes = (diagram.nodes ?? []).slice(0, 8);
    const boxW = 180;
    const boxH = 38;
    const gap = 18;

    const totalH = nodes.length * boxH + Math.max(0, nodes.length - 1) * gap;
    const startY = Math.max(20, (height - totalH) / 2);
    const x = width / 2;

    return (
      <div className="diagram-box" style={{ height: 320, padding: 0 }}>
        <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`}>
          {nodes.map((n, i) => {
            const y = startY + i * (boxH + gap);
            return (
              <g key={n.id ?? i}>
                {i > 0 && (
                  <line
                    x1={x}
                    y1={y - gap}
                    x2={x}
                    y2={y}
                    stroke="#94A3B8"
                    strokeWidth={2}
                  />
                )}
                <rect
                  x={x - boxW / 2}
                  y={y}
                  width={boxW}
                  height={boxH}
                  rx={10}
                  fill="#FFFFFF"
                  stroke="#CBD5E0"
                />
                <text
                  x={x}
                  y={y + 24}
                  fontSize={13}
                  fill="#0F172A"
                  textAnchor="middle"
                >
                  {String(n.label || "").slice(0, 22)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    );
  }

  if (diagram?.type === "timeline") {
    const nodes = (diagram.nodes ?? []).slice(0, 8);
    const boxW = 140;
    const boxH = 38;

    const totalW = nodes.length * boxW + Math.max(0, nodes.length - 1) * 20;
    const startX = Math.max(20, (width - totalW) / 2);
    const y = height / 2;

    return (
      <div className="diagram-box" style={{ height: 320, padding: 0 }}>
        <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`}>
          {nodes.map((n, i) => {
            const x = startX + i * (boxW + 20);
            return (
              <g key={n.id ?? i}>
                {i > 0 && (
                  <line
                    x1={x - 20}
                    y1={y}
                    x2={x}
                    y2={y}
                    stroke="#94A3B8"
                    strokeWidth={2}
                  />
                )}
                <rect
                  x={x}
                  y={y - boxH / 2}
                  width={boxW}
                  height={boxH}
                  rx={10}
                  fill="#FFFFFF"
                  stroke="#CBD5E0"
                />
                <text
                  x={x + boxW / 2}
                  y={y + 5}
                  fontSize={13}
                  fill="#0F172A"
                  textAnchor="middle"
                >
                  {String(n.label || "").slice(0, 22)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    );
  }

  // Default: concept_map star layout
  const nodes: PositionedNode[] = useMemo(() => {
    const cleaned = normalizeLabels((diagram.nodes ?? [])).slice(0, 7);
    return layoutStar(cleaned, width, height);
  }, [diagram.nodes]);

  return (
    <div className="diagram-box" style={{ height: 320, padding: 0 }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`}>
        {nodes.length > 1 &&
          nodes.slice(1).map((n, idx) => (
            <line
              key={idx}
              x1={nodes[0].x}
              y1={nodes[0].y}
              x2={n.x}
              y2={n.y}
              stroke="#94A3B8"
              strokeWidth={2}
            />
          ))}

        {nodes.map((n) => (
          <g key={n.id}>
            <rect
              x={n.x - 75}
              y={n.y - 19}
              width={150}
              height={38}
              rx={10}
              fill="#FFFFFF"
              stroke="#CBD5E0"
            />
            <text
              x={n.x}
              y={n.y + 4}
              fontSize={13}
              fill="#0F172A"
              textAnchor="middle"
            >
              {n.label.length > 22 ? n.label.slice(0, 22) + "…" : n.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

