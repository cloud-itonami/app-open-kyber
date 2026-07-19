/**
 * open-kyber kotoba — CASH-FLOW statement (ADR-2606037200 D2). The third financial
 * statement, completing BS + PL + CF. Direct method off the kotoba Datom log: scan the
 * journal entries, take every line that moves a cash account, and classify the OFFSETTING
 * leg into operating / investing / financing. Net change in cash equals the cash account's
 * trial-balance movement (an internal consistency check the output asserts).
 *
 *   inflow  to cash = an offsetting CREDIT (e.g. Cr AR when collecting a receivable)
 *   outflow of cash = an offsetting DEBIT  (e.g. Dr PPE when buying equipment)
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import { eqMoney, subMoney, sumMoney } from "./money.js";
import { JOURNAL_ENTRY_COLLECTION, type JournalEntryRecord } from "./accounting.js";
import { ACCOUNT_COLLECTION, type AccountRecord, type AccountType } from "./types.js";

const PAGE_LIMIT = 100;

export type CashFlowCategory = "operating" | "investing" | "financing";

/** Classify an offsetting account into a cash-flow category (IFRS-aligned heuristic). */
export function cashFlowCategory(code: string, type: AccountType | undefined): CashFlowCategory {
  if (type === "revenue" || type === "expense") return "operating";
  // financing: debt + equity
  if (["2300", "2700", "3000", "3200", "3300"].includes(code)) return "financing";
  // investing: PP&E, intangibles
  if (["1500", "1510", "1600"].includes(code)) return "investing";
  // everything else (AR, AP, inventory, prepaid, tax, accruals, unearned) = operating working capital
  return "operating";
}

export interface CashFlowLine {
  account: string;
  name: string;
  category: CashFlowCategory;
  /** signed cash effect: positive = cash in, negative = cash out. */
  amount: string;
}
export interface CashFlowStatementOutput {
  operating: CashFlowLine[];
  investing: CashFlowLine[];
  financing: CashFlowLine[];
  totalOperating: string;
  totalInvesting: string;
  totalFinancing: string;
  netChangeInCash: string;
  /** netChangeInCash === Σ(category totals) AND === cash accounts' ledger movement. */
  consistent: boolean;
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

async function allEntries(e: Etzhayyim): Promise<JournalEntryRecord[]> {
  const out: JournalEntryRecord[] = [];
  let cursor: string | undefined;
  while (out.length < 100_000) {
    const page = await e.read<JournalEntryRecord>({ collection: JOURNAL_ENTRY_COLLECTION, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) out.push(r.value);
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }
  return out;
}

export async function cashFlowStatement(
  e: Etzhayyim,
  input: { cashAccounts?: string[] } = {},
): Promise<CashFlowStatementOutput> {
  const cashSet = new Set(input.cashAccounts ?? ["1000"]);
  const idx = await accountIndex(e);
  const entries = await allEntries(e);

  const byAccount = new Map<string, { category: CashFlowCategory; amount: string }>();
  let cashMovement = "0"; // ledger movement of the cash accounts (debit − credit)

  for (const je of entries) {
    if (je.status === "draft") continue;
    const touchesCash = je.lines.some((l) => cashSet.has(l.account));
    if (!touchesCash) continue;
    for (const l of je.lines) {
      if (cashSet.has(l.account)) {
        cashMovement = sumMoney([cashMovement, subMoney(l.debit, l.credit)]);
        continue;
      }
      // offsetting leg: cash effect = credit − debit (a credit here is cash IN)
      const effect = subMoney(l.credit, l.debit);
      const cat = cashFlowCategory(l.account, idx.get(l.account)?.type);
      const prev = byAccount.get(l.account);
      byAccount.set(l.account, { category: cat, amount: prev ? sumMoney([prev.amount, effect]) : effect });
    }
  }

  const lines: CashFlowLine[] = [...byAccount.entries()].map(([account, v]) => ({
    account,
    name: idx.get(account)?.name ?? account,
    category: v.category,
    amount: v.amount,
  }));
  const operating = lines.filter((l) => l.category === "operating");
  const investing = lines.filter((l) => l.category === "investing");
  const financing = lines.filter((l) => l.category === "financing");
  const totalOperating = sumMoney(operating.map((l) => l.amount));
  const totalInvesting = sumMoney(investing.map((l) => l.amount));
  const totalFinancing = sumMoney(financing.map((l) => l.amount));
  const netChangeInCash = sumMoney([totalOperating, totalInvesting, totalFinancing]);

  return {
    operating,
    investing,
    financing,
    totalOperating,
    totalInvesting,
    totalFinancing,
    netChangeInCash,
    consistent: eqMoney(netChangeInCash, cashMovement),
  };
}
