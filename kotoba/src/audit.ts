/**
 * open-kyber kotoba — LEDGER INTEGRITY audit (ADR-2606037200 D2). A read-only consistency
 * sweep over the kotoba Datom log that asserts the ERP's accounting invariants hold:
 *
 *   1. every non-draft journal entry balances (Σ debit = Σ credit)
 *   2. every journal line references an account that exists in the chart of accounts
 *   3. the trial balance balances
 *   4. no invoice is over-applied (paidAmount ≤ amount)
 *   5. every reversed entry has a contra entry that points back to it
 *
 * Non-mutating + non-adjudicating: it reports discrepancies, it does not fix or judge them
 * (the toritate/danjo audit ethos). Returns a structured pass/fail per check.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import { eqMoney, subMoney, sumMoney } from "./money.js";
import { JOURNAL_ENTRY_COLLECTION, getTrialBalance, type JournalEntryRecord } from "./accounting.js";
import { listAccounts } from "./registry.js";
import { listInvoices, type InvoiceRecord } from "./erp-modules.js";

const PAGE_LIMIT = 100;

export interface AuditCheck {
  name: string;
  passed: boolean;
  issues: string[];
}
export interface LedgerAuditOutput {
  ok: boolean;
  checks: AuditCheck[];
  issueCount: number;
}

async function allEntries(e: Etzhayyim): Promise<JournalEntryRecord[]> {
  const out: JournalEntryRecord[] = [];
  let cursor: string | undefined;
  while (out.length < 1_000_000) {
    const page = await e.read<JournalEntryRecord>({ collection: JOURNAL_ENTRY_COLLECTION, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) out.push(r.value);
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }
  return out;
}

export async function ledgerAudit(e: Etzhayyim): Promise<LedgerAuditOutput> {
  const entries = await allEntries(e);
  const accounts = await listAccounts(e, { limit: 100_000 });
  const accountCodes = new Set(accounts.items.map((a) => a.accountCode));
  const invoices = await listInvoices(e, { limit: 100_000 });
  const byId = new Map(entries.map((j) => [j.entryId, j]));

  const checks: AuditCheck[] = [];

  // 1. balanced entries
  const balanceIssues: string[] = [];
  for (const je of entries) {
    if (je.status === "draft") continue;
    const d = sumMoney(je.lines.map((l) => l.debit));
    const c = sumMoney(je.lines.map((l) => l.credit));
    if (!eqMoney(d, c)) balanceIssues.push(`${je.entryId}: debit ${d} ≠ credit ${c}`);
  }
  checks.push({ name: "entries-balance", passed: balanceIssues.length === 0, issues: balanceIssues });

  // 2. no orphan account refs (only when a chart of accounts exists)
  const orphanIssues: string[] = [];
  if (accountCodes.size > 0) {
    for (const je of entries) {
      for (const l of je.lines) {
        if (!accountCodes.has(l.account)) orphanIssues.push(`${je.entryId}: line account ${l.account} not in CoA`);
      }
    }
  }
  checks.push({ name: "no-orphan-account-refs", passed: orphanIssues.length === 0, issues: orphanIssues });

  // 3. trial balance balances
  const tb = await getTrialBalance(e);
  checks.push({
    name: "trial-balance-balances",
    passed: tb.balanced,
    issues: tb.balanced ? [] : [`total debit ${tb.totalDebit} ≠ total credit ${tb.totalCredit}`],
  });

  // 4. no over-applied invoices
  const overIssues: string[] = [];
  for (const r of invoices.items) {
    const inv = r as InvoiceRecord & { paidAmount?: string };
    const paid = inv.paidAmount ?? "0";
    if (subMoney(inv.amount, paid).startsWith("-")) overIssues.push(`${inv.number}: paid ${paid} > amount ${inv.amount}`);
  }
  checks.push({ name: "no-over-applied-invoices", passed: overIssues.length === 0, issues: overIssues });

  // 5. reversed entries have a back-pointing contra entry
  const reversalIssues: string[] = [];
  for (const je of entries) {
    if (je.status !== "reversed") continue;
    const rev = je.reversedBy ? byId.get(je.reversedBy) : undefined;
    if (!rev) reversalIssues.push(`${je.entryId}: marked reversed but no reversal entry`);
    else if (rev.reverses !== je.entryId) reversalIssues.push(`${je.entryId}: reversal ${rev.entryId} does not point back`);
  }
  checks.push({ name: "reversal-integrity", passed: reversalIssues.length === 0, issues: reversalIssues });

  const issueCount = checks.reduce((n, c) => n + c.issues.length, 0);
  return { ok: issueCount === 0, checks, issueCount };
}
