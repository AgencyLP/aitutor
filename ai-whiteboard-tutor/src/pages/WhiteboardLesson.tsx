import React, { useMemo, useRef, useState } from "react";
import { extractPdfText, type ExtractedPdf } from "../rag/pdfExtract";

type IndexState =
  | { status: "idle" }
  | { status: "indexing"; filename: string }
  | { status: "indexed"; filename: string; numPages: number; pdf: ExtractedPdf }
  | { status: "error"; message: string };

export default function WhiteboardLesson() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [chatInput, setChatInput] = useState("");

  const [indexState, setIndexState] = useState<IndexState>({ status: "idle" });

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

  const onSend = () => {
    const v = chatInput.trim();
    if (!v) return;
    setChatInput("");
    alert(
      indexState.status === "indexed"
        ? `Demo: you asked "${v}". Next step is to answer from the PDF.`
        : `Upload a PDF first. You asked "${v}".`
    );
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
                    Next step: generate the lesson content from your PDF (no fake
                    demo text).
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
              <p style={{ marginTop: 0 }}>
                <strong>Tutor:</strong>{" "}
                {indexState.status === "indexed"
                  ? "Ask me about the PDF."
                  : "Upload a PDF first."}
              </p>
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
                No evidence yet. Upload a PDF and generate a lesson, then click
                📄 icons to see quotes + page numbers here.
              </em>
            </div>

            <button
              className="view-pdf-btn"
              onClick={() => alert("PDF page viewer comes next")}
              disabled={indexState.status !== "indexed"}
              style={{
                opacity: indexState.status === "indexed" ? 1 : 0.5,
                cursor: indexState.status === "indexed" ? "pointer" : "not-allowed",
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
