"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { preloadWhisper, subscribeWhisper, transcribe, type WhisperStatus } from "@/lib/whisper";

// Whisper expects 16kHz mono PCM.
async function blobToPcm16k(blob: Blob): Promise<Float32Array> {
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const out = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const data = buf.getChannelData(c);
      for (let i = 0; i < data.length; i++) out[i] += data[i] / buf.numberOfChannels;
    }
    return out;
  } finally {
    ctx.close();
  }
}

function formatElapsed(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Records speech, transcribes it on-device with Whisper, and appends the text to `value` via `onChange`. */
export function DictateButton({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [phase, setPhase] = useState<"idle" | "recording" | "transcribing">("idle");
  const [seconds, setSeconds] = useState(0);
  const [model, setModel] = useState<WhisperStatus>({ state: "idle", progress: 0 });
  const recorderRef = useRef<MediaRecorder | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  });

  useEffect(() => subscribeWhisper(setModel), []);
  useEffect(() => () => recorderRef.current?.stop(), []);

  useEffect(() => {
    if (phase !== "recording") return;
    const id = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  const append = (spoken: string) => {
    const base = valueRef.current;
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
    preloadWhisper(); // download/load the model while the user is speaking

    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      recorderRef.current = null;
      if (!chunks.length) { setPhase("idle"); return; }
      setPhase("transcribing");
      try {
        const audio = await blobToPcm16k(new Blob(chunks, { type: rec.mimeType }));
        const spoken = (await transcribe(audio)).replace(/\[[^\]]*\]/g, "").trim(); // drop [BLANK_AUDIO] etc.
        if (spoken) append(spoken);
        else toast("Didn't catch anything — try again");
      } catch (err) {
        toast.error(`Dictation failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setPhase("idle");
      }
    };
    rec.start();
    recorderRef.current = rec;
    setSeconds(0);
    setPhase("recording");
  };

  const stop = () => recorderRef.current?.stop();

  const modelLoading = model.state === "loading";

  return (
    <div className="mt-1.5 flex items-center gap-2 min-h-7">
      <Button type="button" variant="ghost" size="sm" disabled={phase === "transcribing"}
        onClick={phase === "recording" ? stop : start}
        className={phase === "recording" ? "text-red-400 hover:text-red-300" : "text-zinc-500 hover:text-zinc-300"}>
        {phase === "recording" ? <Square className="fill-current" /> : phase === "transcribing" ? <Loader2 className="animate-spin" /> : <Mic />}
        {phase === "recording" ? "Stop" : phase === "transcribing" ? "Transcribing" : "Dictate"}
      </Button>
      {phase === "recording" && (
        <span className="text-xs text-zinc-500 truncate">
          <span className="inline-block w-1.5 h-1.5 mr-1.5 rounded-full bg-red-500 animate-pulse align-middle" />
          Recording {formatElapsed(seconds)}
          {modelLoading && ` · loading speech model ${model.progress}%`}
        </span>
      )}
      {phase === "transcribing" && (
        <span className="text-xs text-zinc-500 truncate">
          {modelLoading ? `Loading speech model ${model.progress}% (one-time ~500MB download)…` : "Running Whisper on-device…"}
        </span>
      )}
    </div>
  );
}
