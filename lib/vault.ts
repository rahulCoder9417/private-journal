"use client";

// Session password vault.
//
// The account password doubles as the encryption password (see lib/crypto.ts).
// This module holds it in memory for the life of an unlocked session so that
// pushes and pulls stop prompting for it on every operation.
//
// LIMITATIONS — read before assuming this protects anything:
//   * This is a UI gate, NOT encryption at rest. journalDrafts, customTaskTemplates
//     and the finance stores all sit in IndexedDB as plaintext. Anyone with devtools
//     on an unlocked device reads them whether the screen is locked or not.
//   * The plaintext password now lives in JS memory for the whole session instead of
//     for the duration of one operation. Against XSS that is a real widening; for a
//     single-user personal app it is an accepted trade.
//   * Nothing is persisted — no localStorage, no sessionStorage, no cookie. A reload
//     re-gates, deliberately.

import { create } from "zustand";
import { deriveKey } from "@/lib/crypto";
import { fetchPepper, clearPepperCache } from "@/lib/pepper";

interface VaultState {
  password: string | null;
  unlock: (password: string) => void;
  lock: () => void;
}

// Derived keys, memoized by salt. Safe to key on salt alone because password and
// pepper are constant for the life of an unlocked session; the cache dies with it.
const keyCache = new Map<string, Promise<CryptoKey>>();

export function clearKeyCache() {
  keyCache.clear();
}

export const useVault = create<VaultState>((set) => ({
  password: null,
  unlock: (password) => set({ password }),
  lock: () => {
    clearKeyCache();
    clearPepperCache();
    set({ password: null });
  },
}));

export class VaultLockedError extends Error {
  constructor() {
    super("Vault is locked — enter your password to continue.");
    this.name = "VaultLockedError";
  }
}

export function getPassword(): string {
  const pw = useVault.getState().password;
  if (!pw) throw new VaultLockedError();
  return pw;
}

/** Verify against the server, then unlock. Throws on a wrong password. */
export async function verifyAndUnlock(password: string): Promise<void> {
  const res = await fetch("/api/journal/verify-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? "Wrong password");
  }
  useVault.getState().unlock(password);
}

/**
 * Derive (or reuse) the AES-GCM key for a given salt.
 *
 * Note on what the cache actually buys: journal entries get a fresh salt on every
 * save (app/(app)/page.tsx), so /read still pays one PBKDF2 per entry. Finance uses
 * a single stable salt, so its whole ledger costs one derivation per session.
 */
export function getKey(saltHex: string): Promise<CryptoKey> {
  const cached = keyCache.get(saltHex);
  if (cached) return cached;

  const password = getPassword();
  const promise = (async () => {
    const pepper = await fetchPepper();
    return deriveKey(password + pepper, saltHex);
  })();

  // Don't cache a rejected derivation (e.g. the pepper fetch failed while offline).
  promise.catch(() => keyCache.delete(saltHex));

  if (keyCache.size > 200) keyCache.clear();
  keyCache.set(saltHex, promise);
  return promise;
}

export function useUnlocked(): boolean {
  return useVault((s) => s.password !== null);
}
