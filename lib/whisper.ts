// Main-thread handle for the Whisper worker. The worker (and its ~500MB model)
// is only spun up on first dictation and is unloaded after a few idle minutes.

export type WhisperStatus = { state: "idle" | "loading" | "ready"; progress: number };

const IDLE_UNLOAD_MS = 5 * 60_000;

let worker: Worker | null = null;
let status: WhisperStatus = { state: "idle", progress: 0 };
let nextId = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(s: WhisperStatus) => void>();
const pending = new Map<number, { resolve: (text: string) => void; reject: (err: Error) => void }>();

function setStatus(s: WhisperStatus) {
  status = s;
  listeners.forEach(l => l(s));
}

export function subscribeWhisper(listener: (s: WhisperStatus) => void) {
  listeners.add(listener);
  listener(status);
  return () => { listeners.delete(listener); };
}

function getWorker() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  if (worker) return worker;

  const w = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
  w.onmessage = e => {
    const m = e.data;
    if (m.type === "progress") setStatus({ state: "loading", progress: Math.round(m.progress) });
    else if (m.type === "ready") setStatus({ state: "ready", progress: 100 });
    else if (m.type === "result") { pending.get(m.id)?.resolve(m.text); pending.delete(m.id); }
    else if (m.type === "error") {
      if (m.id !== undefined) { pending.get(m.id)?.reject(new Error(m.message)); pending.delete(m.id); }
      else setStatus({ state: "idle", progress: 0 });
    }
  };
  w.onerror = e => {
    e.preventDefault();
    unloadWhisper(e.message || "Speech model crashed");
  };
  worker = w;
  setStatus({ state: "loading", progress: 0 });
  w.postMessage({ type: "load" });
  return w;
}

function scheduleUnload() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (pending.size === 0) unloadWhisper(); }, IDLE_UNLOAD_MS);
}

/** Start loading the model in the background (no-op if already loaded). */
export function preloadWhisper() {
  getWorker();
}

export function transcribe(audio: Float32Array): Promise<string> {
  const w = getWorker();
  const id = nextId++;
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ type: "transcribe", id, audio });
  }).finally(scheduleUnload);
}

export function unloadWhisper(reason = "Speech model unloaded") {
  worker?.terminate();
  worker = null;
  pending.forEach(p => p.reject(new Error(reason)));
  pending.clear();
  setStatus({ state: "idle", progress: 0 });
}
