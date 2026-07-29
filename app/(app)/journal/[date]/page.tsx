"use client";

import { useEffect, useRef, useState, use } from "react";
import { useRouter } from "next/navigation";
import confetti from "canvas-confetti";
import { toast } from "sonner";
import { getDraft, saveDraft, markSynced, type Task, type WeeklyGoalItem } from "@/hooks/use-journal-db";
import { countWords } from "@/lib/crypto";
import { pushEntry, pullEntry } from "@/lib/sync";
import { playTaskDone, playAllDone } from "@/lib/sounds";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";

// ─── helpers ─────────────────────────────────────────────────────────────────

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function adjacentDate(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m-1, d);
  date.setDate(date.getDate() + delta);
  return toYMD(date);
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m-1, d).toLocaleDateString("en-US", {
    weekday:"long", year:"numeric", month:"long", day:"numeric",
  });
}

function getDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m-1, d).getDay();
}

interface JournalContent {
  tasks: Task[];
  extraTasks?: Task[];
  customTasks?: Task[];
  notes: string;
  achievements: string;
  learnings: string;
  weeklyGoal?: string;
  weeklyAchieved?: string;
  weeklyGoals?: WeeklyGoalItem[];
}

// ─── component ───────────────────────────────────────────────────────────────

export default function JournalPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = use(params);
  const router = useRouter();

  const today = toYMD(new Date());
  const isToday = date === today;
  const isFuture = date > today;
  const dayOfWeek = getDayOfWeek(date);

  const prevDate = adjacentDate(date, -1);
  const nextDate = adjacentDate(date, 1);
  const canGoNext = nextDate <= today;

  const [tasks, setTasks] = useState<Task[]>([]);
  const [customTasks, setCustomTasks] = useState<Task[]>([]);
  const [newTaskText, setNewTaskText] = useState("");
  const [notes, setNotes] = useState("");
  const [achievements, setAchievements] = useState("");
  const [learnings, setLearnings] = useState("");
  const [weeklyGoal, setWeeklyGoal] = useState("");
  const [weeklyAchieved, setWeeklyAchieved] = useState("");
  const [weeklyGoals, setWeeklyGoals] = useState<WeeklyGoalItem[]>([]);
  const [isStale, setIsStale] = useState(false);
  const [hasCloudData, setHasCloudData] = useState(false);
  const [busy, setBusy] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"idle" | "saved">("idle");
  const [wordCount, setWordCount] = useState(0);

  const saveTimer = useRef<ReturnType<typeof setTimeout>>(null);

  // Redirect future dates
  useEffect(() => {
    if (isFuture) router.replace("/");
  }, [isFuture, router]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const draft = await getDraft(date);
      if (!cancelled && draft) {
        setTasks(draft.tasks);
        setCustomTasks(draft.customTasks ?? []);
        setNotes(draft.notes);
        setAchievements(draft.achievements);
        setLearnings(draft.learnings);
        setWeeklyGoal(draft.weeklyGoal ?? "");
        setWeeklyAchieved(draft.weeklyAchieved ?? "");
        setWordCount(countWords([...draft.tasks.map(t=>t.text), draft.notes, draft.achievements, draft.learnings].join(" ")));

        // Load weekly goals: from this entry if Monday, from that week's Monday if Saturday
        if (dayOfWeek === 1) {
          setWeeklyGoals(draft.weeklyGoals ?? []);
        } else if (dayOfWeek === 6) {
          const mondayDate = adjacentDate(date, -5);
          const mondayDraft = await getDraft(mondayDate);
          if (!cancelled) setWeeklyGoals(mondayDraft?.weeklyGoals ?? []);
        }
      }
      try {
        const res = await fetch(`/api/journal/metadata?date=${date}`);
        if (res.ok) {
          const meta: { updatedAt: string } | null = await res.json();
          if (meta && !cancelled) {
            setHasCloudData(true);
            const cloudTs = new Date(meta.updatedAt).getTime();
            const localUpdatedAt = draft?.updatedAt ?? 0;
            const lastSyncedAt = draft?.syncedAt ?? 0;
            if (cloudTs > lastSyncedAt && cloudTs > localUpdatedAt) setIsStale(true);
          }
        }
      } catch { /* offline */ }
    })();
    return () => { cancelled = true; };
  }, [date]);

  const autoSave = (updates: Partial<JournalContent>) => {
    if (!isToday) return; // never auto-save past entries
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const draft = {
        date,
        tasks: updates.tasks ?? tasks,
        extraTasks: [],
        customTasks: [],
        notes: updates.notes ?? notes,
        achievements: updates.achievements ?? achievements,
        learnings: updates.learnings ?? learnings,
        weeklyGoal: updates.weeklyGoal ?? weeklyGoal,
        weeklyAchieved: updates.weeklyAchieved ?? weeklyAchieved,
        updatedAt: Date.now(),
      };
      saveDraft(draft);
      setWordCount(countWords([...draft.tasks.map(t=>t.text), draft.notes, draft.achievements, draft.learnings].join(" ")));
    }, 600);
  };

  const addTask = () => {
    if (!isToday || !newTaskText.trim()) return;
    const next: Task[] = [...tasks, { id: crypto.randomUUID(), text: newTaskText.trim(), done: false }];
    setTasks(next); setNewTaskText(""); autoSave({ tasks: next });
  };

  const toggleTask = (id: string) => {
    if (!isToday) return;
    const next = tasks.map(t =>
      t.id === id ? { ...t, done: !t.done, completedAt: !t.done ? Date.now() : undefined } : t
    );
    setTasks(next); autoSave({ tasks: next });
    const toggled = next.find(t => t.id === id);
    if (toggled?.done) {
      const allDone = next.length > 0 && next.every(t => t.done);
      if (allDone) {
        playAllDone();
        confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 }, colors: ["#6366f1","#10b981","#f59e0b","#fff"] });
        toast.success("All tasks completed!", { description: "Great work today 🎉" });
      } else {
        playTaskDone();
      }
    }
  };

  const deleteTask = (id: string) => {
    if (!isToday) return;
    const next = tasks.filter(t => t.id !== id);
    setTasks(next); autoSave({ tasks: next });
  };

  const handleSyncToCloud = async () => {
    setBusy(true);
    try {
      const content: JournalContent = {
        tasks, customTasks, notes, achievements, learnings,
        weeklyGoals: dayOfWeek === 1 ? weeklyGoals : [],
      };
      const wc = countWords([...tasks.map(t=>t.text), ...customTasks.map(t=>t.text), notes, achievements, learnings].join(" "));
      const syncedAt = await pushEntry(date, content, wc);

      await markSynced(date, syncedAt);
      setIsStale(false); setHasCloudData(true);
      setSyncStatus("saved"); setTimeout(() => setSyncStatus("idle"), 2500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally { setBusy(false); }
  };

  const handleLoadFromCloud = async () => {
    setBusy(true);
    try {
      const c = await pullEntry<JournalContent>(date);
      if (!c) throw new Error("No cloud data found for this date");
      setTasks(c.tasks ?? []); setNotes(c.notes ?? ""); setAchievements(c.achievements ?? "");
      setLearnings(c.learnings ?? ""); setCustomTasks(c.customTasks ?? []);
      if (dayOfWeek === 1) setWeeklyGoals(c.weeklyGoals ?? []);
      if (isToday) {
        await saveDraft({ date, ...c, extraTasks: c.extraTasks ?? [], customTasks: c.customTasks ?? [], weeklyGoals: c.weeklyGoals ?? [], updatedAt: Date.now(), syncedAt: Date.now() });
      }
      setIsStale(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load");
    } finally { setBusy(false); }
  };

  if (isFuture) return null;

  const doneTasks = tasks.filter(t => t.done).length;
  const hasUnsyncedData = tasks.length > 0 || notes || achievements || learnings;

  return (
    <div className="space-y-5">
      {/* Nav + Header */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={() => router.push(prevDate === today ? "/" : `/journal/${prevDate}`)}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors text-sm">
              ← Prev
            </button>
            {canGoNext && (
              <button onClick={() => nextDate === today ? router.push("/") : router.push(`/journal/${nextDate}`)}
                className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors text-sm">
                Next →
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Sync button: always available for past entries with local data or cloud changes */}
            {isStale && (
              <Button size="sm" variant="outline" disabled={busy}
                className="border-amber-500/40 text-amber-400 hover:bg-amber-500/10 text-xs"
                onClick={handleLoadFromCloud}>
                ↓ Cloud has changes
              </Button>
            )}
            {(isToday || (hasUnsyncedData && !hasCloudData)) && (
              <Button size="sm" disabled={busy} className="bg-indigo-600 hover:bg-indigo-500 text-white"
                onClick={handleSyncToCloud}>
                {busy ? "Working…" : "↑ Sync to cloud"}
              </Button>
            )}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-0.5">
            {isToday
              ? <span className="text-xs font-medium text-indigo-400 uppercase tracking-widest">Today</span>
              : <span className="text-xs font-medium text-zinc-500 uppercase tracking-widest">Past entry · Read only</span>
            }
            {syncStatus === "saved" && <span className="text-xs text-emerald-400">✓ Synced</span>}
          </div>
          <h1 className="text-2xl font-bold text-zinc-100">{formatDate(date)}</h1>
          <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500">
            {wordCount > 0 && <span>{wordCount} words</span>}
            {tasks.length > 0 && <span>{doneTasks}/{tasks.length} tasks done</span>}
            {!isToday && <span className="text-zinc-600">·</span>}
            {!isToday && <span className="text-zinc-600">Editing disabled</span>}
          </div>
        </div>
      </div>

      {isStale && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-2.5">
          <span className="text-amber-400">⚠</span>
          <p className="text-sm text-amber-200">A newer version exists in the cloud.</p>
          {!isToday && (
            <Button size="sm" variant="ghost" disabled={busy} className="text-amber-400 ml-auto text-xs"
              onClick={handleLoadFromCloud}>Load it</Button>
          )}
        </div>
      )}

      {/* Weekly Goals (Monday) */}
      {dayOfWeek === 1 && (weeklyGoals.length > 0 || weeklyGoal) && (
        <EntrySection icon="🎯" title="This Week's Goals" accent="indigo">
          {weeklyGoals.length > 0 ? (
            <div className="space-y-2">
              {weeklyGoals.map(goal => (
                <div key={goal.id} className="flex items-start gap-3">
                  <Checkbox checked={goal.done} disabled
                    className="mt-0.5 border-indigo-600/60 data-[state=checked]:bg-indigo-500 data-[state=checked]:border-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed" />
                  <span className={`text-sm leading-relaxed ${goal.done ? "line-through text-zinc-500" : "text-zinc-200"}`}>{goal.text}</span>
                </div>
              ))}
            </div>
          ) : (
            <ReadText text={weeklyGoal} placeholder="No weekly goals set." />
          )}
        </EntrySection>
      )}

      {/* Tasks */}
      <EntrySection icon="✓" title="Tasks" accent="zinc">
        <div className="space-y-2">
          {tasks.length === 0 && !isToday && (
            <p className="text-sm text-zinc-600 italic">No tasks recorded.</p>
          )}
          {tasks.map(task => (
            <div key={task.id} className="flex items-start gap-3 group">
              <Checkbox checked={task.done}
                onCheckedChange={isToday ? () => toggleTask(task.id) : undefined}
                disabled={!isToday}
                className="mt-0.5 border-zinc-600 data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed" />
              <span className={`flex-1 text-sm leading-relaxed ${task.done ? "line-through text-zinc-500" : "text-zinc-200"}`}>{task.text}</span>
              {isToday && (
                <button onClick={() => deleteTask(task.id)}
                  className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 text-xs transition-opacity">✕</button>
              )}
            </div>
          ))}
          {isToday && (
            <div className="flex items-center gap-2 mt-3">
              <input type="text" value={newTaskText} onChange={e => setNewTaskText(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addTask()} placeholder="Add a task…"
                className="flex-1 bg-transparent border-b border-zinc-700 pb-1 text-sm text-zinc-300 placeholder:text-zinc-600 outline-none focus:border-indigo-500 transition-colors" />
              <button onClick={addTask} disabled={!newTaskText.trim()}
                className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-30 transition-colors">+ Add</button>
            </div>
          )}
        </div>
      </EntrySection>

      {/* Custom Tasks (read-only) */}
      {customTasks.length > 0 && (
        <EntrySection icon="◆" title="Custom Tasks" accent="indigo">
          <div className="space-y-2">
            {customTasks.map(task => (
              <div key={task.id} className="flex items-start gap-3">
                <Checkbox checked={task.done} disabled
                  className="mt-0.5 border-indigo-600/60 data-[state=checked]:bg-indigo-500 data-[state=checked]:border-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed" />
                <span className={`text-sm leading-relaxed ${task.done ? "line-through text-zinc-500" : "text-zinc-200"}`}>{task.text}</span>
              </div>
            ))}
          </div>
        </EntrySection>
      )}

      <Separator className="bg-zinc-800" />

      {/* Notes */}
      <EntrySection icon="✎" title="Today's Note" accent="zinc">
        {isToday ? (
          <Textarea value={notes} onChange={e => { setNotes(e.target.value); autoSave({ notes: e.target.value }); }}
            placeholder="What's on your mind today?" rows={4}
            className="bg-zinc-900/60 border-zinc-700/60 text-zinc-200 placeholder:text-zinc-600 resize-none" />
        ) : (
          <ReadText text={notes} placeholder="No note recorded." />
        )}
      </EntrySection>

      <Separator className="bg-zinc-800" />

      {/* Reflections */}
      <EntrySection icon="◈" title="Reflections" accent="zinc">
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-zinc-500 uppercase tracking-wider mb-1.5">Achievements</label>
            {isToday ? (
              <Textarea value={achievements} onChange={e => { setAchievements(e.target.value); autoSave({ achievements: e.target.value }); }}
                placeholder="What did you complete?" rows={3}
                className="bg-zinc-900/60 border-zinc-700/60 text-zinc-200 placeholder:text-zinc-600 resize-none" />
            ) : (
              <ReadText text={achievements} placeholder="Nothing recorded." />
            )}
          </div>
          <div>
            <label className="block text-xs text-zinc-500 uppercase tracking-wider mb-1.5">Learnings</label>
            {isToday ? (
              <Textarea value={learnings} onChange={e => { setLearnings(e.target.value); autoSave({ learnings: e.target.value }); }}
                placeholder="What did you learn?" rows={3}
                className="bg-zinc-900/60 border-zinc-700/60 text-zinc-200 placeholder:text-zinc-600 resize-none" />
            ) : (
              <ReadText text={learnings} placeholder="Nothing recorded." />
            )}
          </div>
        </div>
      </EntrySection>

      {/* Saturday: Weekly Goals Review (read-only) */}
      {dayOfWeek === 6 && weeklyGoals.length > 0 && (
        <>
          <Separator className="bg-zinc-800" />
          <EntrySection icon="🎯" title="This Week's Goals" accent="indigo">
            <div className="space-y-2">
              {weeklyGoals.map(goal => (
                <div key={goal.id} className="flex items-start gap-3">
                  <Checkbox checked={goal.done} disabled
                    className="mt-0.5 border-indigo-600/60 data-[state=checked]:bg-indigo-500 data-[state=checked]:border-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed" />
                  <span className={`text-sm leading-relaxed ${goal.done ? "line-through text-zinc-500" : "text-zinc-200"}`}>{goal.text}</span>
                </div>
              ))}
            </div>
          </EntrySection>
        </>
      )}

      {/* Completed tasks timeline (past + today) */}
      {tasks.some(t => t.done) && (
        <>
          <Separator className="bg-zinc-800" />
          <EntrySection icon="◎" title="Completed" accent="zinc">
            <div className="relative pl-4 space-y-3 border-l border-zinc-800">
              {tasks.filter(t => t.done).sort((a,b) => (b.completedAt??0)-(a.completedAt??0)).map(task => (
                <div key={task.id} className="relative">
                  <span className="absolute -left-[1.3rem] top-1.5 w-2 h-2 rounded-full bg-emerald-500" />
                  <p className="text-sm text-zinc-400 line-through">{task.text}</p>
                  {task.completedAt && (
                    <p className="text-[11px] text-zinc-600 mt-0.5">
                      {new Date(task.completedAt).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </EntrySection>
        </>
      )}

    </div>
  );
}

function EntrySection({ icon, title, accent, children }: {
  icon: string; title: string; accent: "zinc"|"indigo"|"emerald"; children: React.ReactNode;
}) {
  const c = { zinc:"text-zinc-400", indigo:"text-indigo-400", emerald:"text-emerald-400" };
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className={`text-sm ${c[accent]}`}>{icon}</span>
        <h2 className={`text-sm font-semibold ${c[accent]}`}>{title}</h2>
      </div>
      {children}
    </div>
  );
}

function ReadText({ text, placeholder }: { text: string; placeholder: string }) {
  if (!text?.trim()) return <p className="text-sm text-zinc-600 italic">{placeholder}</p>;
  return <p className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed bg-zinc-900/40 rounded-lg px-3 py-2.5 border border-zinc-800">{text}</p>;
}
