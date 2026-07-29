"use client";

import { formatMoney, type MonthSummary } from "@/lib/finance";

// One hue, stepped by rank — the job here is comparing magnitudes, not telling
// categories apart, so a categorical rainbow would encode nothing. The bar carries
// the meaning; the labels stay zinc.
const STEPS = [
  "bg-indigo-500",
  "bg-indigo-500/90",
  "bg-indigo-500/80",
  "bg-indigo-500/70",
  "bg-indigo-500/60",
  "bg-indigo-500/50",
  "bg-indigo-500/40",
];

const MAX_ROWS = 7;

export function CategoryBreakdown({ summary }: { summary: MonthSummary }) {
  if (summary.spent === 0) return null;

  const head = summary.byCategory.slice(0, MAX_ROWS);
  const tail = summary.byCategory.slice(MAX_ROWS);
  const rows = head.map((c, i) => ({ ...c, color: STEPS[i] }));
  if (tail.length) {
    const total = tail.reduce((sum, c) => sum + c.total, 0);
    rows.push({
      id: "__rest",
      label: `Other (${tail.length})`,
      total,
      pct: (total / summary.spent) * 100,
      color: "bg-zinc-600",
    });
  }

  const max = rows[0]?.total ?? 1;

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-zinc-200">Where it went</h2>
        <p className="text-xs text-zinc-600 mt-0.5">Expenses only — income and investments are counted above.</p>
      </div>
      <div className="space-y-0.5">
        {rows.map((row) => (
          <div key={row.id} className="space-y-1 py-1">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="text-zinc-300 truncate">{row.label}</span>
              <span className="text-zinc-500 tabular-nums flex-shrink-0">
                {formatMoney(row.total)}{" "}
                <span className="text-zinc-600">({Math.round(row.pct)}%)</span>
              </span>
            </div>
            <div className="h-1.5 rounded-md bg-zinc-800 overflow-hidden">
              <div
                className={`h-full rounded-md ${row.color}`}
                style={{ width: `${Math.max((row.total / max) * 100, 2)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
