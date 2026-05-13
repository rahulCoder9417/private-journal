"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getDraft, markSynced } from "@/hooks/use-journal-db";
import { deriveKey, encrypt, generateSalt, countWords } from "@/lib/crypto";
import { fetchPepper } from "@/lib/pepper";

interface SyncAllModalProps {
  open: boolean;
  unsyncedDates: string[];
  onClose: () => void;
  onComplete: () => void;
}

export function SyncAllModal({ open, unsyncedDates, onClose, onComplete }: SyncAllModalProps) {
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(0);
  const [status, setStatus] = useState<"idle" | "syncing" | "done" | "error">("idle");
  const [error, setError] = useState("");

  const reset = () => { setPassword(""); setDone(0); setStatus("idle"); setError(""); };

  const handleClose = () => { reset(); onClose(); };

  const handleSync = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setStatus("syncing"); setDone(0); setError("");

    try {
      const verify = await fetch("/api/journal/verify-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!verify.ok) throw new Error("Wrong password");

      const pepper = await fetchPepper();

      for (let i = 0; i < unsyncedDates.length; i++) {
        const date = unsyncedDates[i];
        const draft = await getDraft(date);
        if (!draft) { setDone(i + 1); continue; }

        const content = {
          tasks: draft.tasks,
          notes: draft.notes,
          achievements: draft.achievements,
          learnings: draft.learnings,
          weeklyGoal: draft.weeklyGoal ?? "",
          weeklyAchieved: draft.weeklyAchieved ?? "",
        };

        const salt = generateSalt();
        const key = await deriveKey(password + pepper, salt);
        const { encryptedData, iv } = await encrypt(key, JSON.stringify(content));
        const wc = countWords(
          [...draft.tasks.map((t) => t.text), draft.notes, draft.achievements, draft.learnings].join(" ")
        );

        const m = await fetch("/api/journal/metadata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date, wordCount: wc, salt }),
        });
        if (!m.ok) throw new Error(`Metadata failed for ${date}`);
        const savedMeta: { updatedAt: string } = await m.json();
        const serverTs = new Date(savedMeta.updatedAt).getTime();

        const c = await fetch("/api/journal/content", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date, encryptedData, iv }),
        });
        if (!c.ok) {
          const err = await c.json();
          throw new Error(err.error ?? `Content failed for ${date}`);
        }

        await markSynced(date, serverTs);
        setDone(i + 1);
      }

      setStatus("done");
      setTimeout(() => { reset(); onComplete(); }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
      setStatus("error");
    }
  };

  const pct = unsyncedDates.length > 0 ? Math.round((done / unsyncedDates.length) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-sm border-zinc-800 bg-zinc-950">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">Sync all entries</DialogTitle>
        </DialogHeader>

        {status === "idle" || status === "error" ? (
          <form onSubmit={handleSync} className="space-y-4">
            <p className="text-sm text-zinc-400">
              <span className="text-zinc-200 font-medium">{unsyncedDates.length}</span>{" "}
              {unsyncedDates.length === 1 ? "entry" : "entries"} will be encrypted and saved to the cloud.
            </p>
            <div className="rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 space-y-1 max-h-32 overflow-y-auto">
              {unsyncedDates.map((d) => (
                <p key={d} className="text-xs text-zinc-500 font-mono">{d}</p>
              ))}
            </div>
            <Input
              type="password"
              placeholder="Your password (used to encrypt)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              className="bg-zinc-900 border-zinc-700 text-zinc-100 placeholder:text-zinc-600"
            />
            {error && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="ghost" className="text-zinc-400" onClick={handleClose}>Cancel</Button>
              <Button type="submit" disabled={!password} className="bg-indigo-600 hover:bg-indigo-500 text-white">
                Sync all
              </Button>
            </div>
          </form>
        ) : status === "syncing" ? (
          <div className="space-y-4 py-2">
            <p className="text-sm text-zinc-400">
              Syncing {done} of {unsyncedDates.length}…
            </p>
            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-xs text-zinc-600 font-mono">
              {unsyncedDates[done] ?? unsyncedDates[unsyncedDates.length - 1]}
            </p>
          </div>
        ) : (
          <div className="py-4 text-center space-y-2">
            <p className="text-2xl">✓</p>
            <p className="text-sm text-emerald-400 font-medium">All entries synced</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
