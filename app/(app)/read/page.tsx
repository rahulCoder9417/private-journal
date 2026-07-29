"use client";

import { useState } from "react";
import { pullEntry } from "@/lib/sync";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Task } from "@/hooks/use-journal-db";

interface MetaRow { date: string; wordCount: number; salt: string; updatedAt: string; }

interface DecryptedEntry {
  date: string;
  wordCount: number;
  tasks: Task[];
  notes: string;
  achievements: string;
  learnings: string;
  weeklyGoal?: string;
  weeklyAchieved?: string;
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
}

export default function ReadPage() {
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);

  const [from, setFrom] = useState(thirtyDaysAgo);
  const [to, setTo] = useState(today);
  const [entries, setEntries] = useState<DecryptedEntry[]>([]);
  const [decrypting, setDecrypting] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const handleLoad = async () => {
    setLoadError(""); setLoaded(false); setEntries([]); setDecrypting(true);
    try {
      const res = await fetch(`/api/journal/metadata?from=${from}&to=${to}`);
      if (!res.ok) throw new Error("Failed to fetch metadata");
      const rows: MetaRow[] = await res.json();
      if (!rows.length) { setLoadError("No entries found in this date range."); return; }

      const results: DecryptedEntry[] = [];
      for (const meta of rows) {
        const parsed = await pullEntry<Record<string, unknown>>(meta.date);
        if (!parsed) continue;
        results.push({ date: meta.date, wordCount: meta.wordCount, ...parsed } as DecryptedEntry);
      }
      results.sort((a, b) => b.date.localeCompare(a.date));
      setEntries(results); setLoaded(true);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Error loading data");
    } finally { setDecrypting(false); }
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium text-indigo-400 uppercase tracking-widest mb-0.5">Archive</p>
        <h1 className="text-2xl font-bold text-zinc-100">Read Entries</h1>
        <p className="text-sm text-zinc-500 mt-1">Select a date range — entries are decrypted locally with your unlocked session.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs text-zinc-500 uppercase tracking-wider">From</label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="w-40 bg-zinc-900 border-zinc-700 text-zinc-200" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-zinc-500 uppercase tracking-wider">To</label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="w-40 bg-zinc-900 border-zinc-700 text-zinc-200" />
        </div>
        <Button onClick={handleLoad} disabled={decrypting} className="bg-indigo-600 hover:bg-indigo-500 text-white">
          {decrypting ? "Decrypting…" : "Load entries"}
        </Button>
      </div>

      {loadError && <p className="text-sm text-red-400">{loadError}</p>}
      {loaded && !entries.length && (
        <p className="text-sm text-zinc-500">No decryptable entries found.</p>
      )}

      {entries.map((entry) => {
        const doneTasks = entry.tasks?.filter((t) => t.done).length ?? 0;
        const totalTasks = entry.tasks?.length ?? 0;
        return (
          <Card key={entry.date} className="border-zinc-800 bg-zinc-900/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-zinc-100">
                {formatDate(entry.date)}
              </CardTitle>
              <div className="flex gap-3 text-xs text-zinc-500">
                <span>{entry.wordCount} words</span>
                {totalTasks > 0 && <span>{doneTasks}/{totalTasks} tasks done</span>}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {entry.weeklyGoal && (
                <ReadSection label="This Week's Goals" color="indigo">{entry.weeklyGoal}</ReadSection>
              )}
              {totalTasks > 0 && (
                <div>
                  <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Tasks</p>
                  <div className="space-y-1.5">
                    {entry.tasks.map((t) => (
                      <div key={t.id} className="flex items-center gap-2.5">
                        <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 text-[10px] ${
                          t.done ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400" : "border-zinc-600"
                        }`}>
                          {t.done ? "✓" : ""}
                        </span>
                        <span className={`text-sm ${t.done ? "line-through text-zinc-500" : "text-zinc-300"}`}>
                          {t.text}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {entry.notes?.trim() && (
                <ReadSection label="Note" color="zinc">{entry.notes}</ReadSection>
              )}
              {entry.achievements?.trim() && (
                <ReadSection label="Achievements" color="zinc">{entry.achievements}</ReadSection>
              )}
              {entry.learnings?.trim() && (
                <ReadSection label="Learnings" color="zinc">{entry.learnings}</ReadSection>
              )}
              {entry.weeklyAchieved && (
                <ReadSection label="Week Review" color="emerald">{entry.weeklyAchieved}</ReadSection>
              )}
            </CardContent>
          </Card>
        );
      })}

    </div>
  );
}

function ReadSection({ label, color, children }: {
  label: string; color: "zinc" | "indigo" | "emerald"; children: string;
}) {
  const c = { zinc: "text-zinc-500", indigo: "text-indigo-400", emerald: "text-emerald-400" };
  return (
    <div>
      <p className={`text-xs font-medium uppercase tracking-wider mb-1.5 ${c[color]}`}>{label}</p>
      <p className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">{children}</p>
    </div>
  );
}
