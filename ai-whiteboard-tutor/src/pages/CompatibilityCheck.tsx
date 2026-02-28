 import React, { useMemo } from "react";
import { Link } from "react-router-dom";

function hasWebGPU(): boolean {
  // WebGPU presence check (simple + robust for demo)
  return typeof (navigator as any).gpu !== "undefined";
}

export default function CompatibilityCheck() {
  const supported = useMemo(() => hasWebGPU(), []);

  return (
    <div className="container">
      <div className="card">
        <h1 className="h1">Device check</h1>
        <p className="p">
          This demo runs the model in your browser using WebGPU.
        </p>

        <div className="row" style={{ marginBottom: 14 }}>
          {supported ? (
            <span className="chip">✅ WebGPU detected</span>
          ) : (
            <span className="chip">❌ WebGPU not detected</span>
          )}
          <span className="chip">Tip: use Chrome desktop</span>
        </div>

        {!supported && (
          <p className="p">
            If you’re on a supported laptop but still see this, try Chrome, make
            sure it’s updated, and avoid private/incognito restrictions.
          </p>
        )}

        <div className="row">
          {supported ? (
            <Link to="/lesson">
              <button>Continue to whiteboard</button>
            </Link>
          ) : (
            <Link to="/">
              <button>Back</button>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
