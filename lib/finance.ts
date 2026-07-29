// Finance model + pure logic. No I/O here — see hooks/use-finance-db.ts (local)
// and lib/finance-sync.ts (cloud).

export const CURRENCY_LOCALE = "en-IN";
export const CURRENCY_CODE = "INR";
export const CURRENCY_SYMBOL = "₹";

export type AccountId = "bank" | "cash";
export type TxType = "expense" | "income" | "investment" | "transfer";

export interface FinanceTx {
  id: string;
  date: string; // YYYY-MM-DD, local time
  type: TxType;
  account: AccountId; // for a transfer this is the SOURCE account
  toAccount?: AccountId; // transfers only
  amountPaise: number; // integer, always positive
  category: string; // id from CATEGORIES[type]; "" for transfers
  description: string; // the "why"
  createdAt: number;
  updatedAt: number;
  deleted?: boolean; // tombstone — kept so deletes propagate through the blob
}

export interface FinanceSettings {
  openingBank: number; // paise
  openingCash: number; // paise
  openingDate: string; // YYYY-MM-DD; transactions before this don't count toward balance
  updatedAt: number;
  syncedAt?: number;
}

export const DEFAULT_SETTINGS: FinanceSettings = {
  openingBank: 0,
  openingCash: 0,
  openingDate: "1970-01-01",
  updatedAt: 0,
};

export const ACCOUNTS: { id: AccountId; label: string }[] = [
  { id: "bank", label: "Bank" },
  { id: "cash", label: "Cash" },
];

export const TX_TYPES: { id: TxType; label: string }[] = [
  { id: "expense", label: "Expense" },
  { id: "income", label: "Income" },
  { id: "investment", label: "Investment" },
  { id: "transfer", label: "Transfer" },
];

export const CATEGORIES: Record<TxType, { id: string; label: string }[]> = {
  expense: [
    { id: "food_need", label: "Food · essential" },
    { id: "food_want", label: "Food · eating out" },
    { id: "protein", label: "Protein" },
    { id: "fun", label: "Fun" },
    { id: "gift", label: "Gift given" },
    { id: "purchase", label: "Bought something" },
    { id: "bills", label: "Bills & rent" },
    { id: "travel", label: "Travel" },
    { id: "other", label: "Other" },
  ],
  income: [
    { id: "salary", label: "Salary" },
    { id: "freelance", label: "Gig / freelance" },
    { id: "gift", label: "Gift received" },
    { id: "refund", label: "Refund" },
    { id: "other", label: "Other" },
  ],
  investment: [
    { id: "sip", label: "SIP / mutual fund" },
    { id: "stocks", label: "Stocks" },
    { id: "gold", label: "Gold" },
    { id: "fd", label: "FD / RD" },
    { id: "crypto", label: "Crypto" },
    { id: "other", label: "Other" },
  ],
  transfer: [],
};

export function categoryLabel(type: TxType, id: string): string {
  return CATEGORIES[type]?.find((c) => c.id === id)?.label ?? id;
}

// ─── money ───────────────────────────────────────────────────────────────────
// Amounts are integer paise everywhere. Summing hundreds of float rupee values
// drifts into ₹12,345.670000000002; one parse at input and one format at output
// keeps that out of the model entirely.

const money = new Intl.NumberFormat(CURRENCY_LOCALE, {
  style: "currency",
  currency: CURRENCY_CODE,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(paise: number): string {
  return money.format(paise / 100);
}

/** Compact form for tight spots — no decimals when the amount is whole rupees. */
export function formatMoneyShort(paise: number): string {
  const rupees = paise / 100;
  return `${CURRENCY_SYMBOL}${new Intl.NumberFormat(CURRENCY_LOCALE, {
    minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(rupees)}`;
}

/** "249.50" → 24950. Returns null for anything that isn't a positive amount. */
export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[,\s₹]/g, "").trim();
  if (!cleaned) return null;
  if (!/^\d*\.?\d*$/.test(cleaned)) return null;
  const rupees = Number(cleaned);
  if (!Number.isFinite(rupees) || rupees <= 0) return null;
  return Math.round(rupees * 100);
}

// ─── dates ───────────────────────────────────────────────────────────────────

export function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// ─── derived numbers ─────────────────────────────────────────────────────────

export function isLive(tx: FinanceTx, settings: FinanceSettings): boolean {
  return !tx.deleted && tx.date >= settings.openingDate;
}

/**
 * balance(account) = opening + income − expense − investment ∓ transfers,
 * counting only live transactions on or after the opening date.
 */
export function computeBalances(
  txs: FinanceTx[],
  settings: FinanceSettings
): { bank: number; cash: number; total: number } {
  let bank = settings.openingBank;
  let cash = settings.openingCash;

  for (const tx of txs) {
    if (!isLive(tx, settings)) continue;
    const delta =
      tx.type === "income" ? tx.amountPaise : -tx.amountPaise;

    if (tx.type === "transfer") {
      if (!tx.toAccount || tx.toAccount === tx.account) continue;
      if (tx.account === "bank") { bank -= tx.amountPaise; cash += tx.amountPaise; }
      else { cash -= tx.amountPaise; bank += tx.amountPaise; }
      continue;
    }

    if (tx.account === "bank") bank += delta;
    else cash += delta;
  }

  return { bank, cash, total: bank + cash };
}

export interface MonthSummary {
  spent: number;
  earned: number;
  invested: number;
  net: number;
  byCategory: { id: string; label: string; total: number; pct: number }[];
}

/** Expense breakdown + the three headline totals for one month. */
export function summarizeMonth(txs: FinanceTx[], month: string): MonthSummary {
  let spent = 0;
  let earned = 0;
  let invested = 0;
  const byCat = new Map<string, number>();

  for (const tx of txs) {
    if (tx.deleted || monthOf(tx.date) !== month) continue;
    if (tx.type === "expense") {
      spent += tx.amountPaise;
      byCat.set(tx.category, (byCat.get(tx.category) ?? 0) + tx.amountPaise);
    } else if (tx.type === "income") {
      earned += tx.amountPaise;
    } else if (tx.type === "investment") {
      invested += tx.amountPaise;
    }
  }

  const byCategory = [...byCat.entries()]
    .map(([id, total]) => ({
      id,
      label: categoryLabel("expense", id),
      total,
      pct: spent > 0 ? (total / spent) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);

  return { spent, earned, invested, net: earned - spent - invested, byCategory };
}
