"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  CURRENCY_SYMBOL,
  parseAmount,
  toYMD,
  type FinanceSettings,
} from "@/lib/finance";

export function SetBalanceDialog({
  open,
  settings,
  onClose,
  onSave,
}: {
  open: boolean;
  settings: FinanceSettings;
  onClose: () => void;
  onSave: (next: FinanceSettings) => void;
}) {
  const [bank, setBank] = useState("");
  const [cash, setCash] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setBank((settings.openingBank / 100).toString());
    setCash((settings.openingCash / 100).toString());
    setError("");
  }, [open, settings.openingBank, settings.openingCash]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const bankPaise = bank.trim() === "0" ? 0 : parseAmount(bank);
    const cashPaise = cash.trim() === "0" ? 0 : parseAmount(cash);
    if (bankPaise === null || cashPaise === null) {
      setError("Enter both balances as numbers (0 is fine).");
      return;
    }
    onSave({
      openingBank: bankPaise,
      openingCash: cashPaise,
      openingDate: toYMD(new Date()),
      updatedAt: Date.now(),
      syncedAt: settings.syncedAt,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm border-zinc-800 bg-zinc-950">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">Set balance</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-zinc-400">
            This becomes your starting point as of today. Transactions dated before today
            stop counting toward the balance — so use it to correct drift, not to log money.
          </p>

          <Field label="Bank" value={bank} onChange={setBank} />
          <Field label="Cash" value={cash} onChange={setCash} />

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="ghost" className="text-zinc-400" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="bg-indigo-600 hover:bg-indigo-500 text-white">
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
        {label}
      </label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500">
          {CURRENCY_SYMBOL}
        </span>
        <Input
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pl-7 bg-zinc-900 border-zinc-700 text-zinc-100 tabular-nums"
        />
      </div>
    </div>
  );
}
