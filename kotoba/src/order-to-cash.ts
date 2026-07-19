/**
 * open-kyber kotoba — ORDER-TO-CASH chain (ADR-2606037200 D2).
 *
 * `invoiceSalesOrder` turns a confirmed/fulfilled sales order into an AR invoice and links
 * the two (SO `:invoice` → invoice; SO status → `:invoiced`). Combined with `postInvoice`
 * (posting.ts) this completes Sales Order → Invoice → Journal Entry → Trial Balance →
 * Financial Statements — the order-to-cash spine of a real ERP, end to end on the Datom log.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import { createInvoice, SALES_ORDER_COLLECTION, type SalesOrderRecord } from "./erp-modules.js";
import { slug } from "./_shared.js";

export interface InvoiceSalesOrderInput {
  number: string; // sales order number
  invoiceNumber?: string; // default `${so.number}-INV`
  tax?: string;
  due?: string;
}
export interface InvoiceSalesOrderOutput {
  status: "invoiced" | "alreadyInvoiced" | "rejected";
  invoiceNumber?: string;
  error?: string;
}

export async function invoiceSalesOrder(e: Etzhayyim, input: InvoiceSalesOrderInput): Promise<InvoiceSalesOrderOutput> {
  if (!input.number) return { status: "rejected", error: "missingNumber" };
  const rkey = `so-${slug(input.number)}`;
  const resp = await e
    .read<SalesOrderRecord>({ collection: SALES_ORDER_COLLECTION, rkey })
    .catch(() => ({ records: [] as { uri: string; value: SalesOrderRecord }[] }));
  const so = resp.records[0]?.value;
  if (!so) return { status: "rejected", error: "salesOrderNotFound" };
  if (so.status === "cancelled") return { status: "rejected", error: "salesOrderCancelled" };
  if (so.status === "invoiced") return { status: "alreadyInvoiced", invoiceNumber: (so as { invoice?: string }).invoice };

  const invoiceNumber = input.invoiceNumber ?? `${so.number}-INV`;
  const inv = await createInvoice(e, {
    number: invoiceNumber,
    direction: "receivable",
    party: so.customer,
    amount: so.total,
    tax: input.tax,
    currency: so.currency,
    due: input.due,
  });
  if (inv.status === "rejected") return { status: "rejected", error: inv.error };

  // Link the SO to its invoice + advance status (a new assertion; non-終末論).
  const updated: SalesOrderRecord & { invoice?: string } = { ...so, status: "invoiced", invoice: invoiceNumber };
  await e.write({
    collection: SALES_ORDER_COLLECTION,
    record: updated as unknown as Record<string, unknown>,
    rkey,
  });
  return { status: "invoiced", invoiceNumber };
}
