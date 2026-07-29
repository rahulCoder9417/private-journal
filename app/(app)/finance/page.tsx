"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  getAllTx,
  getDirtyMonths,
  getSettings,
  putTx,
  saveSettings,
  softDeleteTx,
} from "@/hooks/use-finance-db";
import { pushSettings, refreshFromCloud, syncDirty } from "@/lib/finance-sync";
import {
  DEFAULT_SETTINGS,
  computeBalances,
  monthLabel,
  monthOf,
  shiftMonth,
  summarizeMonth,
  toYMD,
  type FinanceSettings,
  type FinanceTx,
} from "@/lib/finance";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { BalanceCards } from "@/components/finance/balance-cards";
import { TransactionForm } from "@/components/finance/transaction-form";
import { TransactionList } from "@/components/finance/transaction-list";
import { CategoryBreakdown } from "@/components/finance/category-breakdown";
import { SetBalanceDialog } from "@/components/finance/set-balance-dialog";

export default function FinancePage() {
  const currentMonth = monthOf(toYMD(new Date()));

  const [txs, setTxs] = useState<FinanceTx[]>([]);
  const [settings, setSettings] = useState<FinanceSettings>(DEFAULT_SETTINGS);
  const [month, setMonth] = useState(currentMonth);
  const [dirtyMonths, setDirtyMonths] = useState<string[]>([]);
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const reload = useCallback(async () => {
    const [allTx, s, dirty] = await Promise.all([
      getAllTx(),
      getSettings(),
      getDirtyMonths(),
    ]);
    setTxs(allTx);
    setSettings(s);
    setDirtyMonths(dirty);
  }, []);

  // Offline-first: render whatever IndexedDB has, then merge the cloud in behind it.
  // Merging is non-destructive (LWW per transaction), so it needs no confirmation.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await reload();
      try {
        const pulled = await refreshFromCloud();
        if (!cancelled && pulled.length) await reload();
      } catch {
        /* offline, or the vault isn't reachable — local data still works */
      }
    })();
    return () => { cancelled = true; };
  }, [reload]);

  const handleAdd = async (tx: FinanceTx) => {
    await putTx(tx);
    await reload();
    if (monthOf(tx.date) !== month) setMonth(monthOf(tx.date));
  };

  const handleDelete = async (id: string) => {
    await softDeleteTx(id);
    await reload();
  };

  const handleSaveBalance = async (next: FinanceSettings) => {
    await saveSettings(next);
    setSettings(next);
    setBalanceOpen(false);
    try {
      await pushSettings();
    } catch {
      /* pushed on the next sync instead */
    }
    await reload();
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const pushed = await syncDirty();
      await refreshFromCloud();
      await reload();
      toast.success(
        pushed.length
          ? `Synced ${pushed.length} ${pushed.length === 1 ? "month" : "months"}`
          : "Everything is already up to date"
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const balances = computeBalances(txs, settings);
  const summary = summarizeMonth(txs, month);
  const monthTxs = txs.filter((t) => monthOf(t.date) === month);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-medium text-indigo-400 uppercase tracking-widest mb-0.5">Money</p>
          <h1 className="text-2xl font-bold text-zinc-100">Finance</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Encrypted end-to-end — the server only ever sees ciphertext.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {dirtyMonths.length > 0 && (
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-amber-300 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              {syncing
                ? "Syncing…"
                : `Sync ${dirtyMonths.length} ${dirtyMonths.length === 1 ? "month" : "months"}`}
            </button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setBalanceOpen(true)}
            className="text-zinc-400 hover:text-zinc-100 text-xs"
          >
            Set balance
          </Button>
        </div>
      </div>

      <BalanceCards
        balances={balances}
        summary={summary}
        monthName={monthLabel(month).split(" ")[0]}
      />

      <TransactionForm onAdd={handleAdd} />

      <Separator className="bg-zinc-800" />

      <TransactionList
        month={month}
        txs={monthTxs}
        summary={summary}
        onPrev={() => setMonth(shiftMonth(month, -1))}
        onNext={() => setMonth(shiftMonth(month, 1))}
        canGoNext={month < currentMonth}
        onDelete={handleDelete}
      />

      {summary.spent > 0 && (
        <>
          <Separator className="bg-zinc-800" />
          <CategoryBreakdown summary={summary} />
        </>
      )}

      <SetBalanceDialog
        open={balanceOpen}
        settings={settings}
        onClose={() => setBalanceOpen(false)}
        onSave={handleSaveBalance}
      />
    </div>
  );
}
