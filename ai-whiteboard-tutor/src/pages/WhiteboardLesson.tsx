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
import PdfCitationPreview from "../components/PdfCitationPreview";

import { webSearchPool } from "../web/webSearch";
import type { WebResult } from "../web/wikiSearch";

type IndexState =
  | { status: "idle" }
  | { status: "indexing"; filename: string }
  | { status: "indexed"; filename: string; numPages: number; pdf: ExtractedPdf }
  | { status: "error"; message: string };

type Citation = { page: number; chunkId: string; quote: string };

type Bullet = { text: string; cites: Citation[] };

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

type WebPick = WebResult & { bulletIndex: number };

type WebSummary = {
  bulletIndex: number;
  text: string;
  url: string;
  title: string;
  source: string; // keep generic to avoid TS union mismatch
};

function safeParseLesson(text: string): Lesson | null {
  const candidate =
    extractFirstJsonObject(text) ?? extractFirstJsonObject("{" + text) ?? text;

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

    if (lesson.bullets.length === 0) return null;
    if (lesson.bullets.every((b) => (b.cites?.length ?? 0) === 0)) return null;

    return lesson;
  } catch {
    return null;
  }
}

// ---- VOICE ----
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

function tokenize(s: string) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9ก-๙\s]/g, " ")
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2);
}

function scoreBulletToWeb(bulletText: string, r: WebResult) {
  const a = tokenize(bulletText);
  const b = tokenize((r.title + " " + (r.snippet || "")).slice(0, 300));
  const setB = new Set(b);
  let hit = 0;
  for (const t of a) if (setB.has(t)) hit++;
  return hit;
}

function pickHighlightPhrase(chunkText: string) {
  const clean = (chunkText || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.split(" ").slice(0, 14).join(" ");
}

function snippetFromChunkText(chunkText: string) {
  const clean = (chunkText || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.slice(0, 220);
}

// ---- WEB SUMMARY PROMPT ----
function buildWebSummaryPrompt(params: {
  title: string;
  bullets: string[];
  picks: Array<{ bulletIndex: number; title: string; snippet: string }>;
}) {
  const block = params.picks
    .map(
      (p) =>
        `BULLET_INDEX: ${p.bulletIndex}\nSOURCE_TITLE: ${p.title}\nSOURCE_SNIPPET: ${p.snippet}`
    )
    .join("\n\n---\n\n");

  return `
You are helping craft short "web takeaways" for an EdTech AI tutor UI.

Rules:
- Output MUST be valid JSON ONLY.
- For each provided pick, write 1–2 short sentences that match the bullet topic.
- Do NOT invent facts not present in the snippet.
- Keep it concise and readable.

Return JSON array with schema:
[
  { "bulletIndex": 0, "text": "1–2 sentences" },
  ...
]

LESSON_TITLE: ${params.title}

BULLETS:
${params.bullets.map((b, i) => `${i}: ${b}`).join("\n")}

WEB_PICKS:
${block}
`.trim();
}

function safeParseWebSummaries(text: string): Array<{ bulletIndex: number; text: string }> | null {
  const candidate =
    extractFirstJsonObject(text) ?? extractFirstJsonObject("[" + text) ?? text;

  try {
    const arr = JSON.parse(candidate);
    if (!Array.isArray(arr)) return null;

    const out = arr
      .map((x: any) => ({
        bulletIndex: Number(x?.bulletIndex),
        text: String(x?.text ?? "").trim(),
      }))
      .filter((x) => Number.isFinite(x.bulletIndex) && x.text);

    return out.length ? out : null;
  } catch {
    return null;
  }
}

export default function WhiteboardLesson() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [indexState, setIndexState] = useState<IndexState>({ status: "idle" });
  const [lessonState, setLessonState] = useState<LessonState>({ status: "idle" });

  const [explainLevel, setExplainLevel] = useState<"simple" | "normal">("simple");
  const [openBulletIndex, setOpenBulletIndex] = useState<number | null>(null);

  const [useWeb, setUseWeb] = useState<boolean>(false);
  const [webStatus, setWebStatus] = useState<string>("");
  const [webSummaries, setWebSummaries] = useState<WebSummary[]>([]);

  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const chunkMapRef = useRef<Map<string, { page: number; text: string }>>(new Map());

  const [preview, setPreview] = useState<null | { page: number; chunkId: string; phrase: string }>(null);

  const modelId =
    (import.meta as any).env?.VITE_WEBLLM_MODEL ??
    "Llama-3.2-3B-Instruct-q4f16_1-MLC";

  const [lastSpoken, setLastSpoken] = useState<string>("");

  const statusBadge = useMemo(() => {
    if (indexState.status === "idle") return "No PDF yet";
    if (indexState.status === "indexing") return "Indexing…";
    if (indexState.status === "indexed") return `Indexed ✅ (${indexState.numPages} pages)`;
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
      setWebStatus("");
      setWebSummaries([]);

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
      setIndexState({ status: "error", message: e?.message ?? "Failed to read PDF." });
    }
  };

  const onDrop: React.DragEventHandler<HTMLDivElement> = async (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) await handleFile(file);
  };

  const onDragOver: React.DragEventHandler<HTMLDivElement> = (e) => e.preventDefault();

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

    setWebStatus("");
    setWebSummaries([]);

    const allChunks = chunkPdfPages(indexState.pdf.pages, { maxChars: 900, overlapChars: 120 });

    // build chunk map for preview text
    const map = new Map<string, { page: number; text: string }>();
    for (const c of allChunks) map.set(c.id, { page: c.page, text: c.text });
    chunkMapRef.current = map;

    const seedQuery =
      "summary key concepts definitions statistics findings implications conclusion";

    // guarantee at least 1 chunk per page
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

    const extra = retrieveTopChunksDiverse({
      query: seedQuery,
      chunks: allChunks,
      k: 6,
      maxPerPage: 2,
      minDistinctPages: Math.min(2, indexState.numPages),
    });

    const merged = [...guaranteed];
    const seen = new Set(merged.map((c) => c.id));
    for (const c of extra) {
      if (!seen.has(c.id)) {
        merged.push(c);
        seen.add(c.id);
      }
      if (merged.length >= 10) break;
    }

    const evidence = merged.map((c) => ({ chunkId: c.id, page: c.page, text: c.text }));

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

      if (!parsed) {
        const repairPrompt = buildJsonRepairPrompt(raw);
        const repaired = await generateText(modelId, repairPrompt);
        parsed = safeParseLesson(repaired);

        if (!parsed) {
          setLessonState({
            status: "error",
            message:
              "Model output wasn’t valid JSON. Open raw output below (it includes the repaired attempt too).",
            raw: raw + "\n\n----- REPAIRED ATTEMPT -----\n\n" + repaired,
          });
          return;
        }
      }

      // Re-rank citations per bullet & reduce repetition
      const usedChunkIds = new Set<string>();
      const fixedBullets = parsed.bullets.map((b) => {
        const candidates = retrieveTopChunks(b.text, allChunks, 8);

        const picked: typeof candidates = [];
        for (const c of candidates) {
          if (!usedChunkIds.has(c.id)) {
            picked.push(c);
            usedChunkIds.add(c.id);
          }
          if (picked.length >= 2) break;
        }

        if (picked.length < 1 && candidates[0]) picked.push(candidates[0]);
        if (picked.length < 2 && candidates[1]) picked.push(candidates[1]);

        const cites = picked.map((c) => ({
          page: c.page,
          chunkId: c.id,
          quote: snippetFromChunkText(c.text),
        }));

        return { ...b, cites };
      });

      parsed = { ...parsed, bullets: fixedBullets };

      // ✅ WEB: pick best sources, then ask local LLM to rewrite into takeaways
      if (useWeb) {
        try {
          setWebStatus("Searching web…");

          const titleQ = (parsed.title || "").trim();
          const q1 = titleQ || "Artificial intelligence in education";
          const q2 = "Educational technology";
          const q3 = "Intelligent tutoring system";
          const q4 = "EdTech market";

          const pools = await Promise.all([
            webSearchPool(q1),
            webSearchPool(q2),
            webSearchPool(q3),
            webSearchPool(q4),
          ]);

          const mergedWeb: WebResult[] = [];
          const seenUrls = new Set<string>();
          for (const arr of pools) {
            for (const r of arr) {
              if (!r?.url) continue;
              if (seenUrls.has(r.url)) continue;
              seenUrls.add(r.url);
              mergedWeb.push(r);
            }
          }

          // best pick per bullet
          const picks: WebPick[] = parsed.bullets
            .map((b, i) => {
              const ranked = [...mergedWeb]
                .map((r) => ({ r, s: scoreBulletToWeb(b.text, r) }))
                .sort((x, y) => y.s - x.s)
                .map((x) => x.r);

              const top = ranked[0];
              return top ? ({ ...top, bulletIndex: i } as WebPick) : null;
            })
            .filter(Boolean) as WebPick[];

          setWebStatus(`Web results: ${mergedWeb.length} — crafting takeaways…`);

          const summaryPrompt = buildWebSummaryPrompt({
            title: parsed.title,
            bullets: parsed.bullets.map((b) => b.text),
            picks: picks.map((p) => ({
              bulletIndex: p.bulletIndex,
              title: p.title,
              snippet: String(p.snippet || "").slice(0, 280),
            })),
          });

          const summaryRaw = await generateText(modelId, summaryPrompt);
          let summaries = safeParseWebSummaries(summaryRaw);

          // repair if needed
          if (!summaries) {
            const repaired = await generateText(modelId, buildJsonRepairPrompt(summaryRaw));
            summaries = safeParseWebSummaries(repaired);
          }

          if (!summaries) {
            setWebStatus("Web takeaways failed (JSON). Showing raw web snippets instead.");
            // fallback: turn picks into summaries
            const fallback = picks.map((p) => ({
              bulletIndex: p.bulletIndex,
              text: String(p.snippet || "").slice(0, 180),
              url: p.url,
              title: p.title,
              source: String(p.source || "web"),
            }));
            setWebSummaries(fallback);
          } else {
            const byIndex = new Map<number, string>();
            for (const s of summaries) byIndex.set(s.bulletIndex, s.text);

            const final: WebSummary[] = picks
              .map((p) => ({
                bulletIndex: p.bulletIndex,
                text: byIndex.get(p.bulletIndex) || String(p.snippet || "").slice(0, 180),
                url: p.url,
                title: p.title,
                source: String(p.source || "web"),
              }))
              .slice(0, 12);

            setWebSummaries(final);
            setWebStatus(`Web takeaways ready ✅ (${final.length})`);
          }
        } catch (e: any) {
          setWebSummaries([]);
          setWebStatus(`Web search failed: ${e?.message ?? "Unknown error"}`);
        }
      } else {
        setWebSummaries([]);
        setWebStatus("");
      }

      setLessonState({ status: "ready", lesson: parsed, raw });
      setOpenBulletIndex(null);
      setPreview(null);

      const speech = `${parsed.title}. ${parsed.bullets.map((b) => b.text).join(" ")}`;
      setLastSpoken(speech);
      speakText(speech);
    } catch (e: any) {
      setLessonState({ status: "error", message: e?.message ?? "Failed to generate lesson." });
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
                background: explainLevel === "simple" ? "var(--primary-grad)" : "#E8F0FE",
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
                background: explainLevel === "normal" ? "var(--primary-grad)" : "#E8F0FE",
                color: explainLevel === "normal" ? "white" : "#2C3E50",
              }}
              onClick={() => setExplainLevel("normal")}
            >
              Normal
            </button>
          </div>

          <button
            className="video-btn"
            onClick={() => setUseWeb((v) => !v)}
            style={{
              padding: "6px 12px",
              fontSize: "0.8rem",
              background: useWeb ? "var(--primary-grad)" : "#E8F0FE",
              color: useWeb ? "white" : "#2C3E50",
            }}
            title="Toggle web sources (Wikipedia + DuckDuckGo)"
          >
            {useWeb ? "🌐 PDF + Web" : "📄 PDF only"}
          </button>

          <button
            className="video-btn"
            onClick={startLesson}
            disabled={indexState.status !== "indexed"}
            style={{
              opacity: indexState.status === "indexed" ? 1 : 0.5,
              cursor: indexState.status === "indexed" ? "pointer" : "not-allowed",
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
        {/* LEFT */}
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
              {indexState.status === "indexed" ? `PDF: ${indexState.filename}` : "Click or drag PDF here"}
            </p>

            <div className="status-badge">{statusBadge}</div>

            {indexState.status === "error" && (
              <div style={{ marginTop: 10, color: "#B91C1C", fontSize: 12 }}>{indexState.message}</div>
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
              {lessonState.status === "loadingModel" && <li>• Loading: {lessonState.message}</li>}
              {lessonState.status === "generating" && <li>• {lessonState.message}</li>}
              {lessonState.status === "ready" && <li>• Lesson generated ✅</li>}
              {lessonState.status === "error" && (
                <li style={{ color: "#B91C1C" }}>• {lessonState.message}</li>
              )}
              {useWeb && webStatus && <li>• 🌐 {webStatus}</li>}
            </ul>
          </div>
        </aside>

        {/* CENTER */}
        <main className="whiteboard-stage">
          <div className="whiteboard-surface" style={{ maxHeight: "calc(100vh - 120px)", overflowY: "auto" }}>
            {lessonState.status !== "ready" ? (
              <>
                <div className="lesson-chunk">
                  <strong>{indexState.status === "indexed" ? "Ready. Click Start Lesson." : "Upload a PDF to start."}</strong>
                  <div style={{ marginTop: 10, color: "#64748B", fontSize: 14 }}>
                    This demo runs AI on your laptop (WebGPU) and teaches from the PDF only.
                  </div>
                </div>

                <div className="diagram-box">
                  {indexState.status === "indexed" ? "[ Waiting to generate lesson… ]" : "[ Whiteboard area — waiting for PDF ]"}
                </div>
              </>
            ) : (
              <>
                <div className="lesson-chunk">
                  <strong>{lessonState.lesson.title}</strong>
                </div>

                {lessonState.lesson.bullets.map((b, i) => {
                  const openPdf = openBulletIndex === i;
                  return (
                    <div key={i} className="lesson-chunk" style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ marginTop: 2 }}>•</div>
                        <div style={{ flex: 1 }}>{b.text}</div>

                        <button
                          className="source-pill"
                          title="Show PDF source + open preview"
                          style={{ border: "none", cursor: "pointer", padding: "4px 8px" }}
                          onClick={() => {
                            setOpenBulletIndex(openPdf ? null : i);

                            const first = b.cites?.[0];
                            if (first) {
                              const real = chunkMapRef.current.get(first.chunkId);
                              const page = real?.page ?? first.page;
                              const phrase = pickHighlightPhrase(real?.text ?? "");
                              setPreview({ page, chunkId: first.chunkId, phrase });
                            }
                          }}
                        >
                          📄
                        </button>
                      </div>

                      {openPdf && b.cites?.length > 0 && (
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
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPreview({ page, chunkId: c.chunkId, phrase });
                                }}
                              >
                                <div>
                                  <b>p.{page}</b> — <code>{c.chunkId}</code>
                                </div>
                                <div style={{ opacity: 0.9 }}>"{phrase ? phrase + "…" : c.quote}"</div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* WEB TAKEAWAYS BOX */}
                {useWeb && (
                  <div
                    style={{
                      marginTop: 16,
                      padding: 14,
                      borderRadius: 14,
                      border: "1px solid #e5e7eb",
                      background: "linear-gradient(180deg, #F0F9FF 0%, #FFFFFF 100%)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <div style={{ fontWeight: 900 }}>🌐 Web Takeaways</div>
                      {webStatus && <div style={{ fontSize: 12, color: "#64748B" }}>{webStatus}</div>}
                    </div>

                    {webSummaries.length === 0 ? (
                      <div style={{ color: "#64748B", fontSize: 13 }}>
                        Nothing to show (web search returned no relevant results).
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {webSummaries.map((w, idx) => (
                          <div
                            key={idx}
                            style={{
                              padding: 10,
                              borderRadius: 12,
                              border: "1px solid #e2e8f0",
                              background: "#ffffff",
                              display: "flex",
                              gap: 10,
                              alignItems: "flex-start",
                              justifyContent: "space-between",
                            }}
                          >
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12, color: "#334155", marginBottom: 6 }}>
                                <b>Matches bullet #{w.bulletIndex + 1}</b>
                                <span style={{ marginLeft: 8, opacity: 0.75 }}>
                                  ({w.source})
                                </span>
                              </div>

                              <div style={{ fontSize: 13, color: "#0f172a" }}>{w.text}</div>

                              <div style={{ marginTop: 6, fontSize: 12, color: "#64748B" }}>
                                Source: {w.title}
                              </div>
                            </div>

                            <a
                              href={w.url}
                              target="_blank"
                              rel="noreferrer"
                              title="Open web source"
                              style={{
                                flexShrink: 0,
                                textDecoration: "none",
                                border: "1px solid #e2e8f0",
                                borderRadius: 10,
                                padding: "6px 10px",
                                color: "#2563eb",
                                fontWeight: 800,
                              }}
                            >
                              🔗
                            </a>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <DiagramPanel diagram={lessonState.lesson.diagram} />

                {lessonState.lesson.notes && lessonState.lesson.notes !== "string" && (
                  <div style={{ marginTop: 16, fontSize: 12, color: "#64748B" }}>Note: {lessonState.lesson.notes}</div>
                )}
              </>
            )}
          </div>
        </main>

        {/* RIGHT */}
        <aside className="drawer-right">
          <div className="evidence-header">Source Evidence</div>
          <div className="evidence-content">
            <div className="quote-box">
              <em style={{ color: "#64748B" }}>
                Click 📄 next to a bullet, then click a citation to open PDF preview with highlight.
              </em>
            </div>

            {lessonState.status === "error" && lessonState.raw && (
              <details>
                <summary style={{ cursor: "pointer" }}>Show raw model output</summary>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{lessonState.raw}</pre>
              </details>
            )}
          </div>
        </aside>
      </div>

      <PdfCitationPreview
        open={!!preview}
        onClose={() => setPreview(null)}
        pdfData={pdfData}
        pageNumber={preview?.page ?? 1}
        highlightPhrase={preview?.phrase ?? ""}
        header={preview ? `PDF Preview — p.${preview.page} (${preview.chunkId})` : undefined}
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
                {i > 0 && <line x1={x} y1={y - gap} x2={x} y2={y} stroke="#94A3B8" strokeWidth={2} />}
                <rect x={x - boxW / 2} y={y} width={boxW} height={boxH} rx={10} fill="#FFFFFF" stroke="#CBD5E0" />
                <text x={x} y={y + 24} fontSize={13} fill="#0F172A" textAnchor="middle">
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
                {i > 0 && <line x1={x - 20} y1={y} x2={x} y2={y} stroke="#94A3B8" strokeWidth={2} />}
                <rect x={x} y={y - boxH / 2} width={boxW} height={boxH} rx={10} fill="#FFFFFF" stroke="#CBD5E0" />
                <text x={x + boxW / 2} y={y + 5} fontSize={13} fill="#0F172A" textAnchor="middle">
                  {String(n.label || "").slice(0, 22)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    );
  }

  const nodes: PositionedNode[] = useMemo(() => {
    const cleaned = normalizeLabels((diagram.nodes ?? [])).slice(0, 7);
    return layoutStar(cleaned, width, height);
  }, [diagram.nodes]);

  return (
    <div className="diagram-box" style={{ height: 320, padding: 0 }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`}>
        {nodes.length > 1 &&
          nodes.slice(1).map((n, idx) => (
            <line key={idx} x1={nodes[0].x} y1={nodes[0].y} x2={n.x} y2={n.y} stroke="#94A3B8" strokeWidth={2} />
          ))}

        {nodes.map((n) => (
          <g key={n.id}>
            <rect x={n.x - 75} y={n.y - 19} width={150} height={38} rx={10} fill="#FFFFFF" stroke="#CBD5E0" />
            <text x={n.x} y={n.y + 4} fontSize={13} fill="#0F172A" textAnchor="middle">
              {n.label.length > 22 ? n.label.slice(0, 22) + "…" : n.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

