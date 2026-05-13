"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import confetti from "canvas-confetti";
import { toast } from "sonner";
import {
  getDraft,
  saveDraft,
  markSynced,
  getAllDraftDates,
  type Task,
} from "@/hooks/use-journal-db";
import { deriveKey, encrypt, decrypt, generateSalt, countWords } from "@/lib/crypto";
import { fetchPepper } from "@/lib/pepper";
import { playTaskDone, playAllDone } from "@/lib/sounds";
import { PasswordModal } from "@/components/password-modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

interface JournalContent {
  tasks: Task[];
  notes: string;
  achievements: string;
  learnings: string;
  weeklyGoal?: string;
  weeklyAchieved?: string;
}

function mergeContents(local: JournalContent, cloud: JournalContent): JournalContent {
  const merged = [...local.tasks];
  for (const ct of cloud.tasks) {
    const exists = local.tasks.some(t => t.text.trim().toLowerCase() === ct.text.trim().toLowerCase());
    if (!exists) merged.push(ct);
  }
  return {
    tasks: merged,
    notes: local.notes || cloud.notes,
    achievements: local.achievements || cloud.achievements,
    learnings: local.learnings || cloud.learnings,
    weeklyGoal: local.weeklyGoal || cloud.weeklyGoal,
    weeklyAchieved: local.weeklyAchieved || cloud.weeklyAchieved,
  };
}

function calcWC(tasks: Task[], notes: string, achievements: string, learnings: string) {
  return countWords([...tasks.map(t => t.text), notes, achievements, learnings].join(" "));
}

export default function HomePage() {
  const today = new Date();
  const todayStr = toYMD(today);
  const dayOfWeek = today.getDay();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTaskText, setNewTaskText] = useState("");
  const [notes, setNotes] = useState("");
  const [achievements, setAchievements] = useState("");
  const [learnings, setLearnings] = useState("");
  const [weeklyGoal, setWeeklyGoal] = useState("");
  const [weeklyAchieved, setWeeklyAchieved] = useState("");
  const [isStale, setIsStale] = useState(false);
  const [syncModal, setSyncModal] = useState<"save" | "load" | null>(null);
  const [mergeEnabled, setMergeEnabled] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState("");
  const [syncStatus, setSyncStatus] = useState<"idle" | "saved">("idle");
  const [wordCount, setWordCount] = useState(0);
  const [localHasEntry, setLocalHasEntry] = useState(false);

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const draft = await getDraft(todayStr);
      if (!cancelled && draft) {
        setTasks(draft.tasks);
        setNotes(draft.notes);
        setAchievements(draft.achievements);
        setLearnings(draft.learnings);
        setWeeklyGoal(draft.weeklyGoal ?? "");
        setWeeklyAchieved(draft.weeklyAchieved ?? "");
        setWordCount(calcWC(draft.tasks, draft.notes, draft.achievements, draft.learnings));
        setLocalHasEntry(true);
      }
      try {
        const res = await fetch(`/api/journal/metadata?date=${todayStr}`);
        if (res.ok) {
          const meta: { updatedAt: string } | null = await res.json();
          if (meta && !cancelled) {
            const cloudTs = new Date(meta.updatedAt).getTime();
            const localUpdatedAt = draft?.updatedAt ?? 0;
            const lastSyncedAt = draft?.syncedAt ?? 0;
            // Stale only if cloud was updated by another session AND is newer than what we have locally
            if (cloudTs > lastSyncedAt && cloudTs > localUpdatedAt) setIsStale(true);
          }
        }
      } catch { /* offline */ }
    })();
    return () => { cancelled = true; };
  }, [todayStr]);

  const triggerAutoSave = useCallback(
    (updated: Partial<JournalContent & { tasks: Task[] }>) => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(async () => {
        const draft = {
          date: todayStr,
          tasks: updated.tasks ?? tasks,
          notes: updated.notes ?? notes,
          achievements: updated.achievements ?? achievements,
          learnings: updated.learnings ?? learnings,
          weeklyGoal: updated.weeklyGoal ?? weeklyGoal,
          weeklyAchieved: updated.weeklyAchieved ?? weeklyAchieved,
          updatedAt: Date.now(),
        };
        await saveDraft(draft);
        setLocalHasEntry(true);
        setWordCount(calcWC(draft.tasks, draft.notes, draft.achievements, draft.learnings));
      }, 600);
    },
    [todayStr, tasks, notes, achievements, learnings, weeklyGoal, weeklyAchieved]
  );

  const addTask = () => {
    if (!newTaskText.trim()) return;
    const next: Task[] = [...tasks, { id: crypto.randomUUID(), text: newTaskText.trim(), done: false }];
    setTasks(next); setNewTaskText(""); triggerAutoSave({ tasks: next });
  };

  const toggleTask = (id: string) => {
    const next = tasks.map(t =>
      t.id === id ? { ...t, done: !t.done, completedAt: !t.done ? Date.now() : undefined } : t
    );
    setTasks(next); triggerAutoSave({ tasks: next });
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
    const next = tasks.filter(t => t.id !== id);
    setTasks(next); triggerAutoSave({ tasks: next });
  };

  const currentContent = (): JournalContent => ({ tasks, notes, achievements, learnings, weeklyGoal, weeklyAchieved });
  const applyContent = (c: JournalContent) => {
    setTasks(c.tasks); setNotes(c.notes); setAchievements(c.achievements);
    setLearnings(c.learnings); setWeeklyGoal(c.weeklyGoal ?? ""); setWeeklyAchieved(c.weeklyAchieved ?? "");
  };

  const handleSyncToCloud = async (password: string) => {
    setModalLoading(true); setModalError("");
    try {
      const verify = await fetch("/api/journal/verify-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!verify.ok) throw new Error("Wrong password");

      const pepper = await fetchPepper();
      let content = currentContent();
      if (mergeEnabled) {
        const res = await fetch(`/api/journal/content?date=${todayStr}`);
        if (res.ok) {
          const data: { salt: string; encryptedData: string; iv: string } | null = await res.json();
          if (data) {
            const k = await deriveKey(password + pepper, data.salt);
            const plain = await decrypt(k, data.encryptedData, data.iv);
            content = mergeContents(content, JSON.parse(plain));
            applyContent(content);
          }
        }
      }
      const salt = generateSalt();
      const key = await deriveKey(password + pepper, salt);
      const { encryptedData, iv } = await encrypt(key, JSON.stringify(content));
      const wc = calcWC(content.tasks, content.notes, content.achievements, content.learnings);

      const m = await fetch("/api/journal/metadata", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ date: todayStr, wordCount: wc, salt }) });
      if (!m.ok) throw new Error("Failed to save metadata");
      const savedMeta: { updatedAt: string } = await m.json();
      const serverTs = new Date(savedMeta.updatedAt).getTime();

      const c2 = await fetch("/api/journal/content", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ date: todayStr, encryptedData, iv }) });
      if (!c2.ok) throw new Error("Failed to save content");

      await saveDraft({ date: todayStr, ...content, updatedAt: Date.now(), syncedAt: serverTs });
      await markSynced(todayStr, serverTs);
      setIsStale(false); setSyncModal(null);
      setSyncStatus("saved"); setTimeout(() => setSyncStatus("idle"), 2500);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "Sync failed");
    } finally { setModalLoading(false); }
  };

  const handleLoadFromCloud = async (password: string) => {
    setModalLoading(true); setModalError("");
    try {
      const pepper = await fetchPepper();
      const res = await fetch(`/api/journal/content?date=${todayStr}`);
      const data: { salt: string; encryptedData: string; iv: string } | null = await res.json();
      if (!data) throw new Error("No cloud data found for today");
      const key = await deriveKey(password + pepper, data.salt);
      let plain: string;
      try { plain = await decrypt(key, data.encryptedData, data.iv); }
      catch { throw new Error("Wrong password — decryption failed"); }
      const content: JournalContent = JSON.parse(plain);
      applyContent(content);
      setWordCount(calcWC(content.tasks, content.notes, content.achievements, content.learnings));
      await saveDraft({ date: todayStr, ...content, updatedAt: Date.now(), syncedAt: Date.now() });
      setIsStale(false); setSyncModal(null);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "Failed to load");
    } finally { setModalLoading(false); }
  };

  const doneTasks = tasks.filter(t => t.done).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-medium text-indigo-400 uppercase tracking-widest mb-0.5">Today</p>
          <h1 className="text-2xl font-bold text-zinc-100">
            {today.toLocaleDateString("en-US", { weekday:"long", month:"long", day:"numeric" })}
          </h1>
          <div className="flex items-center gap-3 mt-1.5 text-xs">
            {syncStatus === "saved" ? (
              <span className="flex items-center gap-1 text-emerald-400"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />Synced</span>
            ) : localHasEntry ? (
              <span className="flex items-center gap-1 text-amber-400"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" />Local draft</span>
            ) : (
              <span className="text-zinc-600">No draft yet</span>
            )}
            {wordCount > 0 && <span className="text-zinc-500">{wordCount} words</span>}
            {tasks.length > 0 && <span className="text-zinc-500">{doneTasks}/{tasks.length} tasks done</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isStale && (
            <Button size="sm" variant="outline" className="border-amber-500/40 text-amber-400 hover:bg-amber-500/10 text-xs"
              onClick={() => { setModalError(""); setSyncModal("load"); }}>
              ↓ Cloud has changes
            </Button>
          )}
          <Button size="sm" className="bg-indigo-600 hover:bg-indigo-500 text-white"
            onClick={() => { setModalError(""); setMergeEnabled(false); setSyncModal("save"); }}>
            ↑ Sync to cloud
          </Button>
        </div>
      </div>

      {isStale && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-2.5">
          <span className="text-amber-400">⚠</span>
          <p className="text-sm text-amber-200">A newer version of today's journal exists in the cloud.</p>
        </div>
      )}

      {/* Monday: Weekly Goals */}
      {dayOfWeek === 1 && (
        <Section icon="🎯" title="This Week's Goals" accent="indigo" subtitle="What do you want to achieve this week?">
          <Textarea value={weeklyGoal} onChange={e => { setWeeklyGoal(e.target.value); triggerAutoSave({ weeklyGoal: e.target.value }); }}
            placeholder="Set your goals for this week…" rows={3}
            className="bg-zinc-900/60 border-zinc-700/60 text-zinc-200 placeholder:text-zinc-600 resize-none" />
        </Section>
      )}

      {/* Tasks */}
      <Section icon="✓" title="Tasks" accent="zinc" subtitle={tasks.length ? `${doneTasks} done · ${tasks.length - doneTasks} remaining` : "Add your tasks for today"}>
        <div className="space-y-2">
          {tasks.map(task => (
            <div key={task.id} className="flex items-start gap-3 group">
              <Checkbox checked={task.done} onCheckedChange={() => toggleTask(task.id)}
                className="mt-0.5 border-zinc-600 data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500" />
              <span className={`flex-1 text-sm leading-relaxed ${task.done ? "line-through text-zinc-500" : "text-zinc-200"}`}>{task.text}</span>
              <button onClick={() => deleteTask(task.id)}
                className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 text-xs transition-opacity">✕</button>
            </div>
          ))}
          <div className="flex items-center gap-2 mt-3">
            <input type="text" value={newTaskText} onChange={e => setNewTaskText(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addTask()} placeholder="Add a task…"
              className="flex-1 bg-transparent border-b border-zinc-700 pb-1 text-sm text-zinc-300 placeholder:text-zinc-600 outline-none focus:border-indigo-500 transition-colors" />
            <button onClick={addTask} disabled={!newTaskText.trim()}
              className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-30 transition-colors">+ Add</button>
          </div>
        </div>
      </Section>

      <Separator className="bg-zinc-800" />

      {/* Notes */}
      <Section icon="✎" title="Today's Note" accent="zinc" subtitle="Free-form thoughts about your day">
        <Textarea value={notes} onChange={e => { setNotes(e.target.value); triggerAutoSave({ notes: e.target.value }); }}
          placeholder="What's on your mind today?" rows={4}
          className="bg-zinc-900/60 border-zinc-700/60 text-zinc-200 placeholder:text-zinc-600 resize-none" />
      </Section>

      <Separator className="bg-zinc-800" />

      {/* Reflections */}
      <Section icon="◈" title="Reflections" accent="zinc" subtitle="Achievements and learnings">
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-zinc-500 uppercase tracking-wider mb-1.5">Achievements</label>
            <Textarea value={achievements} onChange={e => { setAchievements(e.target.value); triggerAutoSave({ achievements: e.target.value }); }}
              placeholder="What did you complete?" rows={3}
              className="bg-zinc-900/60 border-zinc-700/60 text-zinc-200 placeholder:text-zinc-600 resize-none" />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 uppercase tracking-wider mb-1.5">Learnings</label>
            <Textarea value={learnings} onChange={e => { setLearnings(e.target.value); triggerAutoSave({ learnings: e.target.value }); }}
              placeholder="What did you learn?" rows={3}
              className="bg-zinc-900/60 border-zinc-700/60 text-zinc-200 placeholder:text-zinc-600 resize-none" />
          </div>
        </div>
      </Section>

      {/* Saturday: Weekly Review */}
      {dayOfWeek === 6 && (
        <>
          <Separator className="bg-zinc-800" />
          <Section icon="🏁" title="This Week — Goals Achieved" accent="emerald" subtitle="Reflect on this week">
            <Textarea value={weeklyAchieved} onChange={e => { setWeeklyAchieved(e.target.value); triggerAutoSave({ weeklyAchieved: e.target.value }); }}
              placeholder="Which goals did you achieve?" rows={4}
              className="bg-zinc-900/60 border-zinc-700/60 text-zinc-200 placeholder:text-zinc-600 resize-none" />
          </Section>
        </>
      )}

      {/* Completed tasks timeline */}
      {tasks.some(t => t.done) && (
        <>
          <Separator className="bg-zinc-800" />
          <Section icon="◎" title="Completed Today" accent="zinc" subtitle="Task completion log">
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
          </Section>
        </>
      )}

      <PasswordModal open={syncModal==="save"} title="Sync to cloud"
        description="Encrypt and save today's journal to the cloud."
        loading={modalLoading} error={modalError}
        showMergeOption mergeEnabled={mergeEnabled} onMergeChange={setMergeEnabled}
        onClose={() => setSyncModal(null)} onSubmit={handleSyncToCloud} />
      <PasswordModal open={syncModal==="load"} title="Load from cloud"
        description="Decrypt and load the latest version from the cloud."
        loading={modalLoading} error={modalError}
        onClose={() => setSyncModal(null)} onSubmit={handleLoadFromCloud} />
    </div>
  );
}

function Section({ icon, title, accent, subtitle, children }: {
  icon: string; title: string; accent: "zinc"|"indigo"|"emerald"; subtitle?: string; children: React.ReactNode;
}) {
  const c = { zinc:"text-zinc-400", indigo:"text-indigo-400", emerald:"text-emerald-400" };
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <span className={`text-sm ${c[accent]}`}>{icon}</span>
        <div>
          <h2 className={`text-sm font-semibold ${c[accent]}`}>{title}</h2>
          {subtitle && <p className="text-xs text-zinc-600 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}
