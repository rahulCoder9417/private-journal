"use client";

// Finance cloud sync. One encrypted blob per month; one stable salt for the whole
// ledger, stored server-side in finance_vault and never rotated.
//
// Conflict policy: last-write-wins per transaction id, compared on updatedAt, unioned
// across devices. Tombstones take part in LWW too, so an edit newer than a delete
// resurrects the row (the right outcome for a mis-click). Every push merges the
// server copy in first, so a whole-blob clobber can't happen.

import { encrypt, decrypt, generateSalt } from "@/lib/crypto";
import { getKey, useVault } from "@/lib/vault";
import {
  getSettings,
  saveSettings,
  getTxForMonth,
  mergeTxs,
  getMonthState,
  setMonthSynced,
  getDirtyMonths,
} from "@/hooks/use-finance-db";
import { DEFAULT_SETTINGS, type FinanceSettings, type FinanceTx } from "@/lib/finance";

interface VaultRow {
  salt: string;
  encryptedSettings: string;
  iv: string;
  updatedAt: string;
}
interface LedgerRow {
  month: string;
  encryptedData: string;
  iv: string;
  updatedAt: string;
}

let vaultPromise: Promise<{ salt: string; key: CryptoKey }> | null = null;

// The derived key dies with the session, so the memo has to die with it too.
useVault.subscribe((state) => {
  if (state.password === null) vaultPromise = null;
});

/**
 * Resolve the ledger's salt and key, creating the server-side vault row on first
 * use. Also reconciles the settings blob (opening balances) by LWW.
 */
function ensureVault(): Promise<{ salt: string; key: CryptoKey }> {
  if (vaultPromise) return vaultPromise;

  vaultPromise = (async () => {
    const res = await fetch("/api/finance/vault");
    if (!res.ok) throw new Error("Failed to reach the finance vault");
    const row: VaultRow | null = await res.json();

    if (row) {
      const key = await getKey(row.salt);
      let remote: FinanceSettings;
      try {
        remote = JSON.parse(await decrypt(key, row.encryptedSettings, row.iv));
      } catch {
        throw new Error(
          "Decryption failed — your password is correct but the server encryption key (ENCRYPTION_SECRET) may have changed since this was synced."
        );
      }
      const local = await getSettings();
      if ((remote.updatedAt ?? 0) > local.updatedAt) {
        await saveSettings({ ...remote, syncedAt: Date.now() });
      }
      return { salt: row.salt, key };
    }

    // First run for this user — mint the one salt the whole ledger will use.
    const salt = generateSalt();
    const key = await getKey(salt);
    const local = await getSettings();
    const { encryptedData, iv } = await encrypt(key, JSON.stringify(local));
    const created = await fetch("/api/finance/vault", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ salt, encryptedSettings: encryptedData, iv }),
    });
    if (!created.ok) {
      const body = await created.json().catch(() => null);
      throw new Error(body?.error ?? "Failed to create the finance vault");
    }
    // The server is authoritative on the salt — it refuses to rotate an existing one.
    const { salt: authoritative }: { salt: string } = await created.json();
    return { salt: authoritative, key: await getKey(authoritative) };
  })();

  vaultPromise.catch(() => { vaultPromise = null; });
  return vaultPromise;
}

async function fetchLedger(month: string): Promise<LedgerRow | null> {
  const res = await fetch(`/api/finance/ledger?month=${month}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? "Failed to load the ledger");
  }
  return res.json();
}

async function decryptLedger(key: CryptoKey, row: LedgerRow): Promise<FinanceTx[]> {
  let plain: string;
  try {
    plain = await decrypt(key, row.encryptedData, row.iv);
  } catch {
    throw new Error(
      "Decryption failed — your password is correct but the server encryption key (ENCRYPTION_SECRET) may have changed since this was synced."
    );
  }
  const parsed: { transactions?: FinanceTx[] } = JSON.parse(plain);
  return parsed.transactions ?? [];
}

/** Read-modify-write: merge the cloud copy in, then push the union back up. */
export async function pushMonth(month: string): Promise<void> {
  const { key } = await ensureVault();

  const remote = await fetchLedger(month);
  if (remote) {
    const state = await getMonthState(month);
    const remoteTs = new Date(remote.updatedAt).getTime();
    if (remoteTs > (state?.syncedAt ?? 0)) {
      await mergeTxs(await decryptLedger(key, remote));
    }
  }

  const transactions = await getTxForMonth(month, { includeDeleted: true });
  const { encryptedData, iv } = await encrypt(key, JSON.stringify({ transactions }));

  const saved = await fetch("/api/finance/ledger", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ month, encryptedData, iv }),
  });
  if (!saved.ok) {
    const body = await saved.json().catch(() => null);
    throw new Error(body?.error ?? `Failed to sync ${month}`);
  }
  const { updatedAt }: { updatedAt: string } = await saved.json();
  await setMonthSynced(month, Math.max(new Date(updatedAt).getTime(), Date.now()));
}

export async function pullMonth(month: string): Promise<void> {
  const { key } = await ensureVault();
  const remote = await fetchLedger(month);
  if (!remote) return;
  await mergeTxs(await decryptLedger(key, remote));
  await setMonthSynced(month, new Date(remote.updatedAt).getTime());
}

export async function pushSettings(): Promise<void> {
  const { salt, key } = await ensureVault();
  const settings = await getSettings();
  const { encryptedData, iv } = await encrypt(key, JSON.stringify(settings));
  const res = await fetch("/api/finance/vault", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ salt, encryptedSettings: encryptedData, iv }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? "Failed to save opening balances");
  }
  await saveSettings({ ...settings, syncedAt: Date.now() });
}

/** Push every month with local changes. Returns the months pushed. */
export async function syncDirty(): Promise<string[]> {
  const months = await getDirtyMonths();
  const settings = await getSettings();
  if (settings.updatedAt > (settings.syncedAt ?? 0)) await pushSettings();
  for (const month of months) await pushMonth(month);
  return months;
}

/** Pull down anything the cloud has that's newer than our last sync of it. */
export async function refreshFromCloud(): Promise<string[]> {
  await ensureVault();
  const res = await fetch("/api/finance/months");
  if (!res.ok) throw new Error("Failed to list cloud months");
  const rows: { month: string; updatedAt: string }[] = await res.json();

  const pulled: string[] = [];
  for (const row of rows) {
    const state = await getMonthState(row.month);
    if (new Date(row.updatedAt).getTime() > (state?.syncedAt ?? 0)) {
      await pullMonth(row.month);
      pulled.push(row.month);
    }
  }
  return pulled;
}

export { DEFAULT_SETTINGS };
