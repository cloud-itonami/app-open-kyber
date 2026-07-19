/**
 * open-kyber kotoba — invoice → journal-entry POSTING (ADR-2606037200 D2).
 *
 * Ties AP/AR to the General Ledger: posting an invoice recognizes it as a balanced
 * double-entry journal and links the invoice to that entry (`:ar.invoice/je`). This is the
 * maturity step that makes the modules a real ERP rather than disconnected registers.
 *
 *   receivable (AR sale):   Dr AR(gross)            Cr Revenue(net) + Cr Tax(tax)
 *   payable    (AP bill):   Dr Expense(net) + Dr Tax(tax)          Cr AP(gross)
 *
 * `amount` on the invoice is GROSS (tax-inclusive); net = amount − tax. Balanced by
 * construction: gross = net + tax. Money is exact decimal (money.ts), no float.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import { createJournalEntry, type JournalLine } from "./accounting.js";
import { INVOICE_COLLECTION, type InvoiceRecord } from "./erp-modules.js";
import { isZero, subMoney } from "./money.js";
import { slug } from "./_shared.js";

export interface PostInvoiceInput {
  number: string;
  /** GL account codes; sensible IFRS defaults if omitted. */
  arAccount?: string; // receivable control (default 1100)
  apAccount?: string; // payable control (default 2000)
  revenueAccount?: string; // default 4000
  expenseAccount?: string; // default 5000
  taxAccount?: string; // default 2800 Tax Payable
  date?: string;
}
export interface PostInvoiceOutput {
  status: "posted" | "alreadyPosted" | "rejected";
  journalEntryId?: string;
  error?: string;
}

function jeIdForInvoice(number: string): string {
  return `inv-${slug(number)}-je`;
}

export async function postInvoice(e: Etzhayyim, input: PostInvoiceInput): Promise<PostInvoiceOutput> {
  if (!input.number) return { status: "rejected", error: "missingNumber" };
  const resp = await e
    .read<InvoiceRecord>({ collection: INVOICE_COLLECTION, rkey: `inv-${slug(input.number)}` })
    .catch(() => ({ records: [] as { uri: string; value: InvoiceRecord }[] }));
  const inv = resp.records[0]?.value;
  if (!inv) return { status: "rejected", error: "invoiceNotFound" };

  const gross = inv.amount;
  const tax = inv.tax ?? "0";
  const net = subMoney(gross, tax);
  if (net.startsWith("-")) return { status: "rejected", error: "taxExceedsAmount" };

  const ar = input.arAccount ?? "1100";
  const ap = input.apAccount ?? "2000";
  const revenue = input.revenueAccount ?? "4000";
  const expense = input.expenseAccount ?? "5000";
  const taxAcct = input.taxAccount ?? "2800";

  let lines: JournalLine[];
  if (inv.direction === "receivable") {
    lines = [
      { account: ar, debit: gross, credit: "0", memo: `AR ${inv.number}` },
      { account: revenue, debit: "0", credit: net, memo: `Revenue ${inv.number}` },
    ];
    if (!isZero(tax)) lines.push({ account: taxAcct, debit: "0", credit: tax, memo: `Tax ${inv.number}` });
  } else {
    lines = [
      { account: expense, debit: net, credit: "0", memo: `Expense ${inv.number}` },
    ];
    if (!isZero(tax)) lines.push({ account: taxAcct, debit: tax, credit: "0", memo: `Tax ${inv.number}` });
    lines.push({ account: ap, debit: "0", credit: gross, memo: `AP ${inv.number}` });
  }

  const entryId = jeIdForInvoice(input.number);
  const je = await createJournalEntry(e, {
    entryId,
    number: `JE-${inv.number}`,
    date: input.date ?? inv.issued,
    memo: `${inv.direction === "receivable" ? "Recognize AR" : "Recognize AP"} invoice ${inv.number}`,
    currency: inv.currency,
    lines,
  });
  if (je.status === "alreadyExists") return { status: "alreadyPosted", journalEntryId: entryId };
  if (je.status === "rejected") return { status: "rejected", error: je.error };

  // Link the invoice to its recognizing journal entry (a new assertion; non-終末論).
  const updated: InvoiceRecord & { je?: string } = { ...inv, je: entryId } as InvoiceRecord & { je?: string };
  await e.write({
    collection: INVOICE_COLLECTION,
    record: updated as unknown as Record<string, unknown>,
    rkey: `inv-${slug(input.number)}`,
  });
  return { status: "posted", journalEntryId: entryId };
}
