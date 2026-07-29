"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  ACCOUNTS,
  CATEGORIES,
  CURRENCY_SYMBOL,
  TX_TYPES,
  parseAmount,
  toYMD,
  type AccountId,
  type FinanceTx,
  type TxType,
} from "@/lib/finance";

// Inline, not a dialog: this is the surface you touch several times a day, and a
// modal costs an extra click on every entry.
export function TransactionForm({ onAdd }: { onAdd: (tx: FinanceTx) => void }) {
  const [type, setType] = useState<TxType>("expense");
  const [amount, setAmount] = useState("");
  const [account, setAccount] = useState<AccountId>("bank");
  const [toAccount, setToAccount] = useState<AccountId>("cash");
  const [category, setCategory] = useState(CATEGORIES.expense[0].id);
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(toYMD(new Date()));
  const [error, setError] = useState("");

  const isTransfer = type === "transfer";

  const changeType = (next: TxType) => {
    setType(next);
    setCategory(CATEGORIES[next][0]?.id ?? "");
    setError("");
  };

  const changeAccount = (next: AccountId) => {
    setAccount(next);
    if (isTransfer && next === toAccount) {
      setToAccount(next === "bank" ? "cash" : "bank");
    }
  };

  const submit = () => {
    const amountPaise = parseAmount(amount);
    if (amountPaise === null) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (!isTransfer && !category) {
      setError("Pick a category.");
      return;
    }
    const now = Date.now();
    onAdd({
      id: crypto.randomUUID(),
      date,
      type,
      account,
      toAccount: isTransfer ? toAccount : undefined,
      amountPaise,
      category: isTransfer ? "" : category,
      description: description.trim(),
      createdAt: now,
      updatedAt: now,
    });
    setAmount("");
    setDescription("");
    setError("");
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
      {/* Type */}
      <div className="flex flex-wrap gap-1">
        {TX_TYPES.map((t) => (
          <button
            key={t.id}
            onClick={() => changeType(t.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              type === t.id
                ? "bg-indigo-600 text-white"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Amount + accounts */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500">
            {CURRENCY_SYMBOL}
          </span>
          <Input
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            className="w-36 pl-7 bg-zinc-900 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 tabular-nums"
          />
        </div>

        <AccountToggle
          label={isTransfer ? "From" : undefined}
          value={account}
          onChange={changeAccount}
        />
        {isTransfer && (
          <>
            <span className="text-zinc-600 text-sm">→</span>
            <AccountToggle
              label="To"
              value={toAccount}
              onChange={(v) => {
                setToAccount(v);
                if (v === account) setAccount(v === "bank" ? "cash" : "bank");
              }}
            />
          </>
        )}
      </div>

      {/* Category */}
      {!isTransfer && (
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES[type].map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={`px-2.5 py-1 rounded-full text-xs transition-colors border ${
                category === c.id
                  ? "bg-indigo-600 border-indigo-500 text-white"
                  : "border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {/* Description + date + submit */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder={isTransfer ? "Note (e.g. ATM withdrawal)" : "Why? e.g. groceries for the week"}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="flex-1 min-w-48 bg-zinc-900 border-zinc-700 text-zinc-100 placeholder:text-zinc-600"
        />
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-40 bg-zinc-900 border-zinc-700 text-zinc-200"
        />
        <Button onClick={submit} className="bg-indigo-600 hover:bg-indigo-500 text-white">
          Add
        </Button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}

function AccountToggle({
  label,
  value,
  onChange,
}: {
  label?: string;
  value: AccountId;
  onChange: (v: AccountId) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {label && <span className="text-[11px] text-zinc-600 uppercase tracking-wider">{label}</span>}
      <div className="flex rounded-lg border border-zinc-700 overflow-hidden">
        {ACCOUNTS.map((a) => (
          <button
            key={a.id}
            onClick={() => onChange(a.id)}
            className={`px-3 py-1.5 text-xs transition-colors ${
              value === a.id
                ? "bg-zinc-700 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
