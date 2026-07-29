"use client";

// Local finance store. Shares the "journal-app" IndexedDB connection defined in
// hooks/use-journal-db.ts (stores added in the v4 upgrade).
//
// Deletes are tombstones, never hard removals: a hard delete would leave no trace
// that the month changed, so getDirtyMonths() would miss it and the delete would
// never propagate to another device through the encrypted blob.

import { getDB, type FinanceMonthState } from "@/hooks/use-journal-db";
import {
  DEFAULT_SETTINGS,
  monthOf,
  type FinanceSettings,
  type FinanceTx,
} from "@/lib/finance";

export async function getAllTx(opts?: { includeDeleted?: boolean }): Promise<FinanceTx[]> {
  const db = await getDB();
  const all = await db.getAll("financeTx");
  return opts?.includeDeleted ? all : all.filter((t) => !t.deleted);
}

export async function getTxForMonth(
  month: string,
  opts?: { includeDeleted?: boolean }
): Promise<FinanceTx[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex(
    "financeTx",
    "by-date",
    IDBKeyRange.bound(`${month}-00`, `${month}-99`)
  );
  return opts?.includeDeleted ? all : all.filter((t) => !t.deleted);
}

export async function putTx(tx: FinanceTx): Promise<void> {
  const db = await getDB();
  await db.put("financeTx", { ...tx, updatedAt: Date.now() });
}

export async function softDeleteTx(id: string): Promise<void> {
  const db = await getDB();
  const existing = await db.get("financeTx", id);
  if (!existing) return;
  await db.put("financeTx", { ...existing, deleted: true, updatedAt: Date.now() });
}

/** Union by id, keeping whichever copy has the higher updatedAt. */
export async function mergeTxs(incoming: FinanceTx[]): Promise<void> {
  if (!incoming.length) return;
  const db = await getDB();
  const tx = db.transaction("financeTx", "readwrite");
  for (const row of incoming) {
    const existing = await tx.store.get(row.id);
    if (!existing || row.updatedAt > existing.updatedAt) {
      await tx.store.put(row);
    }
  }
  await tx.done;
}

export async function getSettings(): Promise<FinanceSettings> {
  const db = await getDB();
  const row = await db.get("financeSettings", "settings");
  if (!row) return { ...DEFAULT_SETTINGS };
  const { key: _key, ...settings } = row;
  return settings;
}

export async function saveSettings(settings: FinanceSettings): Promise<void> {
  const db = await getDB();
  await db.put("financeSettings", { ...settings, key: "settings" });
}

export async function getMonthState(month: string): Promise<FinanceMonthState | undefined> {
  const db = await getDB();
  return db.get("financeMonths", month);
}

export async function getAllMonthStates(): Promise<FinanceMonthState[]> {
  const db = await getDB();
  return db.getAll("financeMonths");
}

export async function setMonthSynced(month: string, serverTs: number): Promise<void> {
  const db = await getDB();
  await db.put("financeMonths", { month, syncedAt: serverTs, serverUpdatedAt: serverTs });
}

/** Months holding at least one transaction edited since that month last synced. */
export async function getDirtyMonths(): Promise<string[]> {
  const db = await getDB();
  const [txs, states] = await Promise.all([
    db.getAll("financeTx"),
    db.getAll("financeMonths"),
  ]);
  const syncedAt = new Map(states.map((s) => [s.month, s.syncedAt]));
  const dirty = new Set<string>();
  for (const tx of txs) {
    const month = monthOf(tx.date);
    if (tx.updatedAt > (syncedAt.get(month) ?? 0)) dirty.add(month);
  }
  return [...dirty].sort();
}
