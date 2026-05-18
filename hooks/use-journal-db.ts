"use client";

import { openDB, type IDBPDatabase, type DBSchema } from "idb";

export interface Task {
  id: string;
  text: string;
  done: boolean;
  completedAt?: number;
}

export interface WeeklyGoalItem {
  id: string;
  text: string;
  done: boolean;
}

export interface CustomTaskTemplate {
  id: string;
  name: string;
  what: string;
  skipDays: number[]; // 0=Sun … 6=Sat
  updatedAt: number;
}

export interface JournalDraft {
  date: string;
  tasks: Task[];
  extraTasks: Task[];
  customTasks: Task[]; // per-day instances of templates (id matches template id)
  notes: string;
  achievements: string;
  learnings: string;
  weeklyGoal?: string;       // legacy compat
  weeklyAchieved?: string;   // legacy compat
  weeklyGoals?: WeeklyGoalItem[];
  updatedAt: number;
  syncedAt?: number;
}

interface JournalDBSchema extends DBSchema {
  journalDrafts: {
    key: string;
    value: JournalDraft;
  };
  customTaskTemplates: {
    key: string;
    value: CustomTaskTemplate;
  };
}

let dbInstance: Promise<IDBPDatabase<JournalDBSchema>> | null = null;

function getDB() {
  if (!dbInstance) {
    dbInstance = openDB<JournalDBSchema>("journal-app", 3, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore("journalDrafts", { keyPath: "date" });
        }
        if (oldVersion < 3) {
          if (!db.objectStoreNames.contains("customTaskTemplates")) {
            db.createObjectStore("customTaskTemplates", { keyPath: "id" });
          }
        }
      },
    });
  }
  return dbInstance;
}

function normalizeDraft(raw: unknown): JournalDraft {
  const r = raw as Record<string, unknown>;
  return {
    date: r.date as string,
    tasks: Array.isArray(r.tasks)
      ? (r.tasks as Task[])
      : typeof r.tasks === "string" && r.tasks
      ? [{ id: crypto.randomUUID(), text: r.tasks as string, done: false }]
      : [],
    extraTasks: Array.isArray(r.extraTasks) ? (r.extraTasks as Task[]) : [],
    customTasks: Array.isArray(r.customTasks) ? (r.customTasks as Task[]) : [],
    notes: (r.notes as string) ?? "",
    achievements: (r.achievements as string) ?? "",
    learnings: (r.learnings as string) ?? "",
    weeklyGoal: (r.weeklyGoal as string) ?? "",
    weeklyAchieved: (r.weeklyAchieved as string) ?? "",
    weeklyGoals: Array.isArray(r.weeklyGoals) ? (r.weeklyGoals as WeeklyGoalItem[]) : [],
    updatedAt: (r.updatedAt as number) ?? Date.now(),
    syncedAt: r.syncedAt as number | undefined,
  };
}

export async function getDraft(date: string): Promise<JournalDraft | undefined> {
  const db = await getDB();
  const raw = await db.get("journalDrafts", date);
  return raw ? normalizeDraft(raw) : undefined;
}

export async function saveDraft(draft: JournalDraft): Promise<void> {
  const db = await getDB();
  await db.put("journalDrafts", draft);
}

export async function getAllDraftDates(): Promise<string[]> {
  const db = await getDB();
  return db.getAllKeys("journalDrafts");
}

export async function getAllDrafts(): Promise<JournalDraft[]> {
  const db = await getDB();
  const all = await db.getAll("journalDrafts");
  return all.map(normalizeDraft);
}

export async function markSynced(date: string, serverTs?: number): Promise<void> {
  const db = await getDB();
  const draft = await db.get("journalDrafts", date);
  if (draft) {
    await db.put("journalDrafts", { ...normalizeDraft(draft), syncedAt: serverTs ?? Date.now() });
  }
}

export async function getTemplates(): Promise<CustomTaskTemplate[]> {
  const db = await getDB();
  const all = await db.getAll("customTaskTemplates");
  return all.sort((a, b) => a.updatedAt - b.updatedAt);
}

export async function saveTemplate(t: CustomTaskTemplate): Promise<void> {
  const db = await getDB();
  await db.put("customTaskTemplates", t);
}

export async function deleteTemplate(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("customTaskTemplates", id);
}

export async function replaceAllTemplates(templates: CustomTaskTemplate[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("customTaskTemplates", "readwrite");
  await tx.store.clear();
  for (const t of templates) await tx.store.put(t);
  await tx.done;
}
