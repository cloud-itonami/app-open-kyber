/**
 * open-kyber kotoba — period CLOSE (closing entries → retained earnings). ADR-2606037200 D2.
 *
 * Posts the closing journal entry that zeroes the temporary P&L accounts (revenue +
 * expense) and carries the period's net income to Retained Earnings:
 *
 *   Dr each Revenue account (its balance)     Cr each Expense account (its balance)
 *   + Cr Retained Earnings (net income)  — or Dr Retained Earnings on a net loss
 *
 * Balanced by construction (Σ revenue = Σ expense + net income). After the close the income
 * statement reads zero and equity carries the result — the substrate keeps the original
 * postings (非終末論); the close is just another asserted entry. Re-closing the same id is a
 * no-op (idempotent).
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import { createJournalEntry, type JournalLine } from "./accounting.js";
import { incomeStatement } from "./statements.js";
import { isZero, subMoney } from "./money.js";

export interface ClosePeriodInput {
  /** equity account that absorbs the result (default 3200 Retained Earnings). */
  retainedEarningsAccount?: string;
  /** closing entry id (default "period-close"); set per-period to close more than once. */
  entryId?: string;
  period?: string; // label, e.g. "2026-FY" — used in the memo
  date?: string;
}
export interface ClosePeriodOutput {
  status: "closed" | "alreadyClosed" | "nothingToClose" | "rejected";
  entryId?: string;
  netIncome?: string;
  error?: string;
}

export async function closePeriod(e: Etzhayyim, input: ClosePeriodInput = {}): Promise<ClosePeriodOutput> {
  const re = input.retainedEarningsAccount ?? "3200";
  const is = await incomeStatement(e);

  const lines: JournalLine[] = [];
  for (const r of is.revenue) {
    if (!isZero(r.amount)) lines.push({ account: r.account, debit: r.amount, credit: "0", memo: "close revenue" });
  }
  for (const x of is.expenses) {
    if (!isZero(x.amount)) lines.push({ account: x.account, debit: "0", credit: x.amount, memo: "close expense" });
  }
  if (lines.length === 0) return { status: "nothingToClose" };

  const ni = is.netIncome;
  if (!isZero(ni)) {
    if (ni.startsWith("-")) {
      // net loss → Dr Retained Earnings by the loss magnitude
      lines.push({ account: re, debit: subMoney("0", ni), credit: "0", memo: "net loss to retained earnings" });
    } else {
      // net profit → Cr Retained Earnings
      lines.push({ account: re, debit: "0", credit: ni, memo: "net income to retained earnings" });
    }
  }
  if (lines.length < 2) return { status: "nothingToClose" };

  const entryId = input.entryId ?? "period-close";
  const je = await createJournalEntry(e, {
    entryId,
    number: `CLOSE-${input.period ?? "period"}`,
    date: input.date,
    memo: `Period close${input.period ? ` ${input.period}` : ""}: net ${ni.startsWith("-") ? "loss" : "income"} ${ni} → ${re}`,
    lines,
  });
  if (je.status === "alreadyExists") return { status: "alreadyClosed", entryId, netIncome: ni };
  if (je.status === "rejected") return { status: "rejected", error: je.error };
  return { status: "closed", entryId, netIncome: ni };
}
