// Runs Whisper fully in the browser so dictated audio never leaves the device.
// The model downloads once, is cached by the browser, and stays loaded in this
// worker so each spoken phrase transcribes without reloading it.
import { pipeline, type AutomaticSpeechRecognitionPipeline, type ProgressInfo } from "@huggingface/transformers";

const WHISPER_MODEL = "onnx-community/whisper-base.en";

type GPULike = { requestAdapter(): Promise<object | null> };

let transcriber: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

async function hasWebGPU() {
  const gpu = (navigator as unknown as { gpu?: GPULike }).gpu;
  return !!(gpu && (await gpu.requestAdapter().catch(() => null)));
}

function getTranscriber() {
  transcriber ??= hasWebGPU().then(gpu =>
    pipeline("automatic-speech-recognition", WHISPER_MODEL, {
      device: gpu ? "webgpu" : "wasm",
      dtype: { encoder_model: "fp32", decoder_model_merged: gpu ? "q4" : "q8" },
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
    // Phrases are short; only chunk the rare one longer than Whisper's 30s window.
    const out = await t(msg.audio, msg.audio.length > 16000 * 30 ? { chunk_length_s: 30, stride_length_s: 5 } : {});
    const text = (Array.isArray(out) ? out.map(o => o.text).join(" ") : out.text).trim();
    self.postMessage({ type: "result", id: msg.id, text });
  } catch (err) {
    self.postMessage({ type: "error", id: msg.type === "transcribe" ? msg.id : undefined, message: err instanceof Error ? err.message : String(err) });
  }
};
