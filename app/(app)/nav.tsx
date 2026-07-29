"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { signOut } from "@/lib/auth-client";
import { getAllDrafts } from "@/hooks/use-journal-db";
import { useVault } from "@/lib/vault";
import { Button } from "@/components/ui/button";
import { SyncAllModal } from "@/components/sync-all-modal";

const links = [
  { href: "/", label: "Today" },
  { href: "/finance", label: "Finance" },
  { href: "/read", label: "Read" },
  { href: "/analytics", label: "Analytics" },
  { href: "/customize", label: "Customize" },
];

export function AppNav({ userName }: { userName: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [unsyncedDates, setUnsyncedDates] = useState<string[]>([]);
  const [syncAllOpen, setSyncAllOpen] = useState(false);

  const checkUnsynced = useCallback(async () => {
    const drafts = await getAllDrafts();
    const unsynced = drafts
      .filter((d) => d.updatedAt > (d.syncedAt ?? 0))
      .map((d) => d.date)
      .sort();
    setUnsyncedDates(unsynced);
  }, []);

  useEffect(() => {
    checkUnsynced();
    window.addEventListener("focus", checkUnsynced);
    return () => window.removeEventListener("focus", checkUnsynced);
  }, [checkUnsynced]);

  const handleSignOut = async () => {
    // Clear the in-memory password (and the pepper/key caches) before the session goes.
    useVault.getState().lock();
    await signOut();
    router.push("/login");
  };

  return (
    <>
      <header className="border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="container max-w-5xl mx-auto px-4 h-13 flex items-center justify-between gap-4">
          {/* Left: logo + nav */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-md bg-indigo-600 flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0">
                J
              </span>
              <span className="text-sm font-semibold text-zinc-200 tracking-wide">Journal</span>
            </div>
            <nav className="flex items-center gap-1">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    pathname === l.href
                      ? "text-zinc-100 bg-zinc-800"
                      : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60"
                  }`}
                >
                  {l.label}
                </Link>
              ))}
            </nav>
          </div>

          {/* Right: sync all + user + sign out */}
          <div className="flex items-center gap-3">
            {unsyncedDates.length > 0 && (
              <button
                onClick={() => setSyncAllOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-amber-300 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 transition-colors"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                Sync {unsyncedDates.length} unsynced
              </button>
            )}
            <span className="text-xs text-zinc-600 hidden sm:block">{userName}</span>
            <Button variant="ghost" size="sm" onClick={() => useVault.getState().lock()}
              title="Lock — requires your password to unlock again"
              className="text-zinc-500 hover:text-zinc-200 text-xs h-7 px-2 gap-1">
              <Lock className="w-3 h-3" />
              Lock
            </Button>
            <Button variant="ghost" size="sm" onClick={handleSignOut}
              className="text-zinc-500 hover:text-zinc-200 text-xs h-7 px-2">
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <SyncAllModal
        open={syncAllOpen}
        unsyncedDates={unsyncedDates}
        onClose={() => setSyncAllOpen(false)}
        onComplete={() => {
          setSyncAllOpen(false);
          setUnsyncedDates([]);
        }}
      />
    </>
  );
}
