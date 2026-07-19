import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  seedChartOfAccounts,
  createPurchaseOrder, listPurchaseOrders,
  receivePurchaseOrder, billPurchaseOrder,
  postInvoice, listInvoices,
  createSalesOrder, invoiceSalesOrder,
  getTrialBalance, incomeStatement, balanceSheet,
  closePeriod,
} from "../src/index.js";

const OWNER = "did:web:kyber.etzhayyim.com";

describe("purchase-to-pay: PO → receipt → AP invoice → JE", () => {
  let e: any;
  beforeEach(async () => {
    e = new MockEtzhayyim({ did: OWNER });
    await seedChartOfAccounts(e);
  });

  it("receives + bills a PO, posts the AP invoice, books balance", async () => {
    await createPurchaseOrder(e, { number: "PO-1", supplier: "Supplier", total: "550", status: "sent" });
    expect((await receivePurchaseOrder(e, { number: "PO-1" })).status).toBe("received");
    expect((await receivePurchaseOrder(e, { number: "PO-1" })).status).toBe("alreadyReceived");

    const bill = await billPurchaseOrder(e, { number: "PO-1", tax: "50" });
    expect(bill.status).toBe("billed");
    expect(bill.invoiceNumber).toBe("PO-1-BILL");
    expect((await billPurchaseOrder(e, { number: "PO-1" })).status).toBe("alreadyBilled");
    expect((await listPurchaseOrders(e, { status: "closed" })).total).toBe(1);
    expect((await listInvoices(e, { direction: "payable" })).total).toBe(1);

    const post = await postInvoice(e, { number: "PO-1-BILL" }); // Dr Expense 500 + Dr Tax 50 / Cr AP 550
    expect(post.status).toBe("posted");
    const tb = await getTrialBalance(e);
    expect(tb.balanced).toBe(true);
    expect(tb.rows.find((r) => r.account === "5000")?.debit).toBe("500");
    expect(tb.rows.find((r) => r.account === "2000")?.credit).toBe("550");
  });

  it("rejects billing an unknown / cancelled PO", async () => {
    expect((await billPurchaseOrder(e, { number: "ghost" })).error).toBe("purchaseOrderNotFound");
    await createPurchaseOrder(e, { number: "PO-X", supplier: "s", total: "10", status: "cancelled" });
    expect((await receivePurchaseOrder(e, { number: "PO-X" })).error).toBe("purchaseOrderCancelled");
  });
});

describe("period close: closing entries → retained earnings", () => {
  let e: any;
  beforeEach(async () => {
    e = new MockEtzhayyim({ did: OWNER });
    await seedChartOfAccounts(e);
  });

  it("zeroes P&L and carries net income to Retained Earnings", async () => {
    // revenue 1000 (net) + tax 100 via an AR sale, and an expense 300 via an AP bill
    await createSalesOrder(e, { number: "SO-1", customer: "Acme", total: "1100", status: "confirmed" });
    await invoiceSalesOrder(e, { number: "SO-1", tax: "100" });
    await postInvoice(e, { number: "SO-1-INV" });
    await createPurchaseOrder(e, { number: "PO-1", supplier: "Sup", total: "300" });
    await billPurchaseOrder(e, { number: "PO-1" });
    await postInvoice(e, { number: "PO-1-BILL" }); // Dr Expense 300 / Cr AP 300

    const before = await incomeStatement(e);
    expect(before.totalRevenue).toBe("1000");
    expect(before.totalExpense).toBe("300");
    expect(before.netIncome).toBe("700");

    const close = await closePeriod(e, { period: "2026-FY" });
    expect(close.status).toBe("closed");
    expect(close.netIncome).toBe("700");
    // re-close is a no-op: the P&L is already zeroed, so there is nothing left to close
    expect((await closePeriod(e, { period: "2026-FY" })).status).toBe("nothingToClose");

    // after close: P&L is zero, Retained Earnings holds 700, books still balanced
    const after = await incomeStatement(e);
    expect(after.totalRevenue).toBe("0");
    expect(after.totalExpense).toBe("0");
    expect(after.netIncome).toBe("0");
    const bs = await balanceSheet(e);
    expect(bs.equity.find((x) => x.account === "3200")?.amount).toBe("700"); // Retained Earnings
    expect(bs.balanced).toBe(true);
    expect((await getTrialBalance(e)).balanced).toBe(true);
  });

  it("nothing to close when there is no P&L activity", async () => {
    expect((await closePeriod(e)).status).toBe("nothingToClose");
  });
});
