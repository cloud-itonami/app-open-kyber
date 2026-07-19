import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  decliningBalanceSchedule, straightLineSchedule,
  registerFixedAsset, runDepreciation, listDepreciationRuns,
  seedChartOfAccounts,
  createSalesOrder, listSalesOrders,
  invoiceSalesOrder, postInvoice, listInvoices,
  balanceSheet, incomeStatement,
  sumMoney,
} from "../src/index.js";

const OWNER = "did:web:kyber.etzhayyim.com";

describe("declining-balance depreciation", () => {
  it("charges book × factor/life, floors at salvage, never below", () => {
    const s = decliningBalanceSchedule("1000", "0", 5, 2); // DDB rate 2/5 = 0.4
    expect(s[0].amount).toBe("400"); // 1000 × 0.4
    expect(s[1].amount).toBe("240"); // 600 × 0.4
    // every charge ≥ 0 and accumulated never exceeds depreciable base
    for (const r of s) expect(r.amount.startsWith("-")).toBe(false);
    expect(sumMoney(s.map((r) => r.amount))).toBe("1000"); // fully depreciated to salvage 0
    expect(s[4].accumulated).toBe("1000");
  });
  it("respects a non-zero salvage floor", () => {
    const s = decliningBalanceSchedule("1000", "200", 5, 2);
    expect(s[s.length - 1].accumulated).toBe("800"); // depreciates down to salvage 200, not below
  });
  it("runDepreciation uses the asset's method", async () => {
    const e: any = new MockEtzhayyim({ did: OWNER });
    await registerFixedAsset(e, { tag: "FA-DB", name: "Press", cost: "1000", salvage: "0", lifeMonths: 5, method: "declining-balance" });
    const p1 = await runDepreciation(e, { tag: "FA-DB", periodIndex: 1 });
    expect(p1.run?.amount).toBe("400");
    await registerFixedAsset(e, { tag: "FA-UOP", name: "Mill", cost: "1000", lifeMonths: 5, method: "units-of-production" });
    expect((await runDepreciation(e, { tag: "FA-UOP", periodIndex: 1 })).error).toBe("unitsOfProductionNeedsUsageInput");
  });
});

describe("order-to-cash: SO → invoice → JE → statements (end to end)", () => {
  let e: any;
  beforeEach(async () => {
    e = new MockEtzhayyim({ did: OWNER });
    await seedChartOfAccounts(e);
  });

  it("invoices a sales order, posts it, and the books balance", async () => {
    await createSalesOrder(e, { number: "SO-1", customer: "Acme", total: "1100", status: "confirmed" });
    const inv = await invoiceSalesOrder(e, { number: "SO-1", tax: "100" });
    expect(inv.status).toBe("invoiced");
    expect(inv.invoiceNumber).toBe("SO-1-INV");

    // SO advanced + linked; idempotent
    expect((await listSalesOrders(e, { status: "invoiced" })).total).toBe(1);
    expect((await invoiceSalesOrder(e, { number: "SO-1" })).status).toBe("alreadyInvoiced");
    expect((await listInvoices(e, { direction: "receivable" })).total).toBe(1);

    const post = await postInvoice(e, { number: "SO-1-INV" });
    expect(post.status).toBe("posted");
  });

  it("generates a balanced Balance Sheet and a consistent Income Statement", async () => {
    await createSalesOrder(e, { number: "SO-1", customer: "Acme", total: "1100", status: "confirmed" });
    await invoiceSalesOrder(e, { number: "SO-1", tax: "100" });
    await postInvoice(e, { number: "SO-1-INV" }); // Dr AR 1100 / Cr Revenue 1000 / Cr Tax 100

    const is = await incomeStatement(e);
    expect(is.totalRevenue).toBe("1000");
    expect(is.totalExpense).toBe("0");
    expect(is.netIncome).toBe("1000");

    const bs = await balanceSheet(e);
    expect(bs.assets.find((a) => a.account === "1100")?.amount).toBe("1100"); // AR
    expect(bs.liabilities.find((l) => l.account === "2800")?.amount).toBe("100"); // Tax Payable
    expect(bs.netIncome).toBe("1000");
    // Assets (1100) = Liabilities (100) + Equity (0) + Net Income (1000)
    expect(bs.totalAssets).toBe("1100");
    expect(bs.balanced).toBe(true);
  });
});
