import React, { useMemo, useRef, useState } from "react";
import { extractPdfText, type ExtractedPdf } from "../rag/pdfExtract";
import { buildLessonPrompt, extractFirstJsonObject } from "../llm/prompts";
import { generateText, hasWebGPU } from "../llm/webllmClient";
import {
  layoutStar,
  normalizeLabels,
  type ConceptMap,
  type PositionedNode,
} from "../whiteboard/diagrams/conceptMap";

type IndexState =
  | { status: "idle" }
  | { status: "indexing"; filename: string }
  | { status: "indexed"; filename: string; numPages: number; pdf: ExtractedPdf }
  | { status: "error"; message: string };

type Lesson = {
  title: string;
  bullets: string[];
  diagram: ConceptMap;
  citations: number[];
  notes?: string;
};

type LessonState =
  | { status: "idle" }
  | { status: "loadingModel"; message: string }
  | { status: "generating"; message: string }
  | { status: "ready"; lesson: Lesson; raw: string }
  | { status: "error"; message: string; raw?: string };

function buildContextFromPdf(pdf: ExtractedPdf) {
  // Keep it short so local models don’t choke: first 2 pages, truncated.
  const pages = pdf.pages.slice(0, Math.min(2, pdf.pages.length));
  const parts = pages.map((p) => {
    const trimmed = p.text.slice(0, 2500);
    return `--- PAGE ${p.pageNumber} ---\n${trimmed}`;
  });
  return parts.join("\n\n");
}

function safeParseLesson(text: string): Lesson | null {
  const candidate = extractFirstJsonObject(text) ?? text;
  try {
    const obj = JSON.parse(candidate);

    if (!obj || typeof obj !== "object") return null;
    if (!obj.title || !Array.isArray(obj.bullets) || !obj.diagram) return null;

    const lesson: Lesson = {
      title: String(obj.title),
      bullets: Array.isArray(obj.bullets)
        ? obj.bullets.map((b: any) => String(b)).slice(0, 9)
        : [],
      diagram: {
        type: "concept_map",
        nodes: Array.isArray(obj.diagram?.nodes)
          ? obj.diagram.nodes
              .map((n: any, i: number) => ({
                id: String(n.id ?? `n${i + 1}`),
                label: String(n.label ?? ""),
              }))
              .filter((n: any) => n.label)
              .slice(0, 7)
          : [],
        edges: Array.isArray(obj.diagram?.edges)
          ? obj.diagram.edges
              .map((e: any) => ({
                from: String(e.from ?? ""),
                to: String(e.to ?? ""),
                label: e.label ? String(e.label) : "",
              }))
              .filter((e: any) => e.from && e.to)
              .slice(0, 7)
          : [],
      },
      citations: Array.isArray(obj.citations)
        ? obj.citations
            .map((c: any) => Number(c))
            .filter((n: any) => Number.isFinite(n))
        : [],
      notes: obj.notes ? String(obj.notes) : "",
    };

    return lesson;
  } catch {
    return null;
  }
}

// ---- VOICE (free, local) ----
function speakText(text: string) {
  if (!("speechSynthesis" in window)) return;

  // Stop anything currently speaking
  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1.0;
  utter.pitch = 1.0;
  utter.volume = 1.0;

  // Prefer Thai voice if the browser has one, else English, else first available.
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

export default function WhiteboardLesson() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [indexState, setIndexState] = useState<IndexState>({ status: "idle" });
  const [lessonState, setLessonState] = useState<LessonState>({
    status: "idle",
  });

  const [explainLevel, setExplainLevel] = useState<"simple" | "normal">(
    "simple"
  );

  // Default to a smaller model for 8GB machines; can override via Netlify env var.
  const modelId =
    (import.meta as any).env?.VITE_WEBLLM_MODEL ??
    "Llama-3.2-3B-Instruct-q4f16_1-MLC";

  // voice controls
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

    const context = buildContextFromPdf(indexState.pdf);
    const prompt = buildLessonPrompt({ explainLevel, context });

    try {
      setLessonState({ status: "loadingModel", message: "Loading model…" });

      const raw = await generateText(modelId, prompt, (msg) => {
        setLessonState({ status: "loadingModel", message: msg });
      });

      setLessonState({ status: "generating", message: "Generating lesson…" });

      const parsed = safeParseLesson(raw);
      if (!parsed) {
        setLessonState({
          status: "error",
          message: "Model output wasn’t valid JSON. Try again (or smaller PDF).",
          raw,
        });
        return;
      }

      setLessonState({ status: "ready", lesson: parsed, raw });

      // Auto-speak after lesson generates
      const speech = `${parsed.title}. ${parsed.bullets.join(" ")}`;
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
                  {lessonState.lesson.citations?.length > 0 && (
                    <span
                      className="source-pill"
                      title="Pages used"
                      style={{ marginLeft: 10 }}
                    >
                      📄 p.{lessonState.lesson.citations.join(", ")}
                    </span>
                  )}
                </div>

                {lessonState.lesson.bullets.map((b, i) => (
                  <div
                    key={i}
                    className="lesson-chunk"
                    style={{ marginBottom: 14 }}
                  >
                    • {b}
                  </div>
                ))}

                <DiagramPanel diagram={lessonState.lesson.diagram} />

                {lessonState.lesson.notes &&
                  lessonState.lesson.notes !== "string" && (
                    <div style={{ marginTop: 16, fontSize: 12, color: "#64748B" }}>
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
                Next step: make each bullet/diagram clickable (📄) to show exact
                quotes from the PDF pages used.
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
    </>
  );
}

function DiagramPanel({ diagram }: { diagram: ConceptMap }) {
  const width = 800;
  const height = 340;

  const nodes: PositionedNode[] = useMemo(() => {
    const cleaned = normalizeLabels(diagram.nodes).slice(0, 7);
    return layoutStar(cleaned, width, height);
  }, [diagram.nodes]);

  return (
    <div className="diagram-box" style={{ height: 320, padding: 0 }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`}>
        {/* edges (forced star: center -> others) */}
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

        {/* nodes */}
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
