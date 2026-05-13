"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { getAllDraftDates } from "@/hooks/use-journal-db";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_LABELS = ["S","M","T","W","T","F","S"];

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export function MiniCalendar() {
  const router = useRouter();
  const pathname = usePathname();
  const today = new Date();
  const todayStr = toYMD(today);

  const [cal, setCal] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [localDates, setLocalDates] = useState<Set<string>>(new Set());
  const [syncedDates, setSyncedDates] = useState<Set<string>>(new Set());

  // Reload local dates on mount + window focus
  const refreshLocal = useCallback(async () => {
    const keys = await getAllDraftDates();
    setLocalDates(new Set(keys));
  }, []);

  useEffect(() => {
    refreshLocal();
    window.addEventListener("focus", refreshLocal);
    return () => window.removeEventListener("focus", refreshLocal);
  }, [refreshLocal]);

  // Fetch synced dates for visible month
  useEffect(() => {
    const from = `${cal.year}-${String(cal.month+1).padStart(2,"0")}-01`;
    const last = new Date(cal.year, cal.month+1, 0).getDate();
    const to = `${cal.year}-${String(cal.month+1).padStart(2,"0")}-${String(last).padStart(2,"0")}`;
    fetch(`/api/journal/metadata?from=${from}&to=${to}`)
      .then(r => r.json())
      .then((rows: { date: string }[]) => setSyncedDates(new Set(rows.map(r => r.date))))
      .catch(() => {});
  }, [cal.year, cal.month]);

  const firstDow = new Date(cal.year, cal.month, 1).getDay();
  const daysInMonth = new Date(cal.year, cal.month+1, 0).getDate();
  const cells: (number|null)[] = [...Array(firstDow).fill(null), ...Array.from({length: daysInMonth},(_,i)=>i+1)];

  const prevMonth = () => setCal(c => c.month===0 ? {year:c.year-1,month:11} : {...c,month:c.month-1});
  const nextMonth = () => setCal(c => c.month===11 ? {year:c.year+1,month:0} : {...c,month:c.month+1});

  // Active date from pathname
  const activeDate = pathname.startsWith("/journal/") ? pathname.split("/journal/")[1] : null;

  return (
    <div className="sticky top-6 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
      {/* Month nav */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-300">
          {MONTHS[cal.month].slice(0,3)} {cal.year}
        </span>
        <div className="flex gap-0.5">
          <button onClick={prevMonth} className="w-6 h-6 flex items-center justify-center text-zinc-500 hover:text-zinc-200 rounded transition-colors">‹</button>
          <button onClick={nextMonth} className="w-6 h-6 flex items-center justify-center text-zinc-500 hover:text-zinc-200 rounded transition-colors">›</button>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 gap-0.5">
        {DAY_LABELS.map((d,i) => (
          <div key={i} className="text-center text-[10px] font-medium text-zinc-600 py-0.5">{d}</div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={`e-${i}`} />;
          const ds = `${cal.year}-${String(cal.month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
          const isToday = ds === todayStr;
          const isFuture = ds > todayStr;
          const isActive = ds === activeDate;
          const hasSynced = syncedDates.has(ds);
          const hasLocalOnly = localDates.has(ds) && !hasSynced;

          return (
            <button
              key={ds}
              disabled={isFuture}
              onClick={() => isToday ? router.push("/") : router.push(`/journal/${ds}`)}
              className={[
                "relative flex flex-col items-center justify-center aspect-square rounded-md text-[11px] transition-colors",
                isFuture ? "opacity-30 cursor-not-allowed" : "cursor-pointer",
                isActive && !isToday ? "ring-1 ring-zinc-500" : "",
                isToday ? "bg-indigo-600 text-white font-bold" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200",
              ].join(" ")}
            >
              {day}
              {!isToday && (hasSynced || hasLocalOnly) && (
                <span className={`absolute bottom-0.5 w-1 h-1 rounded-full ${hasSynced ? "bg-indigo-400" : "bg-amber-400"}`} />
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="space-y-1 pt-1 border-t border-zinc-800">
        <div className="flex items-center gap-2 text-[10px] text-zinc-600">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />Synced to cloud
        </div>
        <div className="flex items-center gap-2 text-[10px] text-zinc-600">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />Local draft only
        </div>
        <div className="flex items-center gap-2 text-[10px] text-zinc-600">
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-700 flex-shrink-0" />No entry
        </div>
      </div>
    </div>
  );
}
