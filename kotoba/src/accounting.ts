/**
 * open-kyber kotoba — ACCOUNTING module (kotoba-Datomic, ADR-2606037200 D1+D2).
 *
 * Double-entry General Ledger on the kotoba Datom log (plaintext collection — ledger
 * postings are not PII). Realizes Datomic-accounting / 非終末論 (ADR-2605192100 §1.15):
 * a journal entry is an immutable balanced fact; a CORRECTION is a NEW reversing entry
 * that asserts a contra posting, never an in-place edit or delete. The books are read
 * by rolling up all entries — the substrate IS the audit log.
 *
 * Money as exact decimal STRINGS (money.ts BigInt fixed-point), no float.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import { eqMoney, isMoney, isZero, subMoney, sumMoney } from "./money.js";
import { OPEN_KYBER_DID_PREFIX } from "./types.js";

export const JOURNAL_ENTRY_COLLECTION = "com.etzhayyim.apps.openKyber.journalEntry";

export type JournalStatus = "draft" | "posted" | "reversed";

export interface JournalLine {
  account: string; // account code
  debit: string; // decimal string ("0" if a credit line)
  credit: string; // decimal string ("0" if a debit line)
  memo?: string;
}

export interface JournalEntryRecord {
  did: string;
  entryId: string;
  number: string;
  date: string; // posting date (ISO)
  memo?: string;
  status: JournalStatus;
  /** entryId of the original, when this is a reversal (非終末論: contra, not edit). */
  reverses?: string;
  /** entryId of the reversal, asserted onto the original when it gets reversed. */
  reversedBy?: string;
  currency: string;
  lines: JournalLine[];
  createdAt: string;
}

export interface JournalEntryView extends JournalEntryRecord {
  uri: string;
}

export interface CreateJournalEntryInput {
  entryId?: string;
  number: string;
  date?: string;
  memo?: string;
  currency?: string;
  lines: JournalLine[];
  /** "draft" keeps it out of the trial balance; default "posted". */
  status?: Extract<JournalStatus, "draft" | "posted">;
}
export interface CreateJournalEntryOutput {
  status: "posted" | "draft" | "alreadyExists" | "rejected";
  uri?: string;
  entryId?: string;
  error?: string;
}

export interface ListJournalEntriesInput {
  status?: JournalStatus;
  limit?: number;
  cursor?: string;
}
export interface ListJournalEntriesOutput {
  items: JournalEntryView[];
  cursor?: string;
  total: number;
}

export interface ReverseJournalEntryInput {
  entryId: string;
  /** id for the new reversing entry; default `${entryId}-rev`. */
  reversalId?: string;
  date?: string;
  memo?: string;
}
export interface ReverseJournalEntryOutput {
  status: "reversed" | "rejected";
  reversalEntryId?: string;
  uri?: string;
  error?: string;
}

export interface TrialBalanceRow {
  account: string;
  debit: string;
  credit: string;
  /** signed net = debit - credit (may be negative). */
  net: string;
}
export interface TrialBalanceOutput {
  rows: TrialBalanceRow[];
  totalDebit: string;
  totalCredit: string;
  balanced: boolean;
  entriesScanned: number;
  truncated: boolean;
}

const PAGE_LIMIT = 100;
const DEFAULT_MAX_SCAN = 10_000;

function entryRkey(id: string): string {
  return `je-${id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
function jeDidFor(id: string): string {
  return `${OPEN_KYBER_DID_PREFIX}je:${id.toLowerCase()}`;
}

/** Validate that lines are well-formed and SUM(debit)=SUM(credit), both > 0. */
export function validateLines(lines: JournalLine[]): string | null {
  if (!Array.isArray(lines) || lines.length < 2) return "needAtLeastTwoLines";
  for (const l of lines) {
    if (!l.account) return "lineMissingAccount";
    if (!isMoney(l.debit) || !isMoney(l.credit)) return "lineAmountNotDecimal";
    if (!isZero(l.debit) && !isZero(l.credit)) return "lineHasBothDebitAndCredit";
    if (isZero(l.debit) && isZero(l.credit)) return "lineHasNoAmount";
  }
  const totalDebit = sumMoney(lines.map((l) => l.debit));
  const totalCredit = sumMoney(lines.map((l) => l.credit));
  if (isZero(totalDebit)) return "entryIsZero";
  if (!eqMoney(totalDebit, totalCredit)) return "unbalanced";
  return null;
}

export async function createJournalEntry(
  e: Etzhayyim,
  input: CreateJournalEntryInput,
): Promise<CreateJournalEntryOutput> {
  if (!input.number) return { status: "rejected", error: "missingNumber" };
  const lineErr = validateLines(input.lines);
  if (lineErr) return { status: "rejected", error: lineErr };

  const entryId = input.entryId ?? input.number;
  const rkey = entryRkey(entryId);
  const existing = await e
    .read<JournalEntryRecord>({ collection: JOURNAL_ENTRY_COLLECTION, rkey })
    .catch(() => ({ records: [] as { uri: string; value: JournalEntryRecord }[] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", uri: existing.records[0].uri, entryId };
  }

  const status: JournalStatus = input.status ?? "posted";
  const record: JournalEntryRecord = {
    did: jeDidFor(entryId),
    entryId,
    number: input.number,
    date: input.date ?? new Date().toISOString(),
    memo: input.memo,
    status,
    currency: input.currency ?? "JPY",
    lines: input.lines,
    createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({
    collection: JOURNAL_ENTRY_COLLECTION,
    record: record as unknown as Record<string, unknown>,
    rkey,
  });
  return { status: status === "draft" ? "draft" : "posted", uri: receipt.uri, entryId };
}

async function scanEntries(e: Etzhayyim, maxScan: number): Promise<JournalEntryView[]> {
  const out: JournalEntryView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.read<JournalEntryRecord>({
      collection: JOURNAL_ENTRY_COLLECTION,
      cursor,
      limit: PAGE_LIMIT,
    });
    for (const r of page.records) out.push({ ...r.value, uri: r.uri });
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }
  return out;
}

export async function listJournalEntries(
  e: Etzhayyim,
  input: ListJournalEntriesInput = {},
): Promise<ListJournalEntriesOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanEntries(e, DEFAULT_MAX_SCAN);
  const filtered = all.filter((je) => !input.status || je.status === input.status);
  return { items: filtered.slice(0, limit), total: filtered.length };
}

/**
 * Reverse a posted entry by asserting a CONTRA entry (debits↔credits swapped) and
 * asserting status=reversed + reversedBy onto the original. Non-終末論: the original
 * posting Datom is preserved; the trial balance nets to zero for the reversed pair.
 */
export async function reverseJournalEntry(
  e: Etzhayyim,
  input: ReverseJournalEntryInput,
): Promise<ReverseJournalEntryOutput> {
  if (!input.entryId) return { status: "rejected", error: "missingEntryId" };
  const rkey = entryRkey(input.entryId);
  const found = await e
    .read<JournalEntryRecord>({ collection: JOURNAL_ENTRY_COLLECTION, rkey })
    .catch(() => ({ records: [] as { uri: string; value: JournalEntryRecord }[] }));
  const orig = found.records[0]?.value;
  if (!orig) return { status: "rejected", error: "notFound" };
  if (orig.status === "reversed") return { status: "rejected", error: "alreadyReversed" };
  if (orig.status === "draft") return { status: "rejected", error: "cannotReverseDraft" };

  const reversalId = input.reversalId ?? `${input.entryId}-rev`;
  const contraLines: JournalLine[] = orig.lines.map((l) => ({
    account: l.account,
    debit: l.credit,
    credit: l.debit,
    memo: l.memo,
  }));
  const reversal: JournalEntryRecord = {
    did: jeDidFor(reversalId),
    entryId: reversalId,
    number: `${orig.number}-REV`,
    date: input.date ?? new Date().toISOString(),
    memo: input.memo ?? `Reversal of ${orig.number}`,
    status: "posted",
    reverses: orig.entryId,
    currency: orig.currency,
    lines: contraLines,
    createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({
    collection: JOURNAL_ENTRY_COLLECTION,
    record: reversal as unknown as Record<string, unknown>,
    rkey: entryRkey(reversalId),
  });
  // Assert the new fact onto the original (non-終末論: a later assertion, not a delete).
  const updatedOrig: JournalEntryRecord = { ...orig, status: "reversed", reversedBy: reversalId };
  await e.write({
    collection: JOURNAL_ENTRY_COLLECTION,
    record: updatedOrig as unknown as Record<string, unknown>,
    rkey,
  });
  return { status: "reversed", reversalEntryId: reversalId, uri: receipt.uri };
}

/**
 * Trial balance: roll up debits/credits per account across all NON-draft entries.
 * A reversed original and its contra both count, so a reversed pair nets to zero —
 * which is exactly the audit-correct behaviour.
 */
export async function getTrialBalance(
  e: Etzhayyim,
  input: { maxScan?: number } = {},
): Promise<TrialBalanceOutput> {
  const maxScan = Math.min(input.maxScan ?? DEFAULT_MAX_SCAN, DEFAULT_MAX_SCAN);
  const all = await scanEntries(e, maxScan);
  const debits = new Map<string, string[]>();
  const credits = new Map<string, string[]>();
  let scanned = 0;
  for (const je of all) {
    if (je.status === "draft") continue;
    scanned += 1;
    for (const l of je.lines) {
      (debits.get(l.account) ?? debits.set(l.account, []).get(l.account)!).push(l.debit);
      (credits.get(l.account) ?? credits.set(l.account, []).get(l.account)!).push(l.credit);
    }
  }
  const accounts = [...new Set([...debits.keys(), ...credits.keys()])].sort();
  const rows: TrialBalanceRow[] = accounts.map((account) => {
    const debit = sumMoney(debits.get(account) ?? ["0"]);
    const credit = sumMoney(credits.get(account) ?? ["0"]);
    return { account, debit, credit, net: subMoney(debit, credit) };
  });
  const totalDebit = sumMoney(rows.map((r) => r.debit));
  const totalCredit = sumMoney(rows.map((r) => r.credit));
  return {
    rows,
    totalDebit,
    totalCredit,
    balanced: eqMoney(totalDebit, totalCredit),
    entriesScanned: scanned,
    truncated: all.length >= maxScan,
  };
}
