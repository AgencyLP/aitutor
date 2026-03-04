import React, { useEffect, useMemo, useState } from "react";

type Props = {
  speaking: boolean;
  title?: string;
};

export default function AvatarSpeaker({ speaking, title }: Props) {
  // simple fake “mouth movement” while speaking
  const [mouthOpen, setMouthOpen] = useState(false);

  useEffect(() => {
    if (!speaking) {
      setMouthOpen(false);
      return;
    }

    const id = window.setInterval(() => {
      setMouthOpen((v) => !v);
    }, 120);

    return () => window.clearInterval(id);
  }, [speaking]);

  const mouthStyle = useMemo<React.CSSProperties>(() => {
    return {
      width: mouthOpen ? 44 : 34,
      height: mouthOpen ? 14 : 8,
      borderRadius: 999,
      background: "#0f172a",
      transition: "all 120ms ease",
    };
  }, [mouthOpen]);

  return (
    <div
      style={{
        width: "100%",
        display: "flex",
        justifyContent: "center",
        padding: "12px 0 8px",
      }}
    >
      <div
        style={{
          width: 120,
          height: 120,
          borderRadius: 999,
          background: "linear-gradient(180deg, #E0F2FE 0%, #FFFFFF 100%)",
          border: "1px solid #BAE6FD",
          boxShadow: "0 10px 24px rgba(2, 132, 199, 0.12)",
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 10,
        }}
        title={title || "Tutor Avatar"}
      >
        {/* eyes */}
        <div style={{ display: "flex", gap: 18 }}>
          <div style={{ width: 10, height: 10, borderRadius: 999, background: "#0f172a" }} />
          <div style={{ width: 10, height: 10, borderRadius: 999, background: "#0f172a" }} />
        </div>

        {/* mouth */}
        <div style={mouthStyle} />

        {/* speaking badge */}
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
            fontWeight: 700,
          }}
        >
          {speaking ? "Speaking…" : "Ready"}
        </div>
      </div>
    </div>
  );
}
