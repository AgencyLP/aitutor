import React, { useEffect, useMemo, useRef, useState } from "react";
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
import TutorAvatar3D from "../components/TutorAvatar3D";

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

type WebTakeaway = {
  bulletIndex: number;
  text: string;
  url: string;
  title: string;
  source: string; // keep string (wikipedia/duckduckgo/web)
};

function extractBetween(text: string, startTag: string, endTag: string) {
  const a = text.indexOf(startTag);
  const b = text.indexOf(endTag);
  if (a === -1 || b === -1 || b <= a) return null;
  return text.slice(a + startTag.length, b).trim();
}

function safeParseLesson(text: string): Lesson | null {
  const marked = extractBetween(text, "JSON_START", "JSON_END");
  const candidate =
    marked ??
    extractFirstJsonObject(text) ??
    extractFirstJsonObject("{" + text) ??
    text;

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
            text: String(b?.text ?? "").trim(),
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
      title: String(obj.title).trim(),
      bullets,
      diagram: {
        type: diagramType,
        nodes: Array.isArray(obj.diagram?.nodes)
          ? obj.diagram.nodes
              .map((n: any, i: number) => ({
                id: String(n.id ?? `n${i + 1}`),
                label: String(n.label ?? "").trim(),
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
      notes: obj.notes ? String(obj.notes).trim() : "",
    };

    if (!lesson.title || lesson.title.toLowerCase() === "string") return null;
    if (lesson.bullets.length === 0) return null;
    if (lesson.bullets.some((b) => b.text.toLowerCase() === "string")) return null;
    if (lesson.bullets.every((b) => (b.cites?.length ?? 0) === 0)) return null;

    return lesson;
  } catch {
    return null;
  }
}

function tokenize(s: string) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9ก-๙\s]/g, " ")
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2);
}

function isPdfBulletTooShort(text: string) {
  const t = (text || "").trim();
  const words = tokenize(t);
  return t.length < 45 || words.length < 7;
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

function buildSingleWebTakeawayPrompt(params: {
  lessonTitle: string;
  bulletText: string;
  source: { title: string; snippet: string; url: string; source: string };
}) {
  return `
You are writing ONE "Web Takeaway" sentence for an EdTech AI tutor UI.

RULES:
- Use ONLY the provided snippet. Do NOT invent facts.
- Write EXACTLY 1 short sentence that supports/adds context to the bullet.
- Output MUST be plain text only (no JSON, no quotes, no markdown, no bullet symbols).
- If snippet is not useful, output exactly: NO_TAKEAWAY

LESSON_TITLE: ${params.lessonTitle}

BULLET: ${params.bulletText}

SOURCE_TITLE: ${params.source.title}
SOURCE_SNIPPET: ${params.source.snippet}
SOURCE_URL: ${params.source.url}
SOURCE_TYPE: ${params.source.source}
`.trim();
}

function buildWebTakeawaysPrompt(params: {
  lessonTitle: string;
  bullets: string[];
  picks: Array<{ bulletIndex: number; source: string; title: string; snippet: string; url: string }>;
}) {
  const picksBlock = params.picks
    .map(
      (p) => `
BULLET_INDEX: ${p.bulletIndex}
SOURCE: ${p.source}
TITLE: ${p.title}
SNIPPET: ${p.snippet}
URL: ${p.url}
`.trim()
    )
    .join("\n\n---\n\n");

  return `
You are writing "Web Takeaways" for an EdTech AI tutor UI.

RULES (very important):
- Use ONLY the provided snippets. Do NOT invent facts.
- Write 1 short sentence that SUPPORTS or ADDS CONTEXT for the bullet topic.
- Output MUST be valid JSON ONLY.
- Do NOT output placeholder words like "string".
- Keep it concise.

Return JSON array with EXACT schema:
[
  { "bulletIndex": 0, "text": "one sentence", "url": "https://...", "title": "source title", "source": "wikipedia|duckduckgo|web" }
]

LESSON_TITLE: ${params.lessonTitle}

BULLETS:
${params.bullets.map((b, i) => `${i}: ${b}`).join("\n")}

WEB_PICKS:
${picksBlock}
`.trim();
}

function buildWebTakeawaysRepairPrompt(badText: string) {
  return `
Rewrite the following into VALID JSON ONLY.
It must be a JSON array of objects exactly like:
[
  { "bulletIndex": 0, "text": "one sentence", "url": "https://...", "title": "source title", "source": "web" }
]

TEXT:
${badText}
`.trim();
}

function safeParseWebTakeaways(text: string): WebTakeaway[] | null {
  const marked = extractBetween(text, "JSON_START", "JSON_END");
  const candidate =
    marked ??
    extractFirstJsonObject(text) ??
    extractFirstJsonObject("[" + text) ??
    text;

  try {
    const arr = JSON.parse(candidate);
    if (!Array.isArray(arr)) return null;

    const out: WebTakeaway[] = arr
      .map((x: any) => ({
        bulletIndex: Number(x?.bulletIndex),
        text: String(x?.text ?? "").trim(),
        url: String(x?.url ?? "").trim(),
        title: String(x?.title ?? "").trim(),
        source: String(x?.source ?? "web").trim(),
      }))
      .filter(
        (x) =>
          Number.isFinite(x.bulletIndex) &&
          x.bulletIndex >= 0 &&
          x.text &&
          x.url &&
          x.title
      );

    return out.length ? out : null;
  } catch {
    return null;
  }
}

/** ✅ Free mini-avatar (no model) that animates while speaking */
function AvatarSpeaker({ speaking }: { speaking: boolean }) {
  const [mouthOpen, setMouthOpen] = useState(false);

  useEffect(() => {
    if (!speaking) {
      setMouthOpen(false);
      return;
    }
    const id = window.setInterval(() => setMouthOpen((v) => !v), 120);
    return () => window.clearInterval(id);
  }, [speaking]);

  return (
    <div style={{ width: "100%", display: "flex", justifyContent: "center", padding: "10px 0 6px" }}>
      <div
        style={{
          width: 112,
          height: 112,
          borderRadius: 999,
          background: "linear-gradient(180deg, #E0F2FE 0%, #FFFFFF 100%)",
          border: "1px solid #BAE6FD",
          boxShadow: "0 10px 22px rgba(2,132,199,0.12)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 10,
          position: "relative",
          userSelect: "none",
        }}
        title="Free animated avatar"
      >
        <div style={{ display: "flex", gap: 18 }}>
          <div style={{ width: 10, height: 10, borderRadius: 999, background: "#0f172a" }} />
          <div style={{ width: 10, height: 10, borderRadius: 999, background: "#0f172a" }} />
        </div>

        <div
          style={{
            width: mouthOpen ? 44 : 34,
            height: mouthOpen ? 14 : 8,
            borderRadius: 999,
            background: "#0f172a",
            transition: "all 120ms ease",
          }}
        />

        <div
          style={{
            position: "absolute",
            bottom: -10,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "4px 10px",
            borderRadius: 999,
            border: "1px solid #e2e8f0",
            background: "#fff",
            fontSize: 12,
            color: speaking ? "#0284c7" : "#64748b",
            fontWeight: 800,
          }}
        >
          {speaking ? "Speaking…" : "Ready"}
        </div>
      </div>
    </div>
  );
}

export default function WhiteboardLesson() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [indexState, setIndexState] = useState<IndexState>({ status: "idle" });
  const [lessonState, setLessonState] = useState<LessonState>({ status: "idle" });

  const [explainLevel, setExplainLevel] = useState<"simple" | "normal">("simple");
  const [openBulletIndex, setOpenBulletIndex] = useState<number | null>(null);

  const [useWeb, setUseWeb] = useState<boolean>(false);
  const [webStatus, setWebStatus] = useState<string>("");
  const [webTakeaways, setWebTakeaways] = useState<WebTakeaway[]>([]);

  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const chunkMapRef = useRef<Map<string, { page: number; text: string }>>(new Map());

  const [preview, setPreview] = useState<null | { page: number; chunkId: string; phrase: string }>(null);

  const [lastSpoken, setLastSpoken] = useState<string>("");
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);

  const modelId =
    (import.meta as any).env?.VITE_WEBLLM_MODEL ??
    "Llama-3.2-3B-Instruct-q4f16_1-MLC";

  function speakTextLocal(text: string) {
    if (!("speechSynthesis" in window)) return;

    window.speechSynthesis.cancel();
    setIsSpeaking(false);

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

    utter.onstart = () => setIsSpeaking(true);
    utter.onend = () => setIsSpeaking(false);
    utter.onerror = () => setIsSpeaking(false);

    // ✅ Force speaking=true in case onstart doesn't fire (happens on some browsers/deploys)
    setIsSpeaking(true);

// Optional safety: stop "speaking" if the browser never fires onend
const approxMs = Math.min(60000, Math.max(2000, Math.floor(text.length * 60)));
window.setTimeout(() => setIsSpeaking(false), approxMs);

window.speechSynthesis.speak(utter);
  }

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
      setWebTakeaways([]);

      const bytes = await file.arrayBuffer();
      setPdfData(bytes.slice(0)); // avoid detached buffer issues

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
    setWebTakeaways([]);

    const allChunks = chunkPdfPages(indexState.pdf.pages, { maxChars: 900, overlapChars: 120 });

    // map chunkId -> real text for preview
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

    const mergedEvidence = [...guaranteed];
    const seen = new Set(mergedEvidence.map((c) => c.id));
    for (const c of extra) {
      if (!seen.has(c.id)) {
        mergedEvidence.push(c);
        seen.add(c.id);
      }
      if (mergedEvidence.length >= 10) break;
    }

    const evidence = mergedEvidence.map((c) => ({ chunkId: c.id, page: c.page, text: c.text }));

    const basePrompt = buildLessonPrompt({
      explainLevel,
      evidence,
      numPages: indexState.numPages,
    });

    const prompt = `
${basePrompt}

VERY IMPORTANT OUTPUT RULES:
- Output MUST be JSON only between markers exactly like:
JSON_START
{ ...valid JSON... }
JSON_END
- Do NOT output placeholders like "string".
- Do NOT output markdown.
`.trim();

    try {
      setLessonState({ status: "loadingModel", message: "Loading model…" });

      const raw = await generateText(modelId, prompt, (msg) => {
        setLessonState({ status: "loadingModel", message: msg });
      });

      setLessonState({ status: "generating", message: "Generating lesson…" });

      let parsed = safeParseLesson(raw);

      if (!parsed) {
        const repaired1 = await generateText(modelId, buildJsonRepairPrompt(raw));
        parsed = safeParseLesson(repaired1);

        if (!parsed) {
          const repaired2 = await generateText(modelId, buildJsonRepairPrompt(repaired1));
          parsed = safeParseLesson(repaired2);

          if (!parsed) {
            setLessonState({
              status: "error",
              message:
                "Model output wasn’t valid JSON. Open raw output below (includes repair attempts).",
              raw:
                raw +
                "\n\n----- REPAIR #1 -----\n\n" +
                repaired1 +
                "\n\n----- REPAIR #2 -----\n\n" +
                repaired2,
            });
            return;
          }
        }
      }

      // re-rank citations per bullet
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

      // ✅ Fix "heading-only" PDF bullets by rewriting them into a real sentence
      // using ONLY the cited PDF text (no web).
      const upgradedBullets: Bullet[] = [];
      let rewrites = 0;
      const MAX_REWRITES = 6;

      for (const b of parsed.bullets) {
        // If it's already a good sentence, keep it
        if (!isPdfBulletTooShort(b.text)) {
          upgradedBullets.push(b);
          continue;
        }
        if (rewrites >= MAX_REWRITES) {
           upgradedBullets.push(b);
          continue;
        }
rewrites++;

        // Pull the cited PDF text as evidence
        const citeTexts = (b.cites || [])
          .slice(0, 2)
          .map((c) => chunkMapRef.current.get(c.chunkId)?.text || "")
          .filter(Boolean);

        const evidenceText = citeTexts.join("\n\n---\n\n").trim();

        // If we somehow don't have evidence, fallback to the first cite quote
        if (!evidenceText) {
          const fallback = (b.cites?.[0]?.quote || "").trim();
          upgradedBullets.push({
            ...b,
            text: fallback.length ? fallback : b.text,
          });
          continue;
        }

        // Ask the model to rewrite into ONE clear sentence from the PDF evidence
        const rewritePrompt = `
Rewrite the following into ONE clear explanatory sentence for a student (12–25 words).
RULES:
- Start with a normal sentence (no headings).
- Use ONLY the PDF excerpt below. Do NOT add facts.
- Output plain text only (no JSON, no quotes, no markdown).
- Keep it concise but meaningful (not a heading).

EXPLAIN_LEVEL: ${explainLevel}

PDF_EXCERPT:
${evidenceText}
`.trim();

        const rewrittenRaw = await generateText(modelId, rewritePrompt);
        const rewritten = String(rewrittenRaw || "").trim();

        // If model still gives something too short, fallback to a snippet
        const finalText = isPdfBulletTooShort(rewritten)
        ? ((b.cites?.[0]?.quote || "").trim() || snippetFromChunkText(evidenceText))
        : rewritten;

        upgradedBullets.push({ ...b, text: finalText });
      }

      parsed = { ...parsed, bullets: upgradedBullets };
// web takeaways (one sentence per bullet)
if (useWeb) {
  try {
    setWebStatus("Searching web…");

    const lessonTitle = parsed.title || "EdTech AI";
    const queries = [
      lessonTitle,
      `${lessonTitle} statistics`,
      "Artificial intelligence in education",
      "Intelligent tutoring system",
      "Educational technology",
    ];

    const pools = await Promise.all(queries.map((q) => webSearchPool(q)));

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

    setWebStatus(`Web results: ${mergedWeb.length} — writing takeaways…`);

    const takeawaysOut: WebTakeaway[] = [];

    for (let i = 0; i < parsed.bullets.length; i++) {
      const bulletText = parsed.bullets[i].text;

      const ranked = [...mergedWeb]
        .map((r) => ({ r, s: scoreBulletToWeb(bulletText, r) }))
        .sort((x, y) => y.s - x.s)
        .map((x) => x.r);

      const top = ranked[0];
      if (!top) continue;

      const promptOne = buildSingleWebTakeawayPrompt({
        lessonTitle,
        bulletText,
        source: {
          title: String(top.title || "").trim(),
          snippet: String(top.snippet || "").slice(0, 340),
          url: String(top.url || "").trim(),
          source: String(top.source || "web"),
        },
      });

      const textRaw = await generateText(modelId, promptOne);
      const text = String(textRaw || "")
        .trim()
        .replace(/^["'\s]+|["'\s]+$/g, "");

      if (!text || text.toUpperCase().includes("NO_TAKEAWAY")) continue;

      takeawaysOut.push({
        bulletIndex: i,
        text,
        url: String(top.url || "").trim(),
        title: String(top.title || "").trim() || "Web result",
        source: String(top.source || "web"),
      });
    }

    setWebTakeaways(takeawaysOut.slice(0, 12));
    setWebStatus(`Web takeaways ready ✅ (${takeawaysOut.length})`);
  } catch (e: any) {
    setWebTakeaways([]);
    setWebStatus(`Web failed: ${e?.message ?? "Unknown error"}`);
  }
} else {
  setWebTakeaways([]);
  setWebStatus("");
}        

      setLessonState({ status: "ready", lesson: parsed, raw });
      setOpenBulletIndex(null);
      setPreview(null);

      const speech = `${parsed.title}. ${parsed.bullets.map((b) => b.text).join(" ")}`;
      setLastSpoken(speech);
      speakTextLocal(speech);
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
            onClick={() => {
              window.speechSynthesis.cancel();
              setIsSpeaking(false);
            }}
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
            onClick={() => lastSpoken && speakTextLocal(lastSpoken)}
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
            onClick={() => fileInputRef.current?.click()}
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
              {lessonState.status === "error" && <li style={{ color: "#B91C1C" }}>• {lessonState.message}</li>}
              {useWeb && webStatus && <li>• 🌐 {webStatus}</li>}
            </ul>
          </div>
        </aside>

        {/* CENTER */}
        <main className="whiteboard-stage">
          {/* ✅ AVATAR TOP-MIDDLE */}
          <TutorAvatar3D speaking={isSpeaking} height={800} />

          <div className="whiteboard-surface" style={{ maxHeight: "calc(100vh - 170px)", overflowY: "auto" }}>
            {lessonState.status !== "ready" ? (
              <>
                <div className="lesson-chunk">
                  <strong>{indexState.status === "indexed" ? "Ready. Click Start Lesson." : "Upload a PDF to start."}</strong>
                  <div style={{ marginTop: 10, color: "#64748B", fontSize: 14 }}>
                    This demo runs AI on your laptop (WebGPU) and teaches from the PDF.
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
                  const w = useWeb ? webTakeaways.find((x) => x.bulletIndex === i) : undefined;

                  return (
                    <div key={i} className="lesson-chunk" style={{ marginBottom: 12 }}>
                      {/* main bullet row */}
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ marginTop: 2 }}>•</div>

                        <div style={{ flex: 1 }}>
                          {/* PDF sentence */}
                          <div>{b.text}</div>

                          {/* ✅ WEB sentence (blue box) */}
                          {useWeb && (
                            <div
                              style={{
                                marginTop: 8,
                                padding: 10,
                                borderRadius: 12,
                                border: "1px solid #BAE6FD",
                                background: "#F0F9FF",
                                display: "flex",
                                gap: 10,
                                alignItems: "flex-start",
                                justifyContent: "space-between",
                              }}
                            >
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 12, color: "#475569", marginBottom: 4 }}>
                                  🌐 Web
                                </div>
                                <div style={{ fontSize: 13, color: "#0F172A", lineHeight: 1.35 }}>
                                  {w ? w.text : "No relevant web result found for this bullet."}
                                </div>
                              </div>

                              {/* web link button */}
                              {w ? (
                                <a
                                  href={w.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={w.title}
                                  style={{
                                    flexShrink: 0,
                                    textDecoration: "none",
                                    border: "1px solid #BAE6FD",
                                    borderRadius: 10,
                                    padding: "6px 10px",
                                    background: "#FFFFFF",
                                    color: "#2563EB",
                                    fontWeight: 900,
                                  }}
                                >
                                  🌐
                                </a>
                              ) : (
                                <div
                                  style={{
                                    flexShrink: 0,
                                    border: "1px solid #BAE6FD",
                                    borderRadius: 10,
                                    padding: "6px 10px",
                                    background: "#FFFFFF",
                                    color: "#94A3B8",
                                    fontWeight: 900,
                                  }}
                                  title="No link"
                                >
                                  🌐
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* PDF source button */}
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

                      {/* PDF citations */}
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

                <DiagramPanel diagram={lessonState.lesson.diagram} />

                {lessonState.lesson.notes && lessonState.lesson.notes !== "string" && (
                  <div style={{ marginTop: 16, fontSize: 12, color: "#64748B" }}>
                    Note: {lessonState.lesson.notes}
                  </div>
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

      {/* PDF Preview Modal */}
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

