"use client";

let cached: string | null = null;

export async function fetchPepper(): Promise<string> {
  if (cached) return cached;
  const res = await fetch("/api/journal/pepper");
  if (!res.ok) throw new Error("Failed to fetch encryption key from server");
  const data: { pepper: string } = await res.json();
  cached = data.pepper;
  return cached;
}

export function clearPepperCache() {
  cached = null;
}
