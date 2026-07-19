/**
 * open-kyber kotoba — multi-currency FX (ADR-2606037200 D2). A rate table on the kotoba
 * Datom log + exact currency conversion + base-currency consolidation. Rates are stored per
 * ordered pair (1 `base` = `rate` `quote`); a missing direct pair is satisfied by inverting
 * the reverse pair. All amounts exact decimal (money.ts), no float. AT-Lexicon money STRINGS.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import { divMoneyBy, isMoney, mulMoney, subMoney, sumMoney } from "./money.js";
import { OPEN_KYBER_DID_PREFIX } from "./types.js";
import { listInvoices } from "./erp-modules.js";

export const FX_RATE_COLLECTION = "com.etzhayyim.apps.openKyber.fxRate";

export interface FxRateRecord {
  did: string;
  base: string; // ISO-4217, e.g. "USD"
  quote: string; // ISO-4217, e.g. "JPY"
  rate: string; // 1 base = rate quote (decimal string)
  asOf: string;
  createdAt: string;
}

const PAGE_LIMIT = 100;
const norm = (c: string) => c.trim().toUpperCase();
const rateRkey = (base: string, quote: string) => `fx-${norm(base).toLowerCase()}-${norm(quote).toLowerCase()}`;

/** Round an exact amount to `dp` fractional digits (half-up). */
function round(amount: string, dp: number): string {
  return divMoneyBy(amount, "1", dp);
}

export async function setFxRate(
  e: Etzhayyim,
  input: { base: string; quote: string; rate: string; asOf?: string },
): Promise<{ status: "set" | "rejected"; error?: string }> {
  if (!input.base || !input.quote) return { status: "rejected", error: "missingCurrency" };
  if (!isMoney(input.rate) || input.rate === "0") return { status: "rejected", error: "invalidRate" };
  const base = norm(input.base);
  const quote = norm(input.quote);
  if (base === quote) return { status: "rejected", error: "sameCurrency" };
  const record: FxRateRecord = {
    did: `${OPEN_KYBER_DID_PREFIX}fx:${base.toLowerCase()}:${quote.toLowerCase()}`,
    base,
    quote,
    rate: input.rate,
    asOf: input.asOf ?? new Date().toISOString().slice(0, 10),
    createdAt: new Date().toISOString(),
  };
  await e.write({ collection: FX_RATE_COLLECTION, record: record as unknown as Record<string, unknown>, rkey: rateRkey(base, quote) });
  return { status: "set" };
}

/** Resolve 1 `from` = ? `to`. Direct pair, else inverse of the reverse pair, else null. */
export async function getFxRate(e: Etzhayyim, input: { from: string; to: string }): Promise<string | null> {
  const from = norm(input.from);
  const to = norm(input.to);
  if (from === to) return "1";
  const direct = await e
    .read<FxRateRecord>({ collection: FX_RATE_COLLECTION, rkey: rateRkey(from, to) })
    .catch(() => ({ records: [] as { uri: string; value: FxRateRecord }[] }));
  if (direct.records[0]?.value) return direct.records[0].value.rate;
  const reverse = await e
    .read<FxRateRecord>({ collection: FX_RATE_COLLECTION, rkey: rateRkey(to, from) })
    .catch(() => ({ records: [] as { uri: string; value: FxRateRecord }[] }));
  if (reverse.records[0]?.value) return divMoneyBy("1", reverse.records[0].value.rate, 8); // invert
  return null;
}

export interface ConvertOutput {
  status: "ok" | "noRate" | "rejected";
  amount?: string;
  rate?: string;
  error?: string;
}

/** Convert `amount` from one currency to another at the stored rate, rounded to `dp`. */
export async function convert(
  e: Etzhayyim,
  input: { amount: string; from: string; to: string; dp?: number },
): Promise<ConvertOutput> {
  if (!isMoney(input.amount)) return { status: "rejected", error: "invalidAmount" };
  const dp = input.dp ?? 2;
  if (norm(input.from) === norm(input.to)) return { status: "ok", amount: round(input.amount, dp), rate: "1" };
  const rate = await getFxRate(e, { from: input.from, to: input.to });
  if (rate === null) return { status: "noRate" };
  return { status: "ok", amount: round(mulMoney(input.amount, rate), dp), rate };
}

export async function listFxRates(e: Etzhayyim): Promise<FxRateRecord[]> {
  const out: FxRateRecord[] = [];
  let cursor: string | undefined;
  while (out.length < 100_000) {
    const page = await e.read<FxRateRecord>({ collection: FX_RATE_COLLECTION, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) out.push(r.value);
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }
  return out;
}

export interface InvoiceTotalsInBaseOutput {
  baseCurrency: string;
  receivable: string;
  payable: string;
  net: string; // receivable − payable
  /** currencies that had no rate to base (their invoices were skipped). */
  unconverted: string[];
}

/** Consolidate all invoices into a single base currency (multi-currency AR/AP roll-up). */
export async function invoiceTotalsInBase(e: Etzhayyim, input: { baseCurrency: string }): Promise<InvoiceTotalsInBaseOutput> {
  const base = norm(input.baseCurrency);
  const all = await listInvoices(e, { limit: 100_000 });
  const recv: string[] = [];
  const pay: string[] = [];
  const unconverted = new Set<string>();
  for (const inv of all.items) {
    const c = await convert(e, { amount: inv.amount, from: inv.currency, to: base });
    if (c.status !== "ok" || !c.amount) {
      unconverted.add(norm(inv.currency));
      continue;
    }
    (inv.direction === "receivable" ? recv : pay).push(c.amount);
  }
  const receivable = sumMoney(recv);
  const payable = sumMoney(pay);
  return {
    baseCurrency: base,
    receivable,
    payable,
    net: subMoney(receivable, payable),
    unconverted: [...unconverted],
  };
}
