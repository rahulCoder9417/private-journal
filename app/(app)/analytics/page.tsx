"use client";

import { useEffect, useState } from "react";

interface MetaRow {
  date: string;
  wordCount: number;
}

function getDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function computeStreaks(dates: Set<string>): {
  current: number;
  longest: number;
} {
  if (!dates.size) return { current: 0, longest: 0 };

  const today = new Date();
  let current = 0;
  let longest = 0;
  let streak = 0;

  // Check current streak going back from today
  const cur = new Date(today);
  while (dates.has(getDateStr(cur))) {
    current++;
    cur.setDate(cur.getDate() - 1);
  }

  // Calculate longest streak
  const sorted = [...dates].sort();
  let prev: Date | null = null;
  for (const d of sorted) {
    const date = new Date(d + "T00:00:00");
    if (prev) {
      const diff =
        (date.getTime() - prev.getTime()) / 86400_000;
      if (diff === 1) {
        streak++;
      } else {
        longest = Math.max(longest, streak);
        streak = 1;
      }
    } else {
      streak = 1;
    }
    prev = date;
  }
  longest = Math.max(longest, streak);

  return { current, longest };
}

export default function AnalyticsPage() {
  const [dateMeta, setDateMeta] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const today = new Date();
    const yearAgo = new Date(today);
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);

    fetch(
      `/api/journal/metadata?from=${getDateStr(yearAgo)}&to=${getDateStr(today)}`
    )
      .then((r) => r.json())
      .then((rows: MetaRow[]) => {
        const map = new Map<string, number>();
        for (const r of rows) map.set(r.date, r.wordCount);
        setDateMeta(map);
      })
      .finally(() => setLoading(false));
  }, []);

  const dates = new Set(dateMeta.keys());
  const { current, longest } = computeStreaks(dates);
  const total = dateMeta.size;

  // Build 52-week heatmap grid
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 364);
  // Roll back to previous Sunday
  startDate.setDate(startDate.getDate() - startDate.getDay());

  const weeks: string[][] = [];
  const cursor = new Date(startDate);
  while (cursor <= today) {
    const week: string[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(getDateStr(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }

  if (loading) {
    return (
      <div className="text-muted-foreground text-sm">Loading analytics…</div>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Analytics</h1>

      {/* Streak cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Current streak", value: current, unit: "days" },
          { label: "Longest streak", value: longest, unit: "days" },
          { label: "Total entries", value: total, unit: "entries" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-lg border border-border/50 p-4 space-y-1"
          >
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className="text-3xl font-semibold tabular-nums">{stat.value}</p>
            <p className="text-xs text-muted-foreground">{stat.unit}</p>
          </div>
        ))}
      </div>

      {/* Heatmap */}
      <div>
        <p className="text-xs text-muted-foreground mb-3">
          Past year — {total} {total === 1 ? "entry" : "entries"}
        </p>
        <div className="overflow-x-auto">
          <div className="flex gap-px">
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-px">
                {week.map((day) => {
                  const hasEntry = dateMeta.has(day);
                  const isFuture = day > getDateStr(today);
                  return (
                    <div
                      key={day}
                      title={day}
                      className={`w-3 h-3 rounded-sm transition-colors ${
                        isFuture
                          ? "bg-transparent"
                          : hasEntry
                          ? "bg-primary"
                          : "bg-muted"
                      }`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
          <span>Less</span>
          <div className="w-3 h-3 rounded-sm bg-muted" />
          <div className="w-3 h-3 rounded-sm bg-primary" />
          <span>More</span>
        </div>
      </div>
    </div>
  );
}
