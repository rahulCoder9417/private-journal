"use client";

import { openDB, type IDBPDatabase, type DBSchema } from "idb";

export interface Task {
  id: string;
  text: string;
  done: boolean;
  completedAt?: number; // timestamp when marked done
}

export interface JournalDraft {
  date: string;
  tasks: Task[];
  notes: string;
  achievements: string;
  learnings: string;
  weeklyGoal?: string;
  weeklyAchieved?: string;
  updatedAt: number;
  syncedAt?: number;
}

interface JournalDBSchema extends DBSchema {
  journalDrafts: {
    key: string;
    value: JournalDraft;
  };
}

let dbInstance: Promise<IDBPDatabase<JournalDBSchema>> | null = null;

function getDB() {
  if (!dbInstance) {
    dbInstance = openDB<JournalDBSchema>("journal-app", 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore("journalDrafts", { keyPath: "date" });
        }
        // v2: tasks changed from string to Task[] — handled at read time
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
    notes: (r.notes as string) ?? "",
    achievements: (r.achievements as string) ?? "",
    learnings: (r.learnings as string) ?? "",
    weeklyGoal: (r.weeklyGoal as string) ?? "",
    weeklyAchieved: (r.weeklyAchieved as string) ?? "",
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

export async function markSynced(date: string, serverTs?: number): Promise<void> {
  const db = await getDB();
  const draft = await db.get("journalDrafts", date);
  if (draft) {
    // Use server timestamp so future stale checks compare against the exact cloud time
    await db.put("journalDrafts", { ...normalizeDraft(draft), syncedAt: serverTs ?? Date.now() });
  }
}
