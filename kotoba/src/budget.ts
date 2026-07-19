/**
 * open-kyber kotoba — BUDGET vs ACTUAL (ADR-2606037200 D2). Stores per-account, per-period
 * budget figures as kotoba Datoms and reports variance against actuals rolled up off the
 * trial balance. Actuals use the same natural-presentation convention as the financial
 * statements (revenue/expense/etc. shown positive on their normal side).
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import { subMoney, sumMoney } from "./money.js";
import { getTrialBalance } from "./accounting.js";
import { ACCOUNT_COLLECTION, OPEN_KYBER_DID_PREFIX, type AccountRecord, type AccountType } from "./types.js";
import { slug } from "./_shared.js";

export const BUDGET_COLLECTION = "com.etzhayyim.apps.openKyber.budgetLine";

export interface BudgetLineRecord {
  did: string;
  account: string;
  period: string; // e.g. "2026-FY" or "2026-Q1"
  amount: string; // budgeted natural amount (decimal string)
  currency: string;
  createdAt: string;
}

const PAGE_LIMIT = 100;
const budgetRkey = (account: string, period: string) => `bud-${slug(period)}-${slug(account)}`;

function presentation(type: AccountType | undefined, net: string): string {
  const creditNormal = type === "liability" || type === "equity" || type === "revenue" || type === "contra-asset";
  return creditNormal ? subMoney("0", net) : net;
}

export async function setBudget(
  e: Etzhayyim,
  input: { account: string; period: string; amount: string; currency?: string },
): Promise<{ status: "set" | "rejected"; error?: string }> {
  if (!input.account || !input.period) return { status: "rejected", error: "missingRequiredFields" };
  if (!/^-?\d+(\.\d+)?$/.test(input.amount)) return { status: "rejected", error: "invalidAmount" };
  const record: BudgetLineRecord = {
    did: `${OPEN_KYBER_DID_PREFIX}budget:${slug(input.period)}:${slug(input.account)}`,
    account: input.account,
    period: input.period,
    amount: input.amount,
    currency: input.currency ?? "JPY",
    createdAt: new Date().toISOString(),
  };
  // upsert (re-budgeting overwrites the same account+period)
  await e.write({ collection: BUDGET_COLLECTION, record: record as unknown as Record<string, unknown>, rkey: budgetRkey(input.account, input.period) });
  return { status: "set" };
}

export async function listBudgets(e: Etzhayyim, input: { period?: string } = {}): Promise<BudgetLineRecord[]> {
  const out: BudgetLineRecord[] = [];
  let cursor: string | undefined;
  while (out.length < 100_000) {
    const page = await e.read<BudgetLineRecord>({ collection: BUDGET_COLLECTION, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) out.push(r.value);
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }
  return out.filter((b) => !input.period || b.period === input.period);
}

export interface BudgetVarianceRow {
  account: string;
  name: string;
  budget: string;
  actual: string;
  /** actual − budget (positive = over the budgeted figure). */
  variance: string;
}
export interface BudgetVarianceOutput {
  period: string;
  rows: BudgetVarianceRow[];
  totalBudget: string;
  totalActual: string;
  totalVariance: string;
}

export async function budgetVarianceReport(e: Etzhayyim, input: { period: string }): Promise<BudgetVarianceOutput> {
  const budgets = await listBudgets(e, { period: input.period });

  // account index for name + type
  const idx = new Map<string, { name: string; type: AccountType }>();
  let cursor: string | undefined;
  while (idx.size < 100_000) {
    const page = await e.read<AccountRecord>({ collection: ACCOUNT_COLLECTION, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) idx.set(r.value.accountCode, { name: r.value.name, type: r.value.accountType });
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }

  const tb = await getTrialBalance(e);
  const actualByAccount = new Map<string, string>();
  for (const row of tb.rows) actualByAccount.set(row.account, presentation(idx.get(row.account)?.type, row.net));

  const rows: BudgetVarianceRow[] = budgets.map((b) => {
    const actual = actualByAccount.get(b.account) ?? "0";
    return {
      account: b.account,
      name: idx.get(b.account)?.name ?? b.account,
      budget: b.amount,
      actual,
      variance: subMoney(actual, b.amount),
    };
  });

  const totalBudget = sumMoney(rows.map((r) => r.budget));
  const totalActual = sumMoney(rows.map((r) => r.actual));
  return { period: input.period, rows, totalBudget, totalActual, totalVariance: subMoney(totalActual, totalBudget) };
}
