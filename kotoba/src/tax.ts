/**
 * open-kyber kotoba — TAX codes + consumption-tax / VAT report (ADR-2606037200 D2).
 *
 * A tax-code registry (rate + label, e.g. JP 10% standard / 8% reduced / 0% exempt) and a
 * period report that rolls invoice tax up into OUTPUT tax (on sales / receivables — 仮受消費税)
 * and INPUT tax (on purchases / payables — 仮払消費税), with net tax payable = output − input
 * (the 消費税申告 figure), broken down by tax code and currency. Pure aggregation off the
 * invoice Datoms — non-adjudicating: it reports what was recorded, not a filing.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import { isMoney, subMoney, sumMoney } from "./money.js";
import { listInvoices, type InvoiceRecord } from "./erp-modules.js";
import { OPEN_KYBER_DID_PREFIX } from "./types.js";
import { listAll, slug } from "./_shared.js";

export const TAX_CODE_COLLECTION = "com.etzhayyim.apps.openKyber.taxCode";

export interface TaxCodeRecord {
  did: string;
  code: string; // e.g. "JP-STD", "JP-RED", "EXEMPT"
  name: string;
  /** percentage as a decimal string, e.g. "10", "8", "0". */
  ratePct: string;
  jurisdiction?: string; // e.g. "JP", "DE"
  createdAt: string;
}

export async function setTaxCode(e: Etzhayyim, input: { code: string; name: string; ratePct: string; jurisdiction?: string }): Promise<{ status: "set" | "rejected"; error?: string }> {
  if (!input.code || !input.name) return { status: "rejected", error: "missingRequiredFields" };
  if (!isMoney(input.ratePct)) return { status: "rejected", error: "invalidRate" };
  const record: TaxCodeRecord = {
    did: `${OPEN_KYBER_DID_PREFIX}taxcode:${slug(input.code)}`,
    code: input.code,
    name: input.name,
    ratePct: input.ratePct,
    jurisdiction: input.jurisdiction,
    createdAt: new Date().toISOString(),
  };
  // upsert (direct write) so re-rating a code is allowed
  await e.write({ collection: TAX_CODE_COLLECTION, record: record as unknown as Record<string, unknown>, rkey: `tax-${slug(input.code)}` });
  return { status: "set" };
}

export async function listTaxCodes(e: Etzhayyim): Promise<TaxCodeRecord[]> {
  const r = await listAll<TaxCodeRecord>(e, TAX_CODE_COLLECTION);
  return r.items;
}

export interface TaxReportRow {
  taxCode: string;
  currency: string;
  /** taxable base = Σ(amount − tax) for this code/currency/direction. */
  outputBase: string; // sales (receivable)
  outputTax: string;
  inputBase: string; // purchases (payable)
  inputTax: string;
}
export interface TaxReportOutput {
  rows: TaxReportRow[];
  totalOutputTax: string;
  totalInputTax: string;
  /** net consumption tax payable (output − input). Negative = refund position. */
  netTaxPayable: string;
  /** per-currency net (no cross-currency sum). */
  byCurrency: Record<string, { outputTax: string; inputTax: string; net: string }>;
}

export async function taxReport(e: Etzhayyim, input: { defaultCode?: string } = {}): Promise<TaxReportOutput> {
  const all = await listInvoices(e, { limit: 100_000 });
  const defCode = input.defaultCode ?? "STANDARD";
  const key = (code: string, cur: string) => `${code}|${cur}`;
  const rows = new Map<string, TaxReportRow>();

  for (const r of all.items) {
    const inv = r as InvoiceRecord;
    if (inv.status === "void") continue;
    const tax = inv.tax ?? "0";
    const base = subMoney(inv.amount, tax); // amount is gross (tax-inclusive)
    const code = inv.taxCode ?? defCode;
    const k = key(code, inv.currency);
    const row = rows.get(k) ?? { taxCode: code, currency: inv.currency, outputBase: "0", outputTax: "0", inputBase: "0", inputTax: "0" };
    if (inv.direction === "receivable") {
      row.outputBase = sumMoney([row.outputBase, base]);
      row.outputTax = sumMoney([row.outputTax, tax]);
    } else {
      row.inputBase = sumMoney([row.inputBase, base]);
      row.inputTax = sumMoney([row.inputTax, tax]);
    }
    rows.set(k, row);
  }

  const rowList = [...rows.values()];
  const byCurrency: Record<string, { outputTax: string; inputTax: string; net: string }> = {};
  for (const row of rowList) {
    const c = byCurrency[row.currency] ?? { outputTax: "0", inputTax: "0", net: "0" };
    c.outputTax = sumMoney([c.outputTax, row.outputTax]);
    c.inputTax = sumMoney([c.inputTax, row.inputTax]);
    c.net = subMoney(c.outputTax, c.inputTax);
    byCurrency[row.currency] = c;
  }
  const totalOutputTax = sumMoney(rowList.map((r) => r.outputTax));
  const totalInputTax = sumMoney(rowList.map((r) => r.inputTax));
  return {
    rows: rowList,
    totalOutputTax,
    totalInputTax,
    netTaxPayable: subMoney(totalOutputTax, totalInputTax),
    byCurrency,
  };
}
