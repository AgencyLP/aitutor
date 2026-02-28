import React, { useMemo, useRef, useState } from "react";
import { extractPdfText, type ExtractedPdf } from "../rag/pdfExtract";

type IndexState =
  | { status: "idle" }
  | { status: "indexing"; filename: string }
  | { status: "indexed"; filename: string; numPages: number; pdf: ExtractedPdf }
  | { status: "error"; message: string };

type ChatMsg = { role: "tutor" | "user"; text: string };

function buildAnswerFromPdf(question: string, pdf: ExtractedPdf): string {
  const q = question.toLowerCase().trim();

  // "What is this PDF?" / summary-type questions
  if (
    q.includes("what is this") ||
    q.includes("what's this") ||
    q.includes("summar") ||
    q.includes("overview") ||
    q.includes("about this") ||
    q === "what is this pdf" ||
    q === "what is this pdf?"
  ) {
    const firstPages = pdf.pages.slice(0, Math.min(2, pdf.pages.length));
    const combined = firstPages.map((p) => p.text).join("\n\n");
    const snippet = combined.slice(0, 900).trim();

    const pageNum = firstPages[0]?.pageNumber ?? 1;
    return `Here’s what your PDF appears to be about (from the first pages):\n\n${snippet}${
      combined.length > 900 ? "…" : ""
    }\n\n📄 p.${pageNum}`;
  }

  // Keyword search over pages (simple, reliable demo baseline)
  const words = q.split(/\s+/).filter((w) => w.length >= 3);

  const scored = pdf.pages
    .map((p) => {
      const t = p.text.toLowerCase();
      let score = 0;
      for (const w of words) if (t.includes(w)) score += 1;
      return { page: p.pageNumber, text: p.text, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);

  if (scored.length === 0) {
    return `I couldn’t find that in this PDF.\n\nTry different keywords, or ask about a specific section.\n\n(Strict mode: I only answer from the uploaded PDF.)`;
  }

  const top = scored[0];
  const excerpt = top.text.slice(0, 800).trim();

  return `Best match I found:\n\n${excerpt}${top.text.length > 800 ? "…" : ""}\n\n📄 p.${top.page}`;
}

export default function WhiteboardLesson() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [indexState, setIndexState] = useState<IndexState>({ status: "idle" });

  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([
    { role: "tutor", text: "Upload a PDF, then ask me about it." },
  ]);

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

      setChatMessages((prev) => [
        ...prev,
        { role: "tutor", text: `Loading "${file.name}"…` },
      ]);

      setIndexState({ status: "indexing", filename: file.name });

      const pdf = await extractPdfText(file);

      setIndexState({
        status: "indexed",
        filename: file.name,
        numPages: pdf.numPages,
        pdf,
      });

      setChatMessages((prev) => [
        ...prev,
        {
          role: "tutor",
          text: `Indexed ✅ (${pdf.numPages} pages). Ask me anything about this PDF.`,
        },
      ]);
    } catch (e: any) {
      setIndexState({
        status: "error",
        message: e?.message ?? "Failed to read PDF.",
      });
      setChatMessages((prev) => [
        ...prev,
        {
          role: "tutor",
          text: "Sorry — I couldn’t read that PDF. Try another file.",
        },
      ]);
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

  const onSend = () => {
    const q = chatInput.trim();
    if (!q) return;

    setChatMessages((prev) => [...prev, { role: "user", text: q }]);
    setChatInput("");

    if (indexState.status !== "indexed") {
      setChatMessages((prev) => [
        ...prev,
        { role: "tutor", text: "Please upload a PDF first." },
      ]);
      return;
    }

    const answer = buildAnswerFromPdf(q, indexState.pdf);
    setChatMessages((prev) => [...prev, { role: "tutor", text: answer }]);
  };

  return (
    <>
      <header className="app-header">
        <div className="brand">THAI ED-AI TUTOR</div>

        <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
          <div className="mode-badge">
            <span>🔒 PDF Strict Mode</span>
          </div>
          <button
            className="video-btn"
            onClick={() => alert("Video recap comes later")}
          >
            Generate Video Recap
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
            <h4>TOPICS FOUND</h4>
            <ul>
              {indexState.status === "indexed" ? (
                <>
                  <li>• Pages detected: {indexState.numPages}</li>
                  <li>• Topic extraction comes next</li>
                </>
              ) : (
                <>
                  <li>• Upload a PDF to detect topics</li>
                  <li>• Then start a lesson</li>
                </>
              )}
            </ul>
          </div>
        </aside>

        {/* CENTER WHITEBOARD */}
        <main className="whiteboard-stage">
          <div className="whiteboard-surface">
            {indexState.status !== "indexed" ? (
              <>
                <div className="lesson-chunk">
                  <strong>Upload a PDF to start.</strong>
                  <div style={{ marginTop: 8, color: "#64748B", fontSize: 14 }}>
                    After upload, this whiteboard will show teaching text +
                    diagrams generated only from your PDF.
                  </div>
                </div>

                <div className="diagram-box">
                  [ Whiteboard area — waiting for PDF ]
                </div>
              </>
            ) : (
              <>
                <div className="lesson-chunk">
                  <strong>PDF loaded.</strong>
                  <div style={{ marginTop: 8, color: "#64748B", fontSize: 14 }}>
                    Ask questions in the tutor chat. Next we’ll generate
                    structured lesson text + diagrams with 📄 citations.
                  </div>
                </div>

                <div className="diagram-box">[ Diagram area — coming next ]</div>
              </>
            )}
          </div>

          {/* MINI CHAT */}
          <div className="chat-hub">
            <div className="chat-title">Interactive Tutor Chat</div>

            <div className="chat-messages">
              {chatMessages.map((m, i) => (
                <p key={i} style={{ marginTop: 0, marginBottom: 10 }}>
                  <strong>{m.role === "user" ? "You" : "Tutor"}:</strong>{" "}
                  {m.text}
                </p>
              ))}
            </div>

            <div className="chat-input">
              <input
                type="text"
                placeholder="Ask a question..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSend();
                }}
              />
              <button className="btn-send" onClick={onSend}>
                Send
              </button>
            </div>
          </div>
        </main>

        {/* RIGHT DRAWER */}
        <aside className="drawer-right">
          <div className="evidence-header">Source Evidence</div>
          <div className="evidence-content">
            <div className="quote-box">
              <em style={{ color: "#64748B" }}>
                Evidence drawer will show quotes + page numbers after we add 📄
                source chips to answers.
              </em>
            </div>

            <button
              className="view-pdf-btn"
              onClick={() => alert("PDF page viewer comes next")}
              disabled={indexState.status !== "indexed"}
              style={{
                opacity: indexState.status === "indexed" ? 1 : 0.5,
                cursor:
                  indexState.status === "indexed" ? "pointer" : "not-allowed",
              }}
            >
              View Full PDF Page
            </button>
          </div>
        </aside>
      </div>
    </>
  );
}
