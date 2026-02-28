import React, { useMemo, useRef, useState } from "react";
import { extractPdfText, type ExtractedPdf } from "../rag/pdfExtract";

type Evidence = {
  quote: string;
  meta: string;
};

const DEMO_EVIDENCE: Evidence[] = [
  {
    quote:
      '"...the derivative of a function of a real variable measures the sensitivity to change of the function value with respect to a change in its argument..."',
    meta: "Section 2.1, Page 12",
  },
];

type IndexState =
  | { status: "idle" }
  | { status: "indexing"; filename: string }
  | { status: "indexed"; filename: string; numPages: number; pdf: ExtractedPdf }
  | { status: "error"; message: string };

export default function WhiteboardLesson() {
  const [selectedEvidenceIndex, setSelectedEvidenceIndex] = useState(0);
  const [chatInput, setChatInput] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [indexState, setIndexState] = useState<IndexState>({ status: "idle" });

  const selectedEvidence = useMemo(
    () => DEMO_EVIDENCE[selectedEvidenceIndex] ?? DEMO_EVIDENCE[0],
    [selectedEvidenceIndex]
  );

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
    alert(`Demo only (tutor logic next). You asked: ${v}`);
  };

  return (
    <>
      <header className="app-header">
        <div className="brand">THAI ED-AI TUTOR</div>

        <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
          <div className="mode-badge">
            <span>🔒 PDF Strict Mode</span>
          </div>
          <button className="video-btn">Generate Video Recap</button>
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
              // allow re-uploading same file
              e.currentTarget.value = "";
            }}
          />

          <div className="topic-list">
            <h4>TOPICS FOUND</h4>
            <ul>
              <li>
                •{" "}
                {indexState.status === "indexed"
                  ? `Pages detected: ${indexState.numPages}`
                  : "Upload a PDF to detect topics"}
              </li>
              <li>• (Topic extraction comes next)</li>
              <li className="active">• The Derivative Concept ➔</li>
            </ul>
          </div>
        </aside>

        {/* CENTER WHITEBOARD */}
        <main className="whiteboard-stage">
          <div className="whiteboard-surface">
            <div className="lesson-chunk">
              <strong>The Derivative</strong> represents the instantaneous rate
              of change of a function. Imagine a car moving along a curve; the
              derivative at any point is its exact speed at that moment.
              <span
                className="source-pill"
                onClick={() => setSelectedEvidenceIndex(0)}
                role="button"
                tabIndex={0}
                title="View evidence"
              >
                📄 p. 12
              </span>
            </div>

            <div className="diagram-box">[ AI is drawing a slope diagram... ]</div>

            {indexState.status === "indexed" && (
              <div style={{ marginTop: 18, fontSize: 12, color: "#64748B" }}>
                ✅ PDF loaded. Next step: retrieve relevant pages and replace this
                demo text with real teaching from your PDF.
              </div>
            )}
          </div>

          {/* MINI CHAT */}
          <div className="chat-hub">
            <div className="chat-title">Interactive Tutor Chat</div>

            <div className="chat-messages">
              <p style={{ marginTop: 0 }}>
                <strong>Tutor:</strong> Upload a PDF, then ask me about it.
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
              <em>{selectedEvidence.quote}</em>
              <p style={{ marginTop: 10, fontSize: "0.75rem", color: "#64748B" }}>
                {selectedEvidence.meta}
              </p>
            </div>

            <button
              className="view-pdf-btn"
              onClick={() => alert("PDF overlay comes next")}
            >
              View Full PDF Page
            </button>
          </div>
        </aside>
      </div>
    </>
  );
}
