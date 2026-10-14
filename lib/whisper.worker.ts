// Runs Whisper fully in the browser so dictated audio never leaves the device.
// Model files (~500MB) download once and are cached by the browser.
import { pipeline, type AutomaticSpeechRecognitionPipeline, type ProgressInfo } from "@huggingface/transformers";

const MODEL = "onnx-community/whisper-small";

type GPUAdapterLike = { features: { has(f: string): boolean } };
type GPULike = { requestAdapter(): Promise<GPUAdapterLike | null> };

let transcriber: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

async function loadOptions() {
  const gpu = (navigator as unknown as { gpu?: GPULike }).gpu;
  const adapter = gpu ? await gpu.requestAdapter().catch(() => null) : null;
  if (adapter) {
    return adapter.features.has("shader-f16")
      ? { device: "webgpu" as const, dtype: { encoder_model: "fp16" as const, decoder_model_merged: "fp16" as const } }
      : { device: "webgpu" as const, dtype: { encoder_model: "fp32" as const, decoder_model_merged: "q4" as const } };
  }
  return { device: "wasm" as const, dtype: { encoder_model: "fp32" as const, decoder_model_merged: "q8" as const } };
}

function getTranscriber() {
  transcriber ??= loadOptions().then(opts =>
    pipeline("automatic-speech-recognition", MODEL, {
      ...opts,
      progress_callback: (p: ProgressInfo) => {
        if (p.status === "progress_total") self.postMessage({ type: "progress", progress: p.progress });
      },
    })
  ).then(t => {
    self.postMessage({ type: "ready" });
    return t;
  }).catch(err => {
    transcriber = null;
    throw err;
  });
  return transcriber;
}

self.onmessage = async (e: MessageEvent<{ type: "load" } | { type: "transcribe"; id: number; audio: Float32Array }>) => {
  const msg = e.data;
  try {
    if (msg.type === "load") {
      await getTranscriber();
      return;
    }
    const t = await getTranscriber();
    const out = await t(msg.audio, { language: "english", task: "transcribe", chunk_length_s: 30, stride_length_s: 5 });
    const text = (Array.isArray(out) ? out.map(o => o.text).join(" ") : out.text).trim();
    self.postMessage({ type: "result", id: msg.id, text });
  } catch (err) {
    self.postMessage({ type: "error", id: msg.type === "transcribe" ? msg.id : undefined, message: err instanceof Error ? err.message : String(err) });
  }
};
