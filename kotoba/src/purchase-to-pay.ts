/**
 * open-kyber kotoba — PURCHASE-TO-PAY chain (ADR-2606037200 D2).
 *
 * The procurement mirror of order-to-cash: `receivePurchaseOrder` marks a PO received, and
 * `billPurchaseOrder` turns it into an AP invoice + links the two (PO `:invoice` → invoice,
 * PO status → `:closed`). With `postInvoice` (posting.ts) this completes Purchase Order →
 * Receipt → AP Invoice → Journal Entry → Trial Balance, all on the kotoba Datom log.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import { createInvoice, PURCHASE_ORDER_COLLECTION, type PurchaseOrderRecord } from "./erp-modules.js";
import { slug } from "./_shared.js";

export interface ReceivePurchaseOrderOutput {
  status: "received" | "alreadyReceived" | "rejected";
  error?: string;
}

export async function receivePurchaseOrder(e: Etzhayyim, input: { number: string }): Promise<ReceivePurchaseOrderOutput> {
  if (!input.number) return { status: "rejected", error: "missingNumber" };
  const rkey = `po-${slug(input.number)}`;
  const resp = await e
    .read<PurchaseOrderRecord>({ collection: PURCHASE_ORDER_COLLECTION, rkey })
    .catch(() => ({ records: [] as { uri: string; value: PurchaseOrderRecord }[] }));
  const po = resp.records[0]?.value;
  if (!po) return { status: "rejected", error: "purchaseOrderNotFound" };
  if (po.status === "cancelled") return { status: "rejected", error: "purchaseOrderCancelled" };
  if (po.status === "received" || po.status === "closed") return { status: "alreadyReceived" };
  await e.write({
    collection: PURCHASE_ORDER_COLLECTION,
    record: { ...po, status: "received" } as unknown as Record<string, unknown>,
    rkey,
  });
  return { status: "received" };
}

export interface BillPurchaseOrderInput {
  number: string; // purchase order number
  invoiceNumber?: string; // default `${po.number}-BILL`
  tax?: string;
  due?: string;
}
export interface BillPurchaseOrderOutput {
  status: "billed" | "alreadyBilled" | "rejected";
  invoiceNumber?: string;
  error?: string;
}

export async function billPurchaseOrder(e: Etzhayyim, input: BillPurchaseOrderInput): Promise<BillPurchaseOrderOutput> {
  if (!input.number) return { status: "rejected", error: "missingNumber" };
  const rkey = `po-${slug(input.number)}`;
  const resp = await e
    .read<PurchaseOrderRecord>({ collection: PURCHASE_ORDER_COLLECTION, rkey })
    .catch(() => ({ records: [] as { uri: string; value: PurchaseOrderRecord }[] }));
  const po = resp.records[0]?.value;
  if (!po) return { status: "rejected", error: "purchaseOrderNotFound" };
  if (po.status === "cancelled") return { status: "rejected", error: "purchaseOrderCancelled" };
  if (po.status === "closed") return { status: "alreadyBilled", invoiceNumber: (po as { invoice?: string }).invoice };

  const invoiceNumber = input.invoiceNumber ?? `${po.number}-BILL`;
  const inv = await createInvoice(e, {
    number: invoiceNumber,
    direction: "payable",
    party: po.supplier,
    amount: po.total,
    tax: input.tax,
    currency: po.currency,
    due: input.due,
  });
  if (inv.status === "rejected") return { status: "rejected", error: inv.error };

  const updated: PurchaseOrderRecord & { invoice?: string } = { ...po, status: "closed", invoice: invoiceNumber };
  await e.write({
    collection: PURCHASE_ORDER_COLLECTION,
    record: updated as unknown as Record<string, unknown>,
    rkey,
  });
  return { status: "billed", invoiceNumber };
}
