"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";
import { useUnlocked, useVault, verifyAndUnlock } from "@/lib/vault";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function VaultGate({
  userName,
  children,
}: {
  userName: string;
  children: React.ReactNode;
}) {
  const unlocked = useUnlocked();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setError("");
    setLoading(true);
    try {
      await verifyAndUnlock(password);
      setPassword(""); // the store owns it now
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wrong password");
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    useVault.getState().lock();
    await signOut();
    router.push("/login");
  };

  if (unlocked) return <>{children}</>;

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900/70 p-8 shadow-xl shadow-black/30 space-y-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-xs font-bold">
              J
            </span>
            <span className="text-sm font-medium text-zinc-300 tracking-wide">Journal</span>
          </div>
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Locked</p>
          <h1 className="text-2xl font-bold text-zinc-100 tracking-tight">
            Enter your password
          </h1>
          <p className="text-sm text-zinc-500">
            Your entries are encrypted. This password decrypts them locally and is never
            stored — you&apos;ll be asked again after a reload.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete="current-password"
            className="bg-zinc-800/60 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-indigo-500/40 focus-visible:border-indigo-500/60 h-10"
          />
          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}
          <Button
            type="submit"
            disabled={!password || loading}
            className="w-full h-10 bg-indigo-600 hover:bg-indigo-500 text-white font-medium"
          >
            {loading ? "Unlocking…" : "Unlock"}
          </Button>
        </form>

        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-zinc-600">{userName}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSignOut}
            className="text-zinc-500 hover:text-zinc-200 text-xs h-7 px-2"
          >
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
