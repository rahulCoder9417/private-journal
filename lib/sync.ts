"use client";

// Journal push/pull, factored out of the four places that used to duplicate it.
// No verify-password call here — verification happens once, at unlock (lib/vault.ts).

import { encrypt, decrypt, generateSalt } from "@/lib/crypto";
import { getKey } from "@/lib/vault";

/** Encrypt and upload one entry. Returns the timestamp to record as syncedAt. */
export async function pushEntry(
  date: string,
  content: unknown,
  wordCount: number
): Promise<number> {
  const salt = generateSalt();
  const key = await getKey(salt);
  const { encryptedData, iv } = await encrypt(key, JSON.stringify(content));

  const saved = await fetch("/api/journal/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date, wordCount, salt, encryptedData, iv }),
  });
  if (!saved.ok) {
    const body = await saved.json().catch(() => null);
    throw new Error(body?.error ?? "Failed to save");
  }
  const { updatedAt }: { updatedAt: string } = await saved.json();
  return Math.max(new Date(updatedAt).getTime(), Date.now());
}

/** Download and decrypt one entry. Returns null when the cloud has nothing for that date. */
export async function pullEntry<T>(date: string): Promise<T | null> {
  const res = await fetch(`/api/journal/content?date=${date}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? "Failed to load from cloud");
  }
  const data: { salt: string; encryptedData: string; iv: string } | null =
    await res.json();
  if (!data) return null;

  const key = await getKey(data.salt);
  let plain: string;
  try {
    plain = await decrypt(key, data.encryptedData, data.iv);
  } catch {
    throw new Error(
      "Decryption failed — your password is correct but the server encryption key (ENCRYPTION_SECRET) may have changed since this entry was synced."
    );
  }
  return JSON.parse(plain) as T;
}
