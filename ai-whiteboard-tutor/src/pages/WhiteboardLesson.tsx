import React, { useEffect, useMemo, useRef, useState } from "react";

type ChatMsg = { role: "user" | "tutor"; text: string };

export default function WhiteboardLesson() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [chat, setChat] = useState<ChatMsg[]>([
    { role: "tutor", text: "Welcome. Upload + PDF grounding comes next." },
  ]);
  const [input, setInput] = useState("");

  const modeLabel = useMemo(() => "🔒 PDF-only (placeholder)", []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { clientWidth, clientHeight } = canvas;
      canvas.width = Math.floor(clientWidth * dpr);
      canvas.height = Math.floor(clientHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };

    const draw = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;

      // background
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#0b0f14";
      ctx.fillRect(0, 0, w, h);

      // header text on the board
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = "600 22px ui-sans-serif, system-ui";
      ctx.fillText("Whiteboard Lesson (UI Shell)", 28, 52);

      // sample “written” text
      ctx.fillStyle = "rgba(255,255,255,0.80)";
      ctx.font = "16px ui-sans-serif, system-ui";
      ctx.fillText(
        "Next: WebLLM + RAG will generate SAY/WRITE/DRAW steps.",
        28,
        88
      );

      // simple diagram placeholder
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 2;
      ctx.strokeRect(28, 120, 320, 76);
      ctx.beginPath();
      ctx.moveTo(348, 158);
      ctx.lineTo(420, 158);
      ctx.stroke();
      ctx.strokeRect(420, 120, 320, 76);

      ctx.fillStyle = "rgba(255,255,255,0.70)";
      ctx.font = "14px ui-sans-serif, system-ui";
      ctx.fillText("Concept A", 44, 165);
      ctx.fillText("Concept B", 436, 165);

      // tiny source icon demo
      ctx.fillText("📄", 332, 143);
      ctx.fillText("📄", 724, 143);

      // play state hint
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.font = "12px ui-sans-serif, system-ui";
      ctx.fillText(isPlaying ? "Playing…" : "Paused", 28, h - 22);
    };

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
    // redraw when play state changes
  }, [isPlaying]);

  const onSend = () => {
    const text = input.trim();
    if (!text) return;
    setChat((prev) => [...prev, { role: "user", text }]);
    setInput("");
    // Placeholder tutor response
    setTimeout(() => {
      setChat((prev) => [
        ...prev,
        {
          role: "tutor",
          text: "Got it. In the next step, this will run RAG on your PDF and answer with 📄 evidence.",
        },
      ]);
    }, 350);
  };

  return (
    <div className="whiteboard-root">
      <div className="topbar">
        <div className="left">
          <strong>AI Whiteboard Tutor</strong>
          <span className="chip">{modeLabel}</span>
        </div>
        <div className="right">
          <button onClick={() => setIsPlaying((p) => !p)}>
            {isPlaying ? "Pause" : "Play"}
          </button>
        </div>
      </div>

      <div className="stage">
        <canvas ref={canvasRef} />

        <div className="mini-chat">
          <div className="mini-chat-header">
            <strong style={{ fontSize: 13 }}>Mini Chat</strong>
            <span className="small">Interrupt anytime</span>
          </div>

          <div className="mini-chat-body">
            {chat.map((m, idx) => (
              <div key={idx} style={{ marginBottom: 8 }}>
                <strong style={{ color: "rgba(255,255,255,0.85)" }}>
                  {m.role === "user" ? "You" : "Tutor"}:
                </strong>{" "}
                {m.text}
              </div>
            ))}
          </div>

          <div className="mini-chat-input">
            <input
              type="text"
              value={input}
              placeholder="Ask a question…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSend();
              }}
            />
            <button onClick={onSend}>Send</button>
          </div>
        </div>
      </div>
    </div>
  );
}
