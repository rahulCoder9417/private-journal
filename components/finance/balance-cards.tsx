"use client";

import { formatMoney, formatMoneyShort, type MonthSummary } from "@/lib/finance";

export function BalanceCards({
  balances,
  summary,
  monthName,
}: {
  balances: { bank: number; cash: number; total: number };
  summary: MonthSummary;
  monthName: string;
}) {
  const outflow = summary.spent + summary.invested;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Tile label="Bank" value={balances.bank} />
      <Tile label="Cash" value={balances.cash} />
      <Tile label="Total" value={balances.total} accent>
        <span className="text-emerald-400">+{formatMoneyShort(summary.earned)}</span>
        <span className="text-zinc-700">·</span>
        <span className="text-red-400">−{formatMoneyShort(outflow)}</span>
        <span className="text-zinc-600">in {monthName}</span>
      </Tile>
    </div>
  );
}

function Tile({
  label,
  value,
  accent,
  children,
}: {
  label: string;
  value: number;
  accent?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 ${
        accent ? "border-l-2 border-l-indigo-500/70" : ""
      }`}
    >
      <p className="text-xs text-zinc-500 uppercase tracking-wider">{label}</p>
      <p
        className={`text-2xl font-semibold mt-1 ${
          value < 0 ? "text-red-400" : "text-zinc-100"
        }`}
      >
        {formatMoney(value)}
      </p>
      {children && (
        <div className="flex items-center gap-1.5 mt-1.5 text-[11px] flex-wrap">{children}</div>
      )}
    </div>
  );
}
