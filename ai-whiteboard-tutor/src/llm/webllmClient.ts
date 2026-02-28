import { CreateMLCEngine, type MLCEngine } from "@mlc-ai/web-llm";

let engine: MLCEngine | null = null;
let loadingPromise: Promise<MLCEngine> | null = null;

export type LlmStatus =
  | { state: "idle" }
  | { state: "loading"; message: string }
  | { state: "ready" }
  | { state: "error"; message: string };

export function hasWebGPU(): boolean {
  return typeof (navigator as any).gpu !== "undefined";
}

export async function getEngine(
  modelId: string,
  onProgress?: (msg: string) => void
): Promise<MLCEngine> {
  if (engine) return engine;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    if (!hasWebGPU()) {
      throw new Error("WebGPU not detected. Use Chrome desktop on a supported laptop.");
    }

    const e = await CreateMLCEngine(modelId, {
      initProgressCallback: (report: any) => {
        const text =
          typeof report === "string"
            ? report
            : report?.text ?? report?.message ?? JSON.stringify(report);
        onProgress?.(text);
      },
    });

    engine = e;
    return e;
  })();

  return loadingPromise;
}

export async function generateText(
  modelId: string,
  prompt: string,
  onProgress?: (msg: string) => void
): Promise<string> {
  const e = await getEngine(modelId, onProgress);

  const completion = await e.chat.completions.create({
    messages: [
      { role: "system", content: "You are a helpful tutor." },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
  });

  return completion.choices?.[0]?.message?.content ?? "";
}
