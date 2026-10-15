"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { preloadWhisper, subscribeWhisper, transcribe, type WhisperStatus } from "@/lib/whisper";

const SPEECH_RMS = 0.012;      // mic level that counts as speech
const PAUSE_MS = 900;          // silence that ends a phrase
const MAX_PHRASE_MS = 15_000;  // cut unbroken speech so text keeps flowing
const MIN_VOICED_MS = 250;     // ignore clicks and bumps
const PRE_ROLL_MS = 300;       // keep a little audio from before speech starts
const PREVIEW_AFTER_MS = 3_000; // only preview phrases long enough to wait on
const PREVIEW_STEP_MS = 2_500;  // re-transcribe the phrase in progress this often
const BATCH_MAX_MS = 25_000;    // queued phrases are transcribed together, within Whisper's 30s window

type Phrase = { id: number; chunks: Float32Array[]; ms: number; voicedMs: number };

function concat(chunks: Float32Array[]) {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

// Whisper expects 16kHz mono.
async function to16k(samples: Float32Array<ArrayBuffer>, rate: number): Promise<Float32Array> {
  if (rate === 16000) return samples;
  const ctx = new OfflineAudioContext(1, Math.ceil((samples.length * 16000) / rate), 16000);
  const buf = ctx.createBuffer(1, samples.length, rate);
  buf.copyToChannel(samples, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  return (await ctx.startRendering()).getChannelData(0);
}

// Drop Whisper's non-speech tags like [BLANK_AUDIO] or (wind blowing).
function clean(text: string) {
  return text.replace(/\[[^\]]*\]|\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}

function formatElapsed(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Live dictation: splits speech into phrases at pauses, transcribes each one
 * on-device with Whisper, and appends it to `value` via `onChange`. The phrase
 * still being spoken is previewed underneath.
 */
export function DictateButton({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [phase, setPhase] = useState<"idle" | "recording" | "finishing">("idle");
  const [seconds, setSeconds] = useState(0);
  const [preview, setPreview] = useState<{ id: number; text: string } | null>(null);
  const [model, setModel] = useState<WhisperStatus>({ state: "idle", progress: 0 });
  const stopRef = useRef<(() => void) | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  });

  useEffect(() => subscribeWhisper(setModel), []);
  useEffect(() => () => stopRef.current?.(), []);

  useEffect(() => {
    if (phase !== "recording") return;
    const id = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  const append = (spoken: string) => {
    const base = valueRef.current;
    // Capitalise when starting the note or a new sentence.
    if (!base.trim() || /[.!?]\s*$/.test(base)) spoken = spoken[0].toUpperCase() + spoken.slice(1);
    const next = base && !/\s$/.test(base) ? `${base} ${spoken}` : base + spoken;
    valueRef.current = next;
    onChangeRef.current(next);
  };

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Microphone not available in this browser");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch {
      toast.error("Microphone access denied");
      return;
    }
    preloadWhisper(); // download/load the model while the user starts speaking

    const ctx = new AudioContext();
    const rate = ctx.sampleRate;
    const source = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    source.connect(proc);
    proc.connect(ctx.destination);

    let recording = true;
    let busy = false;
    let nextId = 0;
    let current: Phrase | null = null;
    let preRoll: Float32Array[] = [];
    let silenceMs = 0;
    let lastPreviewMs = 0;
    const finals: Phrase[] = [];

    // One transcription at a time: finished phrases first (batched if they queued
    // up, e.g. while the model loads), then a preview of the phrase being spoken.
    const pump = async () => {
      if (busy) return;
      const batch: Phrase[] = [];
      let batchMs = 0;
      while (finals.length && (!batch.length || batchMs + finals[0].ms <= BATCH_MAX_MS)) {
        batchMs += finals[0].ms;
        batch.push(finals.shift()!);
      }
      const live = !batch.length && current && current.ms >= PREVIEW_AFTER_MS && current.ms - lastPreviewMs >= PREVIEW_STEP_MS ? current : null;
      if (!batch.length && !live) {
        if (!recording && !current) { setPhase("idle"); setPreview(null); }
        return;
      }
      busy = true;
      if (live) lastPreviewMs = live.ms;
      try {
        const audio = concat(live ? live.chunks : batch.flatMap(p => p.chunks));
        const text = clean(await transcribe(await to16k(audio, rate)));
        if (live) {
          if (current?.id === live.id) setPreview({ id: live.id, text });
        } else {
          if (text) append(text);
          setPreview(p => (p && batch.some(b => b.id === p.id) ? null : p));
        }
      } catch (err) {
        if (!live) toast.error(`Dictation failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        busy = false;
        pump();
      }
    };

    const endPhrase = () => {
      if (current && current.voicedMs >= MIN_VOICED_MS) finals.push(current);
      current = null;
      silenceMs = 0;
      lastPreviewMs = 0;
      pump();
    };

    proc.onaudioprocess = e => {
      if (!recording) return;
      const chunk = new Float32Array(e.inputBuffer.getChannelData(0));
      const ms = (chunk.length / rate) * 1000;
      let sum = 0;
      for (const v of chunk) sum += v * v;
      const loud = Math.sqrt(sum / chunk.length) > SPEECH_RMS;

      if (!current) {
        if (loud) {
          current = { id: nextId++, chunks: [...preRoll, chunk], ms: (preRoll.length + 1) * ms, voicedMs: ms };
          preRoll = [];
        } else {
          preRoll.push(chunk);
          while (preRoll.length * ms > PRE_ROLL_MS) preRoll.shift();
        }
        return;
      }
      current.chunks.push(chunk);
      current.ms += ms;
      if (loud) { current.voicedMs += ms; silenceMs = 0; }
      else silenceMs += ms;
      if (silenceMs >= PAUSE_MS || current.ms >= MAX_PHRASE_MS) endPhrase();
      else pump();
    };

    stopRef.current = () => {
      stopRef.current = null;
      recording = false;
      proc.onaudioprocess = null;
      source.disconnect();
      proc.disconnect();
      ctx.close();
      stream.getTracks().forEach(t => t.stop());
      setPhase("finishing");
      endPhrase();
    };

    setSeconds(0);
    setPreview(null);
    setPhase("recording");
  };

  const modelLoading = model.state === "loading";

  return (
    <div className="mt-1.5 space-y-1">
      <div className="flex items-center gap-2 min-h-7">
        <Button type="button" variant="ghost" size="sm" disabled={phase === "finishing"}
          onClick={phase === "recording" ? () => stopRef.current?.() : start}
          className={phase === "recording" ? "text-red-400 hover:text-red-300" : "text-zinc-500 hover:text-zinc-300"}>
          {phase === "recording" ? <Square className="fill-current" /> : phase === "finishing" ? <Loader2 className="animate-spin" /> : <Mic />}
          {phase === "recording" ? "Stop" : phase === "finishing" ? "Finishing" : "Dictate"}
        </Button>
        {phase === "recording" && (
          <span className="text-xs text-zinc-500 truncate">
            <span className="inline-block w-1.5 h-1.5 mr-1.5 rounded-full bg-red-500 animate-pulse align-middle" />
            Listening {formatElapsed(seconds)}
            {modelLoading && ` · loading speech model ${model.progress}%`}
          </span>
        )}
        {phase === "finishing" && modelLoading && (
          <span className="text-xs text-zinc-500 truncate">Loading speech model {model.progress}%…</span>
        )}
      </div>
      {preview?.text && phase !== "idle" && (
        <p className="px-2 text-sm italic text-zinc-500">{preview.text}…</p>
      )}
    </div>
  );
}
