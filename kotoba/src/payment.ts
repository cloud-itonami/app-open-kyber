/**
 * open-kyber kotoba — PAYMENT application (ADR-2606037200 D2). Settles an open invoice
 * against cash and posts the settlement to the GL, closing the cash cycle:
 *
 *   receivable (collect):  Dr Cash      Cr Accounts Receivable
 *   payable    (pay):      Dr Accounts Payable   Cr Cash
 *
 * Supports partial payments (invoice status open → partial → paid) and rejects overpayment.
 * Each payment is an immutable Datom linked to its invoice + settlement journal entry.
 * Combined with order-to-cash / purchase-to-pay this gives SO/PO → invoice → JE → payment →
 * cash, all on the kotoba Datom log. Exact decimal money, no float.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import { createJournalEntry, type JournalLine } from "./accounting.js";
import { INVOICE_COLLECTION, type InvoiceRecord } from "./erp-modules.js";
import { isMoney, isZero, subMoney, sumMoney } from "./money.js";
import { OPEN_KYBER_DID_PREFIX } from "./types.js";
import { slug } from "./_shared.js";

export const PAYMENT_COLLECTION = "com.etzhayyim.apps.openKyber.payment";

export interface PaymentRecord {
  did: string;
  paymentId: string;
  invoiceNumber: string;
  direction: "receivable" | "payable";
  amount: string;
  cashAccount: string;
  journalEntryId: string;
  paidAt: string;
  createdAt: string;
}
export interface PaymentView extends PaymentRecord {
  uri: string;
}

export interface RecordPaymentInput {
  invoiceNumber: string;
  /** amount to apply; defaults to the full outstanding balance. */
  amount?: string;
  cashAccount?: string; // default 1000 Cash
  arAccount?: string; // default 1100 Accounts Receivable
  apAccount?: string; // default 2000 Accounts Payable
  paymentId?: string;
  date?: string;
}
export interface RecordPaymentOutput {
  status: "applied" | "rejected";
  paymentId?: string;
  journalEntryId?: string;
  invoiceStatus?: "open" | "partial" | "paid";
  applied?: string;
  outstanding?: string;
  error?: string;
}

const PAGE_LIMIT = 100;
const invRkey = (n: string) => `inv-${slug(n)}`;

async function paymentSeq(e: Etzhayyim, invoiceNumber: string): Promise<number> {
  let n = 0;
  let cursor: string | undefined;
  while (n < 1_000_000) {
    const page = await e.read<PaymentRecord>({ collection: PAYMENT_COLLECTION, cursor, limit: PAGE_LIMIT });
    n += page.records.filter((r) => r.value.invoiceNumber === invoiceNumber).length;
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }
  return n + 1;
}

export async function recordPayment(e: Etzhayyim, input: RecordPaymentInput): Promise<RecordPaymentOutput> {
  if (!input.invoiceNumber) return { status: "rejected", error: "missingInvoiceNumber" };
  const rkey = invRkey(input.invoiceNumber);
  const resp = await e
    .read<InvoiceRecord>({ collection: INVOICE_COLLECTION, rkey })
    .catch(() => ({ records: [] as { uri: string; value: InvoiceRecord }[] }));
  const inv = resp.records[0]?.value as (InvoiceRecord & { paidAmount?: string }) | undefined;
  if (!inv) return { status: "rejected", error: "invoiceNotFound" };
  if (inv.status === "void") return { status: "rejected", error: "invoiceVoid" };

  const paidSoFar = inv.paidAmount ?? "0";
  const outstanding = subMoney(inv.amount, paidSoFar);
  if (isZero(outstanding) || outstanding.startsWith("-")) return { status: "rejected", error: "alreadyPaid" };

  const amount = input.amount ?? outstanding;
  if (!isMoney(amount) || isZero(amount)) return { status: "rejected", error: "invalidAmount" };
  if (subMoney(outstanding, amount).startsWith("-")) return { status: "rejected", error: "overpayment" };

  const cash = input.cashAccount ?? "1000";
  const ar = input.arAccount ?? "1100";
  const ap = input.apAccount ?? "2000";
  const lines: JournalLine[] =
    inv.direction === "receivable"
      ? [
          { account: cash, debit: amount, credit: "0", memo: `Collect ${inv.number}` },
          { account: ar, debit: "0", credit: amount, memo: `AR ${inv.number}` },
        ]
      : [
          { account: ap, debit: amount, credit: "0", memo: `AP ${inv.number}` },
          { account: cash, debit: "0", credit: amount, memo: `Pay ${inv.number}` },
        ];

  const seq = await paymentSeq(e, input.invoiceNumber);
  const paymentId = input.paymentId ?? `${input.invoiceNumber}-PAY-${String(seq).padStart(3, "0")}`;
  const je = await createJournalEntry(e, {
    entryId: `pay-${slug(paymentId)}`,
    number: `PAY-${inv.number}`,
    date: input.date,
    memo: `${inv.direction === "receivable" ? "Payment received" : "Payment made"} ${inv.number}: ${amount}`,
    currency: inv.currency,
    lines,
  });
  if (je.status === "rejected") return { status: "rejected", error: je.error };

  const newPaid = sumMoney([paidSoFar, amount]);
  const newOutstanding = subMoney(inv.amount, newPaid);
  const invoiceStatus: "partial" | "paid" = isZero(newOutstanding) ? "paid" : "partial";
  const updatedInv = { ...inv, paidAmount: newPaid, status: invoiceStatus };
  await e.write({ collection: INVOICE_COLLECTION, record: updatedInv as unknown as Record<string, unknown>, rkey });

  const record: PaymentRecord = {
    did: `${OPEN_KYBER_DID_PREFIX}payment:${slug(paymentId)}`,
    paymentId,
    invoiceNumber: input.invoiceNumber,
    direction: inv.direction,
    amount,
    cashAccount: cash,
    journalEntryId: `pay-${slug(paymentId)}`,
    paidAt: input.date ?? new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  await e.write({ collection: PAYMENT_COLLECTION, record: record as unknown as Record<string, unknown>, rkey: `pay-${slug(paymentId)}` });

  return {
    status: "applied",
    paymentId,
    journalEntryId: record.journalEntryId,
    invoiceStatus,
    applied: amount,
    outstanding: newOutstanding,
  };
}

export async function listPayments(e: Etzhayyim, input: { invoiceNumber?: string } = {}): Promise<{ items: PaymentView[]; total: number }> {
  const out: PaymentView[] = [];
  let cursor: string | undefined;
  while (out.length < 1_000_000) {
    const page = await e.read<PaymentRecord>({ collection: PAYMENT_COLLECTION, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      if (!input.invoiceNumber || r.value.invoiceNumber === input.invoiceNumber) out.push({ ...r.value, uri: r.uri });
    }
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }
  return { items: out, total: out.length };
}
