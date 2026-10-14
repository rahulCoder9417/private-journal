"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// Minimal typing for the Web Speech API (not in lib.dom for all TS versions).
type RecognitionResultList = ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: RecognitionResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Mic button that appends dictated speech to `value` via `onChange`. Hidden when the browser lacks speech recognition. */
export function DictateButton({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const recRef = useRef<Recognition | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null);
    return () => recRef.current?.abort();
  }, []);

  if (!supported) return null;

  const start = () => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";

    rec.onresult = e => {
      let finalText = "";
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      setInterim(interimText);
      const spoken = finalText.trim();
      if (spoken) {
        const base = valueRef.current;
        const next = base && !/\s$/.test(base) ? `${base} ${spoken}` : base + spoken;
        valueRef.current = next; // keep in sync before the next render
        onChangeRef.current(next);
      }
    };
    rec.onerror = e => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      toast.error(e.error === "not-allowed" ? "Microphone access denied" : `Dictation failed: ${e.error}`);
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
      recRef.current = null;
    };

    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      recRef.current = null;
    }
  };

  const stop = () => recRef.current?.stop();

  return (
    <div className="mt-1.5 flex items-center gap-2 min-h-7">
      <Button type="button" variant="ghost" size="sm" onClick={listening ? stop : start}
        className={listening ? "text-red-400 hover:text-red-300" : "text-zinc-500 hover:text-zinc-300"}>
        {listening ? <Square className="fill-current" /> : <Mic />}
        {listening ? "Stop" : "Dictate"}
      </Button>
      {listening && (
        <span className="text-xs text-zinc-500 italic truncate">
          <span className="inline-block w-1.5 h-1.5 mr-1.5 rounded-full bg-red-500 animate-pulse align-middle" />
          {interim || "Listening…"}
        </span>
      )}
    </div>
  );
}
