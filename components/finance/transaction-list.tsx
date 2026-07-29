"use client";

import {
  categoryLabel,
  dayLabel,
  formatMoney,
  formatMoneyShort,
  monthLabel,
  type FinanceTx,
  type MonthSummary,
} from "@/lib/finance";

const DOT: Record<FinanceTx["type"], string> = {
  expense: "bg-red-500/70",
  income: "bg-emerald-500/70",
  investment: "bg-indigo-500/70",
  transfer: "bg-zinc-500/70",
};

const AMOUNT: Record<FinanceTx["type"], string> = {
  expense: "text-red-400",
  income: "text-emerald-400",
  investment: "text-indigo-400",
  transfer: "text-zinc-400",
};

function sign(type: FinanceTx["type"]): string {
  if (type === "income") return "+";
  if (type === "transfer") return "";
  return "−";
}

export function TransactionList({
  month,
  txs,
  summary,
  onPrev,
  onNext,
  canGoNext,
  onDelete,
}: {
  month: string;
  txs: FinanceTx[];
  summary: MonthSummary;
  onPrev: () => void;
  onNext: () => void;
  canGoNext: boolean;
  onDelete: (id: string) => void;
}) {
  const byDay = new Map<string, FinanceTx[]>();
  for (const tx of [...txs].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)) {
    const list = byDay.get(tx.date) ?? [];
    list.push(tx);
    byDay.set(tx.date, list);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          <button
            onClick={onPrev}
            className="px-2 py-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors text-sm"
          >
            ‹
          </button>
          <h2 className="text-sm font-semibold text-zinc-200 min-w-36 text-center">
            {monthLabel(month)}
          </h2>
          <button
            onClick={onNext}
            disabled={!canGoNext}
            className="px-2 py-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors text-sm disabled:opacity-25 disabled:hover:bg-transparent"
          >
            ›
          </button>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-zinc-500">
            Spent <span className="text-red-400 tabular-nums">{formatMoneyShort(summary.spent)}</span>
          </span>
          <span className="text-zinc-500">
            Earned <span className="text-emerald-400 tabular-nums">{formatMoneyShort(summary.earned)}</span>
          </span>
          <span className="text-zinc-500">
            Invested <span className="text-indigo-400 tabular-nums">{formatMoneyShort(summary.invested)}</span>
          </span>
          <span className="text-zinc-500">
            Net{" "}
            <span className={`tabular-nums ${summary.net < 0 ? "text-red-400" : "text-emerald-400"}`}>
              {summary.net < 0 ? "−" : "+"}
              {formatMoneyShort(Math.abs(summary.net))}
            </span>
          </span>
        </div>
      </div>

      {byDay.size === 0 ? (
        <p className="text-sm text-zinc-600 italic">Nothing logged this month yet.</p>
      ) : (
        <div className="space-y-4">
          {[...byDay.entries()].map(([date, dayTxs]) => (
            <div key={date} className="space-y-1.5">
              <p className="text-xs text-zinc-500 uppercase tracking-wider">{dayLabel(date)}</p>
              <div className="space-y-1">
                {dayTxs.map((tx) => (
                  <div
                    key={tx.id}
                    className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-zinc-900/60 transition-colors"
                  >
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${DOT[tx.type]}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-200 truncate">
                        {tx.description ||
                          (tx.type === "transfer"
                            ? `${tx.account} → ${tx.toAccount}`
                            : categoryLabel(tx.type, tx.category))}
                      </p>
                      <p className="text-[11px] text-zinc-600">
                        {tx.type === "transfer"
                          ? `Transfer · ${tx.account} → ${tx.toAccount}`
                          : categoryLabel(tx.type, tx.category)}
                      </p>
                    </div>
                    <span className="text-[10px] text-zinc-500 border border-zinc-800 rounded-full px-2 py-0.5 flex-shrink-0 capitalize">
                      {tx.type === "transfer" ? `${tx.account}→${tx.toAccount}` : tx.account}
                    </span>
                    <span className={`text-sm tabular-nums flex-shrink-0 ${AMOUNT[tx.type]}`}>
                      {sign(tx.type)}
                      {formatMoney(tx.amountPaise)}
                    </span>
                    <button
                      onClick={() => onDelete(tx.id)}
                      className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 text-xs transition-opacity flex-shrink-0"
                      aria-label="Delete transaction"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
