import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  seedChartOfAccounts,
  createJournalEntry,
  createSalesOrder, invoiceSalesOrder, postInvoice,
  cashFlowStatement, cashFlowCategory,
  setBudget, listBudgets, budgetVarianceReport,
} from "../src/index.js";

const OWNER = "did:web:kyber.etzhayyim.com";

describe("cash-flow statement (direct method, operating/investing/financing)", () => {
  let e: any;
  beforeEach(async () => {
    e = new MockEtzhayyim({ did: OWNER });
    await seedChartOfAccounts(e);
  });

  it("classifies cash movements and stays internally consistent", async () => {
    // Financing inflow: issue shares for cash. Dr Cash 5000 / Cr Share Capital 5000
    await createJournalEntry(e, { number: "JE-CAP", lines: [
      { account: "1000", debit: "5000", credit: "0" },
      { account: "3000", debit: "0", credit: "5000" },
    ] });
    // Investing outflow: buy equipment. Dr PPE 2000 / Cr Cash 2000
    await createJournalEntry(e, { number: "JE-PPE", lines: [
      { account: "1500", debit: "2000", credit: "0" },
      { account: "1000", debit: "0", credit: "2000" },
    ] });
    // Operating inflow: collect a receivable. Dr Cash 1100 / Cr AR 1100
    await createJournalEntry(e, { number: "JE-COL", lines: [
      { account: "1000", debit: "1100", credit: "0" },
      { account: "1100", debit: "0", credit: "1100" },
    ] });

    const cf = await cashFlowStatement(e);
    expect(cf.totalFinancing).toBe("5000");
    expect(cf.totalInvesting).toBe("-2000");
    expect(cf.totalOperating).toBe("1100");
    expect(cf.netChangeInCash).toBe("4100"); // 5000 − 2000 + 1100
    expect(cf.consistent).toBe(true); // equals the cash ledger movement
    expect(cf.financing.find((l) => l.account === "3000")?.amount).toBe("5000");
    expect(cf.investing.find((l) => l.account === "1500")?.amount).toBe("-2000");
  });

  it("category heuristic maps debt/equity→financing, PPE→investing, rest→operating", () => {
    expect(cashFlowCategory("3000", "equity")).toBe("financing");
    expect(cashFlowCategory("2700", "liability")).toBe("financing");
    expect(cashFlowCategory("1500", "asset")).toBe("investing");
    expect(cashFlowCategory("1100", "asset")).toBe("operating"); // AR working capital
    expect(cashFlowCategory("4000", "revenue")).toBe("operating");
  });
});

describe("budget vs actual", () => {
  let e: any;
  beforeEach(async () => {
    e = new MockEtzhayyim({ did: OWNER });
    await seedChartOfAccounts(e);
  });

  it("reports variance of actual against budget (upsert re-budgets)", async () => {
    expect((await setBudget(e, { account: "4000", period: "2026-FY", amount: "1200" })).status).toBe("set");
    await setBudget(e, { account: "5000", period: "2026-FY", amount: "400" });
    expect((await setBudget(e, { account: "4000", period: "2026-FY", amount: "1500" })).status).toBe("set"); // re-budget
    expect((await listBudgets(e, { period: "2026-FY" })).length).toBe(2); // upsert, not duplicated
    expect((await setBudget(e, { account: "4000", period: "2026-FY", amount: "x" })).status).toBe("rejected");

    // actuals: revenue 1000 via AR sale (net)
    await createSalesOrder(e, { number: "SO-1", customer: "Acme", total: "1100", status: "confirmed" });
    await invoiceSalesOrder(e, { number: "SO-1", tax: "100" });
    await postInvoice(e, { number: "SO-1-INV" });

    const v = await budgetVarianceReport(e, { period: "2026-FY" });
    const rev = v.rows.find((r) => r.account === "4000")!;
    expect(rev.budget).toBe("1500");
    expect(rev.actual).toBe("1000"); // natural revenue presentation
    expect(rev.variance).toBe("-500"); // under budget
    const exp = v.rows.find((r) => r.account === "5000")!;
    expect(exp.actual).toBe("0"); // no expense yet
    expect(exp.variance).toBe("-400");
    expect(v.totalBudget).toBe("1900");
    expect(v.totalActual).toBe("1000");
    expect(v.totalVariance).toBe("-900");
  });
});
