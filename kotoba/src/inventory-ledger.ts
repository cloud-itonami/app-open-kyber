/**
 * open-kyber kotoba — INVENTORY MOVEMENT ledger with moving-average cost (ADR-2606037200).
 *
 * Turns the inventory module from a static register into a perpetual stock ledger: each
 * receipt / issue / adjustment is an immutable movement Datom (非終末論), and the item's
 * on-hand quantity + weighted-average unit cost are recomputed and carried forward. The
 * running balance is snapshotted on every movement so the ledger is auditable as-of any
 * point. Moving-average cost:
 *
 *   new avg = (oldQty × oldAvg + receivedQty × receivedCost) / (oldQty + receivedQty)
 *
 * Issues leave the average unchanged and value the outflow (COGS) at the current average.
 * All amounts exact decimal (money.ts), no float.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import { divMoneyBy, isMoney, isZero, mulMoney, subMoney, sumMoney } from "./money.js";
import { INVENTORY_ITEM_COLLECTION, type InventoryItemRecord } from "./erp-modules.js";
import { OPEN_KYBER_DID_PREFIX } from "./types.js";
import { slug } from "./_shared.js";

export const STOCK_MOVE_COLLECTION = "com.etzhayyim.apps.openKyber.stockMove";

export type StockMoveKind = "receipt" | "issue" | "adjust";

export interface StockMoveRecord {
  did: string;
  seq: number; // 1-based per-SKU sequence
  sku: string;
  kind: StockMoveKind;
  qty: string; // signed-by-kind magnitude (always positive here; kind gives direction)
  unitCost: string; // receipt: input cost; issue/adjust: current average
  moveValue: string; // qty × unitCost (the value entering/leaving stock)
  balanceQty: string; // on-hand AFTER this move
  balanceAvgCost: string; // moving-average AFTER this move
  balanceValue: string; // balanceQty × balanceAvgCost
  ref?: string; // linking ref (PO, SO, JE…)
  createdAt: string;
}
export interface StockMoveView extends StockMoveRecord {
  uri: string;
}

const PAGE_LIMIT = 100;
const moveRkey = (sku: string, seq: number) => `mov-${slug(sku)}-${String(seq).padStart(6, "0")}`;

async function readItem(e: Etzhayyim, sku: string): Promise<InventoryItemRecord | null> {
  const resp = await e
    .read<InventoryItemRecord>({ collection: INVENTORY_ITEM_COLLECTION, rkey: `sku-${slug(sku)}` })
    .catch(() => ({ records: [] as { uri: string; value: InventoryItemRecord }[] }));
  return resp.records[0]?.value ?? null;
}

async function nextSeq(e: Etzhayyim, sku: string): Promise<number> {
  // count existing moves for this sku (small ledgers; full scan acceptable at this tier)
  let n = 0;
  let cursor: string | undefined;
  while (n < 1_000_000) {
    const page = await e.read<StockMoveRecord>({ collection: STOCK_MOVE_COLLECTION, cursor, limit: PAGE_LIMIT });
    n += page.records.filter((r) => r.value.sku === sku).length;
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }
  return n + 1;
}

async function writeMove(
  e: Etzhayyim,
  sku: string,
  kind: StockMoveKind,
  qty: string,
  unitCost: string,
  balanceQty: string,
  balanceAvgCost: string,
  ref?: string,
): Promise<StockMoveView> {
  const seq = await nextSeq(e, sku);
  const record: StockMoveRecord = {
    did: `${OPEN_KYBER_DID_PREFIX}stockmove:${slug(sku)}:${seq}`,
    seq,
    sku,
    kind,
    qty,
    unitCost,
    moveValue: mulMoney(qty, unitCost),
    balanceQty,
    balanceAvgCost,
    balanceValue: mulMoney(balanceQty, balanceAvgCost),
    ref,
    createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({ collection: STOCK_MOVE_COLLECTION, record: record as unknown as Record<string, unknown>, rkey: moveRkey(sku, seq) });
  // carry the new balance onto the item (qty + moving-average unit cost)
  const item = await readItem(e, sku);
  if (item) {
    await e.write({
      collection: INVENTORY_ITEM_COLLECTION,
      record: { ...item, qty: balanceQty, unitCost: balanceAvgCost } as unknown as Record<string, unknown>,
      rkey: `sku-${slug(sku)}`,
    });
  }
  return { ...record, uri: receipt.uri };
}

export interface StockMoveResult {
  status: "posted" | "rejected";
  move?: StockMoveView;
  error?: string;
}

/** Receive stock at a given unit cost; recompute the moving-average. */
export async function receiveStock(e: Etzhayyim, input: { sku: string; qty: string; unitCost: string; ref?: string }): Promise<StockMoveResult> {
  if (!input.sku) return { status: "rejected", error: "missingSku" };
  if (!isMoney(input.qty) || isZero(input.qty)) return { status: "rejected", error: "invalidQty" };
  if (!isMoney(input.unitCost)) return { status: "rejected", error: "invalidUnitCost" };
  const item = await readItem(e, input.sku);
  if (!item) return { status: "rejected", error: "itemNotFound" };

  const oldQty = item.qty;
  const oldAvg = item.unitCost;
  const newQty = sumMoney([oldQty, input.qty]);
  const oldValue = mulMoney(oldQty, oldAvg);
  const addValue = mulMoney(input.qty, input.unitCost);
  const newValue = sumMoney([oldValue, addValue]);
  const newAvg = isZero(newQty) ? "0" : divMoneyBy(newValue, newQty, 4);
  const move = await writeMove(e, input.sku, "receipt", input.qty, input.unitCost, newQty, newAvg, input.ref);
  return { status: "posted", move };
}

/** Issue stock at the current moving-average cost (COGS). Rejects on insufficient stock. */
export async function issueStock(e: Etzhayyim, input: { sku: string; qty: string; ref?: string }): Promise<StockMoveResult> {
  if (!input.sku) return { status: "rejected", error: "missingSku" };
  if (!isMoney(input.qty) || isZero(input.qty)) return { status: "rejected", error: "invalidQty" };
  const item = await readItem(e, input.sku);
  if (!item) return { status: "rejected", error: "itemNotFound" };

  const remaining = subMoney(item.qty, input.qty);
  if (remaining.startsWith("-")) return { status: "rejected", error: "insufficientStock" };
  // average unchanged on issue; outflow valued at current average
  const move = await writeMove(e, input.sku, "issue", input.qty, item.unitCost, remaining, item.unitCost, input.ref);
  return { status: "posted", move };
}

export async function stockLedger(e: Etzhayyim, input: { sku: string }): Promise<{ items: StockMoveView[]; total: number }> {
  const out: StockMoveView[] = [];
  let cursor: string | undefined;
  while (out.length < 1_000_000) {
    const page = await e.read<StockMoveRecord>({ collection: STOCK_MOVE_COLLECTION, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) if (r.value.sku === input.sku) out.push({ ...r.value, uri: r.uri });
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }
  out.sort((a, b) => a.seq - b.seq);
  return { items: out, total: out.length };
}

/** Total inventory valuation = Σ (on-hand qty × moving-average cost) over all items. */
export async function stockValuation(e: Etzhayyim): Promise<{ totalValue: string; lines: Array<{ sku: string; qty: string; avgCost: string; value: string }> }> {
  const lines: Array<{ sku: string; qty: string; avgCost: string; value: string }> = [];
  let cursor: string | undefined;
  while (lines.length < 1_000_000) {
    const page = await e.read<InventoryItemRecord>({ collection: INVENTORY_ITEM_COLLECTION, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      const v = r.value;
      lines.push({ sku: v.sku, qty: v.qty, avgCost: v.unitCost, value: mulMoney(v.qty, v.unitCost) });
    }
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }
  return { totalValue: sumMoney(lines.map((l) => l.value)), lines };
}
