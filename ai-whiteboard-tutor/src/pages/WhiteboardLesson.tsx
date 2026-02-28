import React, { useMemo, useState } from "react";

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
  {
    quote:
      '"The derivative at a point can be interpreted as the slope of the tangent line to the graph at that point."',
    meta: "Section 2.1, Page 13",
  },
];

export default function WhiteboardLesson() {
  const [selectedEvidenceIndex, setSelectedEvidenceIndex] = useState(0);
  const [chatInput, setChatInput] = useState("");

  const selectedEvidence = useMemo(
    () => DEMO_EVIDENCE[selectedEvidenceIndex] ?? DEMO_EVIDENCE[0],
    [selectedEvidenceIndex]
  );

  const onSend = () => {
    const v = chatInput.trim();
    if (!v) return;
    // For now: UI-only demo. We'll wire real interruption later.
    setChatInput("");
    alert(`Demo only (no tutor logic yet). You asked: ${v}`);
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
            onClick={() => alert("Demo only: upload later")}
            role="button"
            tabIndex={0}
          >
            <p style={{ margin: 0 }}>Drag PDF here</p>
            <div className="status-badge">Indexed ✅</div>
          </div>

          <div className="topic-list">
            <h4>TOPICS FOUND</h4>
            <ul>
              <li>• Introduction to Calculus</li>
              <li>• Limits and Continuity</li>
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
          </div>

          {/* MINI CHAT */}
          <div className="chat-hub">
            <div className="chat-title">Interactive Tutor Chat</div>

            <div className="chat-messages">
              <p style={{ marginTop: 0 }}>
                <strong>Tutor:</strong> Do you understand how the slope connects
                to the derivative?
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
              onClick={() => alert("Demo only: PDF overlay later")}
            >
              View Full PDF Page
            </button>

            <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                style={{
                  border: "1px solid #E2E8F0",
                  background: "white",
                  borderRadius: 6,
                  padding: "8px 10px",
                  cursor: "pointer",
                }}
                onClick={() => setSelectedEvidenceIndex(0)}
              >
                Evidence 1
              </button>
              <button
                style={{
                  border: "1px solid #E2E8F0",
                  background: "white",
                  borderRadius: 6,
                  padding: "8px 10px",
                  cursor: "pointer",
                }}
                onClick={() => setSelectedEvidenceIndex(1)}
              >
                Evidence 2
              </button>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
