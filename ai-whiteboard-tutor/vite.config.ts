import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite + WebLLM notes:
// - WebLLM uses dynamic imports / wasm / workers depending on runtime.
// - optimizeDeps helps avoid slow cold-start in dev for some deps.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173
  },
  optimizeDeps: {
    include: ["@mlc-ai/web-llm"]
  },
  build: {
    sourcemap: true
  }
});
