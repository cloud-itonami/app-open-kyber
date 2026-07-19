/**
 * open-kyber kotoba — financial STATEMENTS (Balance Sheet + Income Statement).
 * ADR-2606037200 D2. Generated from the chart-of-accounts (for account → type) and the
 * trial balance (for balances) — both rolled up off the kotoba Datom log. Read "as-of"
 * the current log head; a later date is a kqe time-travel query (Phase 2.5).
 *
 * Sign convention (decimal strings, exact): the trial balance gives each account a signed
 * `net = debit − credit`. Debit-normal accounts (asset, expense) carry a positive net;
 * credit-normal accounts (liability, equity, revenue, contra-asset) a negative one. The
 * statements present natural (positive) presentation amounts by flipping credit-normal
 * accounts, and assert the accounting identity Assets = Liabilities + Equity + Net Income.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import { eqMoney, subMoney, sumMoney } from "./money.js";
import { getTrialBalance } from "./accounting.js";
import { ACCOUNT_COLLECTION, type AccountRecord, type AccountType } from "./types.js";

const PAGE_LIMIT = 100;

export interface StatementLine {
  account: string;
  name: string;
  type: AccountType | "unclassified";
  /** natural presentation amount (positive for the normal side of the account). */
  amount: string;
}

export interface BalanceSheetOutput {
  assets: StatementLine[];
  liabilities: StatementLine[];
  equity: StatementLine[];
  totalAssets: string;
  totalLiabilities: string;
  totalEquity: string;
  netIncome: string;
  /** Assets === Liabilities + Equity + Net Income (retained for the period). */
  balanced: boolean;
}

export interface IncomeStatementOutput {
  revenue: StatementLine[];
  expenses: StatementLine[];
  totalRevenue: string;
  totalExpense: string;
  netIncome: string;
}

async function accountIndex(e: Etzhayyim): Promise<Map<string, { name: string; type: AccountType }>> {
  const idx = new Map<string, { name: string; type: AccountType }>();
  let cursor: string | undefined;
  while (idx.size < 100_000) {
    const page = await e.read<AccountRecord>({ collection: ACCOUNT_COLLECTION, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) idx.set(r.value.accountCode, { name: r.value.name, type: r.value.accountType });
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }
  return idx;
}

/** natural presentation amount: debit-normal → net; credit-normal → −net. */
function presentation(type: AccountType | "unclassified", net: string): string {
  const creditNormal = type === "liability" || type === "equity" || type === "revenue" || type === "contra-asset";
  return creditNormal ? subMoney("0", net) : net;
}

export async function incomeStatement(e: Etzhayyim): Promise<IncomeStatementOutput> {
  const idx = await accountIndex(e);
  const tb = await getTrialBalance(e);
  const revenue: StatementLine[] = [];
  const expenses: StatementLine[] = [];
  for (const row of tb.rows) {
    const meta = idx.get(row.account);
    const type = meta?.type ?? "unclassified";
    if (type === "revenue") revenue.push({ account: row.account, name: meta!.name, type, amount: presentation(type, row.net) });
    else if (type === "expense") expenses.push({ account: row.account, name: meta!.name, type, amount: presentation(type, row.net) });
  }
  const totalRevenue = sumMoney(revenue.map((r) => r.amount));
  const totalExpense = sumMoney(expenses.map((r) => r.amount));
  return { revenue, expenses, totalRevenue, totalExpense, netIncome: subMoney(totalRevenue, totalExpense) };
}

export async function balanceSheet(e: Etzhayyim): Promise<BalanceSheetOutput> {
  const idx = await accountIndex(e);
  const tb = await getTrialBalance(e);
  const assets: StatementLine[] = [];
  const liabilities: StatementLine[] = [];
  const equity: StatementLine[] = [];
  let revenueTotal = "0";
  let expenseTotal = "0";
  for (const row of tb.rows) {
    const meta = idx.get(row.account);
    const type = meta?.type ?? "unclassified";
    const name = meta?.name ?? row.account;
    const amt = presentation(type, row.net);
    if (type === "asset" || type === "contra-asset") assets.push({ account: row.account, name, type, amount: amt });
    else if (type === "liability") liabilities.push({ account: row.account, name, type, amount: amt });
    else if (type === "equity") equity.push({ account: row.account, name, type, amount: amt });
    else if (type === "revenue") revenueTotal = sumMoney([revenueTotal, amt]);
    else if (type === "expense") expenseTotal = sumMoney([expenseTotal, amt]);
  }
  const totalAssets = sumMoney(assets.map((r) => r.amount));
  const totalLiabilities = sumMoney(liabilities.map((r) => r.amount));
  const totalEquity = sumMoney(equity.map((r) => r.amount));
  const netIncome = subMoney(revenueTotal, expenseTotal);
  // Assets = Liabilities + Equity + Net Income (period earnings not yet closed to equity)
  const rhs = sumMoney([totalLiabilities, totalEquity, netIncome]);
  return {
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabilities,
    totalEquity,
    netIncome,
    balanced: eqMoney(totalAssets, rhs),
  };
}
