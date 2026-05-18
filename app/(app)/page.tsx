"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import confetti from "canvas-confetti";
import { toast } from "sonner";
import {
  getDraft,
  saveDraft,
  markSynced,
  getTemplates,
  type Task,
  type CustomTaskTemplate,
  type JournalDraft,
  type WeeklyGoalItem,
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
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function adjacentDate(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + delta);
  return toYMD(date);
}

interface JournalContent {
  tasks: Task[];
  extraTasks: Task[];
  customTasks: Task[];
  templates: CustomTaskTemplate[];
  notes: string;
  achievements: string;
  learnings: string;
  weeklyGoal?: string;
  weeklyAchieved?: string;
  weeklyGoals?: WeeklyGoalItem[];
}

function mergeContents(local: JournalContent, cloud: JournalContent): JournalContent {
  const mergeTaskList = (l: Task[], c: Task[]) => {
    const merged = [...l];
    for (const ct of c) {
      const exists = l.some(t => t.text.trim().toLowerCase() === ct.text.trim().toLowerCase());
      if (!exists) merged.push(ct);
    }
    return merged;
  };
  return {
    tasks: mergeTaskList(local.tasks, cloud.tasks),
    extraTasks: mergeTaskList(local.extraTasks, cloud.extraTasks),
    customTasks: mergeTaskList(local.customTasks, cloud.customTasks),
    templates: local.templates.length ? local.templates : cloud.templates,
    notes: local.notes || cloud.notes,
    achievements: local.achievements || cloud.achievements,
    learnings: local.learnings || cloud.learnings,
    weeklyGoals: local.weeklyGoals?.length ? local.weeklyGoals : cloud.weeklyGoals,
  };
}

function calcWC(tasks: Task[], extraTasks: Task[], customTasks: Task[], notes: string, achievements: string, learnings: string) {
  return countWords([
    ...tasks.map(t => t.text),
    ...extraTasks.map(t => t.text),
    ...customTasks.map(t => t.text),
    notes, achievements, learnings,
  ].join(" "));
}

// Merge template definitions into the per-day customTasks list:
// Add tasks for active templates that aren't already tracked, remove tasks for deleted/skipped templates.
function reconcileCustomTasks(
  existing: Task[],
  templates: CustomTaskTemplate[],
  dayOfWeek: number
): Task[] {
  const activeTemplates = templates.filter(t => !t.skipDays.includes(dayOfWeek));
  const next: Task[] = [];
  for (const tmpl of activeTemplates) {
    const found = existing.find(t => t.id === tmpl.id);
    next.push(found ?? { id: tmpl.id, text: tmpl.name, done: false });
  }
  return next;
}

export default function HomePage() {
  const today = new Date();
  const todayStr = toYMD(today);
  const dayOfWeek = today.getDay();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [extraTasks, setExtraTasks] = useState<Task[]>([]);
  const [customTasks, setCustomTasks] = useState<Task[]>([]);
  const [templates, setTemplates] = useState<CustomTaskTemplate[]>([]);
  const [newTaskText, setNewTaskText] = useState("");
  const [newExtraText, setNewExtraText] = useState("");
  const [notes, setNotes] = useState("");
  const [achievements, setAchievements] = useState("");
  const [learnings, setLearnings] = useState("");
  // Weekly goals — set on Monday, reviewed on Saturday
  const [weeklyGoals, setWeeklyGoals] = useState<WeeklyGoalItem[]>([]);
  const [newGoalText, setNewGoalText] = useState("");
  // On Saturday, goals are loaded from Monday's draft
  const mondayDraftRef = useRef<JournalDraft | null>(null);
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
      const mondayDate = adjacentDate(todayStr, -(dayOfWeek === 0 ? -1 : dayOfWeek - 1));
      const [draft, tmplList] = await Promise.all([getDraft(todayStr), getTemplates()]);
      if (cancelled) return;

      if (draft) {
        const reconciled = reconcileCustomTasks(draft.customTasks, tmplList, dayOfWeek);
        setTasks(draft.tasks);
        setExtraTasks(draft.extraTasks);
        setCustomTasks(reconciled);
        setNotes(draft.notes);
        setAchievements(draft.achievements);
        setLearnings(draft.learnings);
        setWordCount(calcWC(draft.tasks, draft.extraTasks, reconciled, draft.notes, draft.achievements, draft.learnings));
        setLocalHasEntry(true);
      } else {
        const reconciled = reconcileCustomTasks([], tmplList, dayOfWeek);
        setCustomTasks(reconciled);
      }
      setTemplates(tmplList);

      // Load weekly goals: from today's draft on Monday, from Monday's draft on Saturday
      if (dayOfWeek === 1) {
        setWeeklyGoals(draft?.weeklyGoals ?? []);
      } else if (dayOfWeek === 6) {
        const mondayDraft = await getDraft(mondayDate);
        if (!cancelled) {
          mondayDraftRef.current = mondayDraft ?? null;
          setWeeklyGoals(mondayDraft?.weeklyGoals ?? []);
        }
      }

      try {
        const res = await fetch(`/api/journal/metadata?date=${todayStr}`);
        if (res.ok) {
          const meta: { updatedAt: string } | null = await res.json();
          if (meta && !cancelled) {
            const cloudTs = new Date(meta.updatedAt).getTime();
            const localUpdatedAt = draft?.updatedAt ?? 0;
            const lastSyncedAt = draft?.syncedAt ?? 0;
            if (cloudTs > lastSyncedAt && cloudTs > localUpdatedAt) setIsStale(true);
          }
        }
      } catch { /* offline */ }
    })();
    return () => { cancelled = true; };
  }, [todayStr, dayOfWeek]);

  const buildDraft = useCallback(
    (overrides: Partial<JournalDraft> = {}): JournalDraft => ({
      date: todayStr,
      tasks: overrides.tasks ?? tasks,
      extraTasks: overrides.extraTasks ?? extraTasks,
      customTasks: overrides.customTasks ?? customTasks,
      notes: overrides.notes ?? notes,
      achievements: overrides.achievements ?? achievements,
      learnings: overrides.learnings ?? learnings,
      weeklyGoals: overrides.weeklyGoals ?? (dayOfWeek === 1 ? weeklyGoals : []),
      updatedAt: Date.now(),
    }),
    [todayStr, tasks, extraTasks, customTasks, notes, achievements, learnings, weeklyGoals, dayOfWeek]
  );

  const triggerAutoSave = useCallback((overrides: Partial<JournalDraft> = {}) => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      const draft = buildDraft(overrides);
      await saveDraft(draft);
      setLocalHasEntry(true);
      setWordCount(calcWC(draft.tasks, draft.extraTasks, draft.customTasks, draft.notes, draft.achievements, draft.learnings));
    }, 600);
  }, [buildDraft]);

  // --- Weekly goals (Monday: edit, Saturday: check off from Monday's draft) ---
  const addGoal = () => {
    if (!newGoalText.trim()) return;
    const next: WeeklyGoalItem[] = [...weeklyGoals, { id: crypto.randomUUID(), text: newGoalText.trim(), done: false }];
    setWeeklyGoals(next);
    setNewGoalText("");
    triggerAutoSave({ weeklyGoals: next });
  };

  const toggleGoal = async (id: string) => {
    const next = weeklyGoals.map(g => g.id === id ? { ...g, done: !g.done } : g);
    setWeeklyGoals(next);
    if (dayOfWeek === 1) {
      triggerAutoSave({ weeklyGoals: next });
    } else if (dayOfWeek === 6) {
      const mondayDate = adjacentDate(todayStr, -5);
      // Build a minimal Monday draft if one doesn't exist yet
      const base: JournalDraft = mondayDraftRef.current ?? {
        date: mondayDate,
        tasks: [], extraTasks: [], customTasks: [],
        notes: "", achievements: "", learnings: "",
        weeklyGoals: [], updatedAt: Date.now(),
      };
      const updated: JournalDraft = { ...base, weeklyGoals: next, updatedAt: Date.now() };
      mondayDraftRef.current = updated;
      await saveDraft(updated);
    }
  };

  const deleteGoal = (id: string) => {
    const next = weeklyGoals.filter(g => g.id !== id);
    setWeeklyGoals(next);
    triggerAutoSave({ weeklyGoals: next });
  };

  // --- Regular tasks ---
  const addTask = () => {
    if (!newTaskText.trim()) return;
    const next = [...tasks, { id: crypto.randomUUID(), text: newTaskText.trim(), done: false }];
    setTasks(next); setNewTaskText(""); triggerAutoSave({ tasks: next });
  };

  const toggleTask = (id: string, list: "tasks" | "extraTasks" | "customTasks") => {
    const setter = list === "tasks" ? setTasks : list === "extraTasks" ? setExtraTasks : setCustomTasks;
    const current = list === "tasks" ? tasks : list === "extraTasks" ? extraTasks : customTasks;
    const next = current.map(t =>
      t.id === id ? { ...t, done: !t.done, completedAt: !t.done ? Date.now() : undefined } : t
    );
    setter(next);
    triggerAutoSave({ [list]: next });

    const toggled = next.find(t => t.id === id);
    if (toggled?.done) {
      const allRegularDone = (list === "tasks" ? next : tasks).every(t => t.done);
      const allCustomDone = (list === "customTasks" ? next : customTasks).every(t => t.done);
      const allExtraDone = (list === "extraTasks" ? next : extraTasks).every(t => t.done);
      const mainDone = allRegularDone && allCustomDone;
      const allDone = mainDone && (extraTasks.length === 0 || allExtraDone);

      if (allDone && (tasks.length > 0 || customTasks.length > 0)) {
        playAllDone();
        confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 }, colors: ["#6366f1", "#10b981", "#f59e0b", "#fff"] });
        if (extraTasks.length > 0) {
          toast.success("You went the extra mile!", { description: "You done extra — keep it up!" });
        } else {
          toast.success("Day complete!", { description: "Great work today 🎉" });
        }
      } else if (mainDone && tasks.length > 0) {
        playAllDone();
        confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 }, colors: ["#6366f1", "#10b981", "#fff"] });
        toast.success("All tasks done!", { description: "Now tackle those extras!" });
      } else {
        playTaskDone();
      }
    }
  };

  const deleteTask = (id: string, list: "tasks" | "extraTasks") => {
    if (list === "tasks") {
      const next = tasks.filter(t => t.id !== id);
      setTasks(next); triggerAutoSave({ tasks: next });
    } else {
      const next = extraTasks.filter(t => t.id !== id);
      setExtraTasks(next); triggerAutoSave({ extraTasks: next });
    }
  };

  // --- Extra tasks ---
  const addExtra = () => {
    if (!newExtraText.trim()) return;
    const next = [...extraTasks, { id: crypto.randomUUID(), text: newExtraText.trim(), done: false }];
    setExtraTasks(next); setNewExtraText(""); triggerAutoSave({ extraTasks: next });
  };

  const currentContent = (): JournalContent => ({
    tasks, extraTasks, customTasks, templates, notes, achievements, learnings,
    weeklyGoals: dayOfWeek === 1 ? weeklyGoals : [],
  });

  const applyContent = (c: JournalContent) => {
    const reconciled = reconcileCustomTasks(c.customTasks, c.templates.length ? c.templates : templates, dayOfWeek);
    setTasks(c.tasks);
    setExtraTasks(c.extraTasks);
    setCustomTasks(reconciled);
    setNotes(c.notes);
    setAchievements(c.achievements);
    setLearnings(c.learnings);
    if (dayOfWeek === 1) setWeeklyGoals(c.weeklyGoals ?? []);
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
      const wc = calcWC(content.tasks, content.extraTasks, content.customTasks, content.notes, content.achievements, content.learnings);

      const m = await fetch("/api/journal/metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: todayStr, wordCount: wc, salt }),
      });
      if (!m.ok) throw new Error("Failed to save metadata");
      const savedMeta: { updatedAt: string } = await m.json();
      const serverTs = new Date(savedMeta.updatedAt).getTime();

      const c2 = await fetch("/api/journal/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: todayStr, encryptedData, iv }),
      });
      if (!c2.ok) throw new Error("Failed to save content");

      const syncedAt = Math.max(serverTs, Date.now());
      await saveDraft({ date: todayStr, ...content, updatedAt: syncedAt, syncedAt });
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
      // Ensure backward compat with old synced entries
      content.extraTasks = content.extraTasks ?? [];
      content.customTasks = content.customTasks ?? [];
      content.templates = content.templates ?? [];
      content.weeklyGoals = content.weeklyGoals ?? [];
      applyContent(content);
      setWordCount(calcWC(content.tasks, content.extraTasks, content.customTasks, content.notes, content.achievements, content.learnings));
      await saveDraft({ date: todayStr, ...content, weeklyGoals: content.weeklyGoals ?? [], updatedAt: Date.now(), syncedAt: Date.now() });
      setIsStale(false); setSyncModal(null);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "Failed to load");
    } finally { setModalLoading(false); }
  };

  // Completion state
  const doneTasks = tasks.filter(t => t.done).length;
  const doneCustom = customTasks.filter(t => t.done).length;
  const doneExtra = extraTasks.filter(t => t.done).length;
  const mainTasksDone = tasks.length > 0 && tasks.every(t => t.done);
  const customDone = customTasks.length === 0 || customTasks.every(t => t.done);
  const extraDone = extraTasks.length > 0 && extraTasks.every(t => t.done);
  const dayComplete = (mainTasksDone || tasks.length === 0) && customDone;
  const dayBonusComplete = dayComplete && extraDone;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-medium text-indigo-400 uppercase tracking-widest mb-0.5">Today</p>
          <h1 className="text-2xl font-bold text-zinc-100">
            {today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </h1>
          <div className="flex items-center gap-3 mt-1.5 text-xs flex-wrap">
            {syncStatus === "saved" ? (
              <span className="flex items-center gap-1 text-emerald-400"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />Synced</span>
            ) : localHasEntry ? (
              <span className="flex items-center gap-1 text-amber-400"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" />Local draft</span>
            ) : (
              <span className="text-zinc-600">No draft yet</span>
            )}
            {wordCount > 0 && <span className="text-zinc-500">{wordCount} words</span>}
            {/* Day completion badge */}
            {dayBonusComplete ? (
              <span className="flex items-center gap-1 rounded-full bg-yellow-500/15 border border-yellow-500/30 px-2.5 py-0.5 text-yellow-400 font-medium">
                ★ You done extra — keep it up!
              </span>
            ) : dayComplete ? (
              <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-emerald-400 font-medium">
                ✓ Day complete
              </span>
            ) : null}
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

      {/* Monday / Saturday: Weekly Goals */}
      {(dayOfWeek === 1 || dayOfWeek === 6) && (
        <Section icon="🎯" title="This Week's Goals" accent="indigo"
          subtitle={dayOfWeek === 1 ? "What do you want to achieve this week?" : "How did your goals go?"}>
          <div className="space-y-2">
            {weeklyGoals.length === 0 && dayOfWeek === 6 && (
              <p className="text-sm text-zinc-600 italic">No goals were set this Monday.</p>
            )}
            {weeklyGoals.map(goal => (
              <div key={goal.id} className="flex items-start gap-3 group">
                <Checkbox
                  checked={goal.done}
                  onCheckedChange={() => toggleGoal(goal.id)}
                  className="mt-0.5 border-indigo-600/60 data-[state=checked]:bg-indigo-500 data-[state=checked]:border-indigo-500"
                />
                <span className={`flex-1 text-sm leading-relaxed ${goal.done ? "line-through text-zinc-500" : "text-zinc-200"}`}>
                  {goal.text}
                </span>
                {dayOfWeek === 1 && (
                  <button onClick={() => deleteGoal(goal.id)}
                    className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 text-xs transition-opacity">✕</button>
                )}
              </div>
            ))}
            {dayOfWeek === 1 && (
              <div className="flex items-center gap-2 mt-3">
                <input type="text" value={newGoalText} onChange={e => setNewGoalText(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addGoal()} placeholder="Add a goal…"
                  className="flex-1 bg-transparent border-b border-zinc-700 pb-1 text-sm text-zinc-300 placeholder:text-zinc-600 outline-none focus:border-indigo-500 transition-colors" />
                <button onClick={addGoal} disabled={!newGoalText.trim()}
                  className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-30 transition-colors">+ Add</button>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* ── Tasks ── */}
      <Section
        icon="✓"
        title="Tasks"
        accent="zinc"
        subtitle={tasks.length ? `${doneTasks} done · ${tasks.length - doneTasks} remaining` : "Add your tasks for today"}
      >
        <TaskList
          items={tasks}
          onToggle={id => toggleTask(id, "tasks")}
          onDelete={id => deleteTask(id, "tasks")}
          newText={newTaskText}
          onNewTextChange={setNewTaskText}
          onAdd={addTask}
          placeholder="Add a task…"
        />
      </Section>

      {/* ── Custom Tasks ── */}
      {customTasks.length > 0 && (
        <>
          <Separator className="bg-zinc-800" />
          <Section
            icon="◆"
            title="Custom Tasks"
            accent="indigo"
            subtitle={`${doneCustom}/${customTasks.length} done · recurring`}
          >
            <div className="space-y-2">
              {customTasks.map(task => {
                const tmpl = templates.find(t => t.id === task.id);
                return (
                  <div key={task.id} className="flex items-start gap-3 group">
                    <Checkbox
                      checked={task.done}
                      onCheckedChange={() => toggleTask(task.id, "customTasks")}
                      className="mt-0.5 border-indigo-600/60 data-[state=checked]:bg-indigo-500 data-[state=checked]:border-indigo-500"
                    />
                    <div className="flex-1 min-w-0">
                      <span className={`text-sm leading-relaxed ${task.done ? "line-through text-zinc-500" : "text-zinc-200"}`}>
                        {task.text}
                      </span>
                      {tmpl?.what && (
                        <p className="text-[11px] text-zinc-600 mt-0.5 line-clamp-1">{tmpl.what}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        </>
      )}

      {/* ── Extra Tasks ── */}
      <Separator className="bg-zinc-800" />
      <Section
        icon="+"
        title="Extra Tasks"
        accent={extraDone ? "yellow" : "zinc"}
        subtitle={
          extraDone
            ? "You done extra — keep it up!"
            : extraTasks.length
            ? `${doneExtra} done · ${extraTasks.length - doneExtra} remaining`
            : "Bonus tasks beyond the plan"
        }
      >
        <TaskList
          items={extraTasks}
          onToggle={id => toggleTask(id, "extraTasks")}
          onDelete={id => deleteTask(id, "extraTasks")}
          newText={newExtraText}
          onNewTextChange={setNewExtraText}
          onAdd={addExtra}
          placeholder="Add an extra task…"
          checkboxClass="border-yellow-600/60 data-[state=checked]:bg-yellow-500 data-[state=checked]:border-yellow-500"
        />
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


      {/* Completed tasks timeline */}
      {(tasks.some(t => t.done) || extraTasks.some(t => t.done) || customTasks.some(t => t.done)) && (
        <>
          <Separator className="bg-zinc-800" />
          <Section icon="◎" title="Completed Today" accent="zinc" subtitle="Task completion log">
            <div className="relative pl-4 space-y-3 border-l border-zinc-800">
              {[
                ...tasks.filter(t => t.done).map(t => ({ ...t, kind: "task" as const })),
                ...customTasks.filter(t => t.done).map(t => ({ ...t, kind: "custom" as const })),
                ...extraTasks.filter(t => t.done).map(t => ({ ...t, kind: "extra" as const })),
              ]
                .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
                .map(task => (
                  <div key={task.id} className="relative">
                    <span className={`absolute -left-[1.3rem] top-1.5 w-2 h-2 rounded-full ${
                      task.kind === "extra" ? "bg-yellow-500" : task.kind === "custom" ? "bg-indigo-500" : "bg-emerald-500"
                    }`} />
                    <p className="text-sm text-zinc-400 line-through">{task.text}</p>
                    {task.completedAt && (
                      <p className="text-[11px] text-zinc-600 mt-0.5">
                        {new Date(task.completedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                        {task.kind === "extra" && <span className="ml-1.5 text-yellow-600">extra</span>}
                        {task.kind === "custom" && <span className="ml-1.5 text-indigo-600">custom</span>}
                      </p>
                    )}
                  </div>
                ))}
            </div>
          </Section>
        </>
      )}

      <PasswordModal open={syncModal === "save"} title="Sync to cloud"
        description="Encrypt and save today's journal to the cloud."
        loading={modalLoading} error={modalError}
        showMergeOption mergeEnabled={mergeEnabled} onMergeChange={setMergeEnabled}
        onClose={() => setSyncModal(null)} onSubmit={handleSyncToCloud} />
      <PasswordModal open={syncModal === "load"} title="Load from cloud"
        description="Decrypt and load the latest version from the cloud."
        loading={modalLoading} error={modalError}
        onClose={() => setSyncModal(null)} onSubmit={handleLoadFromCloud} />
    </div>
  );
}

function TaskList({
  items,
  onToggle,
  onDelete,
  newText,
  onNewTextChange,
  onAdd,
  placeholder,
  checkboxClass = "border-zinc-600 data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500",
}: {
  items: Task[];
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  newText: string;
  onNewTextChange: (v: string) => void;
  onAdd: () => void;
  placeholder: string;
  checkboxClass?: string;
}) {
  return (
    <div className="space-y-2">
      {items.map(task => (
        <div key={task.id} className="flex items-start gap-3 group">
          <Checkbox
            checked={task.done}
            onCheckedChange={() => onToggle(task.id)}
            className={`mt-0.5 ${checkboxClass}`}
          />
          <span className={`flex-1 text-sm leading-relaxed ${task.done ? "line-through text-zinc-500" : "text-zinc-200"}`}>
            {task.text}
          </span>
          <button
            onClick={() => onDelete(task.id)}
            className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 text-xs transition-opacity"
          >
            ✕
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2 mt-3">
        <input
          type="text"
          value={newText}
          onChange={e => onNewTextChange(e.target.value)}
          onKeyDown={e => e.key === "Enter" && onAdd()}
          placeholder={placeholder}
          className="flex-1 bg-transparent border-b border-zinc-700 pb-1 text-sm text-zinc-300 placeholder:text-zinc-600 outline-none focus:border-indigo-500 transition-colors"
        />
        <button
          onClick={onAdd}
          disabled={!newText.trim()}
          className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-30 transition-colors"
        >
          + Add
        </button>
      </div>
    </div>
  );
}

function Section({ icon, title, accent, subtitle, children }: {
  icon: string;
  title: string;
  accent: "zinc" | "indigo" | "emerald" | "yellow";
  subtitle?: string;
  children: React.ReactNode;
}) {
  const c = {
    zinc: "text-zinc-400",
    indigo: "text-indigo-400",
    emerald: "text-emerald-400",
    yellow: "text-yellow-400",
  };
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <span className={`text-sm ${c[accent]}`}>{icon}</span>
        <div>
          <h2 className={`text-sm font-semibold ${c[accent]}`}>{title}</h2>
          {subtitle && <p className={`text-xs mt-0.5 ${accent === "yellow" ? "text-yellow-500/80" : "text-zinc-600"}`}>{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}
