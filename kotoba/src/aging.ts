/**
 * open-kyber kotoba — AR/AP AGING + credit-limit checking (ADR-2606037200 D2).
 *
 * Aging buckets every OPEN invoice (outstanding = amount − paidAmount) by days past its due
 * date as-of a report date — the classic receivables/payables risk report. `creditCheck`
 * sums a customer's open AR exposure and compares it to their party credit limit (party.ts),
 * so a sales order / invoice can be blocked before it pushes the customer over the line.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import { isZero, subMoney, sumMoney } from "./money.js";
import { listInvoices, type InvoiceDirection, type InvoiceRecord } from "./erp-modules.js";
import { getParty } from "./party.js";

const MS_PER_DAY = 86_400_000;
export type AgingBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";
const BUCKETS: AgingBucket[] = ["current", "1-30", "31-60", "61-90", "90+"];

function bucketOf(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "1-30";
  if (daysOverdue <= 60) return "31-60";
  if (daysOverdue <= 90) return "61-90";
  return "90+";
}

export interface AgingInvoiceLine {
  number: string;
  party: string;
  due: string;
  outstanding: string;
  daysOverdue: number;
  bucket: AgingBucket;
}
export interface AgingReport {
  direction: InvoiceDirection;
  asOf: string;
  lines: AgingInvoiceLine[];
  byBucket: Record<AgingBucket, string>;
  byParty: Record<string, string>;
  totalOutstanding: string;
}

async function aging(e: Etzhayyim, direction: InvoiceDirection, asOf?: string): Promise<AgingReport> {
  const asOfStr = asOf ?? new Date().toISOString().slice(0, 10);
  const asOfMs = Date.parse(asOfStr);
  const all = await listInvoices(e, { direction, limit: 100_000 });
  const lines: AgingInvoiceLine[] = [];
  const byBucket: Record<AgingBucket, string> = { current: "0", "1-30": "0", "31-60": "0", "61-90": "0", "90+": "0" };
  const byParty: Record<string, string> = {};

  for (const r of all.items) {
    const inv = r as InvoiceRecord & { paidAmount?: string };
    if (inv.status === "void" || inv.status === "paid") continue;
    const outstanding = subMoney(inv.amount, inv.paidAmount ?? "0");
    if (isZero(outstanding) || outstanding.startsWith("-")) continue;
    const daysOverdue = Math.floor((asOfMs - Date.parse(inv.due)) / MS_PER_DAY);
    const bucket = bucketOf(daysOverdue);
    lines.push({ number: inv.number, party: inv.party, due: inv.due, outstanding, daysOverdue, bucket });
    byBucket[bucket] = sumMoney([byBucket[bucket], outstanding]);
    byParty[inv.party] = sumMoney([byParty[inv.party] ?? "0", outstanding]);
  }

  return {
    direction,
    asOf: asOfStr,
    lines,
    byBucket,
    byParty,
    totalOutstanding: sumMoney(BUCKETS.map((b) => byBucket[b])),
  };
}

export const arAging = (e: Etzhayyim, input: { asOf?: string } = {}) => aging(e, "receivable", input.asOf);
export const apAging = (e: Etzhayyim, input: { asOf?: string } = {}) => aging(e, "payable", input.asOf);

export interface CreditCheckOutput {
  party: string;
  /** open AR exposure for the party (sum of outstanding receivables). */
  outstanding: string;
  /** outstanding + the proposed additional amount. */
  exposure: string;
  /** credit limit, or null if none set (treated as unlimited). */
  limit: string | null;
  /** limit − outstanding, or null if unlimited. */
  available: string | null;
  withinLimit: boolean;
}

/**
 * Check a customer's AR exposure against their credit limit. `party` matches the invoice
 * `party` field; `partyId` (if given) looks up the limit in the party master, else `party`
 * is used as the id. `additionalAmount` models a proposed new order/invoice.
 */
export async function creditCheck(
  e: Etzhayyim,
  input: { party: string; partyId?: string; additionalAmount?: string },
): Promise<CreditCheckOutput> {
  const all = await listInvoices(e, { direction: "receivable", limit: 100_000 });
  let outstanding = "0";
  for (const r of all.items) {
    const inv = r as InvoiceRecord & { paidAmount?: string };
    if (inv.party !== input.party) continue;
    if (inv.status === "void" || inv.status === "paid") continue;
    const out = subMoney(inv.amount, inv.paidAmount ?? "0");
    if (!isZero(out) && !out.startsWith("-")) outstanding = sumMoney([outstanding, out]);
  }
  const exposure = sumMoney([outstanding, input.additionalAmount ?? "0"]);

  const party = await getParty(e, { partyId: input.partyId ?? input.party });
  const limit = party?.creditLimit ?? null;
  const withinLimit = limit === null || !subMoney(limit, exposure).startsWith("-");
  return {
    party: input.party,
    outstanding,
    exposure,
    limit,
    available: limit === null ? null : subMoney(limit, outstanding),
    withinLimit,
  };
}
