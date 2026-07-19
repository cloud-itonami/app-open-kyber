import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  registerInventoryItem, listInventory,
  receiveStock, issueStock, stockLedger, stockValuation,
  mulMoney, divMoneyBy,
} from "../src/index.js";

const OWNER = "did:web:kyber.etzhayyim.com";

describe("money — decimal × decimal and decimal ÷ decimal", () => {
  it("multiplies and divides exactly / half-up", () => {
    expect(mulMoney("2.5", "4")).toBe("10");
    expect(mulMoney("1.5", "1.5")).toBe("2.25");
    expect(divMoneyBy("2200", "20", 4)).toBe("110");
    expect(divMoneyBy("1", "3", 4)).toBe("0.3333");
  });
});

describe("inventory moving-average cost ledger", () => {
  let e: any;
  beforeEach(async () => {
    e = new MockEtzhayyim({ did: OWNER });
    await registerInventoryItem(e, { sku: "WIDGET", name: "Widget", uom: "pcs", qty: "0", unitCost: "0" });
  });

  it("recomputes the weighted average on receipts and values issues at average", async () => {
    const r1 = await receiveStock(e, { sku: "WIDGET", qty: "10", unitCost: "100" });
    expect(r1.status).toBe("posted");
    expect(r1.move?.balanceQty).toBe("10");
    expect(r1.move?.balanceAvgCost).toBe("100");
    expect(r1.move?.balanceValue).toBe("1000");

    const r2 = await receiveStock(e, { sku: "WIDGET", qty: "10", unitCost: "120" });
    expect(r2.move?.balanceQty).toBe("20");
    expect(r2.move?.balanceAvgCost).toBe("110"); // (10×100 + 10×120) / 20
    expect(r2.move?.balanceValue).toBe("2200");

    const i1 = await issueStock(e, { sku: "WIDGET", qty: "5" });
    expect(i1.move?.kind).toBe("issue");
    expect(i1.move?.unitCost).toBe("110"); // COGS at moving average
    expect(i1.move?.moveValue).toBe("550");
    expect(i1.move?.balanceQty).toBe("15");
    expect(i1.move?.balanceAvgCost).toBe("110"); // average unchanged on issue
    expect(i1.move?.balanceValue).toBe("1650");

    // the item record carries the running balance
    const inv = await listInventory(e);
    const w = inv.items.find((x) => x.sku === "WIDGET")!;
    expect(w.qty).toBe("15");
    expect(w.unitCost).toBe("110");
  });

  it("keeps a sequenced per-SKU ledger and rejects over-issue / unknown item", async () => {
    await receiveStock(e, { sku: "WIDGET", qty: "5", unitCost: "100", ref: "PO-1" });
    await issueStock(e, { sku: "WIDGET", qty: "2", ref: "SO-1" });
    const led = await stockLedger(e, { sku: "WIDGET" });
    expect(led.total).toBe(2);
    expect(led.items.map((m) => m.seq)).toEqual([1, 2]);
    expect(led.items[0].ref).toBe("PO-1");

    expect((await issueStock(e, { sku: "WIDGET", qty: "999" })).error).toBe("insufficientStock");
    expect((await receiveStock(e, { sku: "GHOST", qty: "1", unitCost: "1" })).error).toBe("itemNotFound");
  });

  it("values total inventory at moving-average cost", async () => {
    await receiveStock(e, { sku: "WIDGET", qty: "10", unitCost: "100" });
    await registerInventoryItem(e, { sku: "GADGET", name: "Gadget", qty: "0", unitCost: "0" });
    await receiveStock(e, { sku: "GADGET", qty: "4", unitCost: "250" });
    const val = await stockValuation(e);
    expect(val.totalValue).toBe("2000"); // 10×100 + 4×250
  });
});
