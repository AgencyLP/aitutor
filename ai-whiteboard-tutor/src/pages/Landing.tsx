import React from "react";
import { Link } from "react-router-dom";

export default function Landing() {
  return (
    <div className="container">
      <div className="card">
        <h1 className="h1">AI Whiteboard Tutor (Demo)</h1>
        <p className="p">
          Full-screen whiteboard teaching + mini chat interruptions. Runs on your
          laptop (WebGPU). For now, this is the UI shell—we’ll plug in PDF/RAG
          and WebLLM next.
        </p>

        <div className="row" style={{ marginBottom: 14 }}>
          <span className="chip">🔒 Strict: PDF-only (coming next)</span>
          <span className="chip">📄 Evidence drawer + PDF highlight (next)</span>
          <span className="chip">🗣️ Voice (browser TTS)</span>
        </div>

        <div className="row">
          <Link to="/check">
            <button>Start demo</button>
          </Link>
          <a
            className="small"
            href="https://www.google.com/chrome/"
            target="_blank"
            rel="noreferrer"
          >
            Recommended: Chrome desktop
          </a>
        </div>
      </div>
    </div>
  );
}
