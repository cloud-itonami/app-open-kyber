import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  registerTenant,
  seedChartOfAccounts, listAccounts,
  registerParty, creditCheck,
  registerInventoryItem, receiveStock, issueStock, stockValuation,
  createSalesOrder, invoiceSalesOrder, postInvoice, recordPayment,
  createPurchaseOrder, receivePurchaseOrder, billPurchaseOrder,
  registerFixedAsset, runDepreciation, assetRegister,
  setTaxCode, taxReport,
  getTrialBalance, incomeStatement, balanceSheet, cashFlowStatement,
  closePeriod, erpCoverage,
} from "../src/index.js";

/**
 * Full cross-module scenario: a manufacturer is onboarded, runs a quarter of operations
 * (sales, procurement, inventory, fixed assets, tax), produces the financial statements,
 * and closes the period — proving every module composes on the one Datom log.
 */
describe("open-kyber ERP — end-to-end integration", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: "did:web:kyber.etzhayyim.com" });
  });

  it("onboards a manufacturer and runs a full accounting cycle", async () => {
    // 1. Onboard tenant (ISIC 2910 → manufacturing pack C + C29) + industry chart of accounts
    const tenant = await registerTenant(e, { name: "Nagi Motors", rootDid: "did:web:nagi.example", isicCodes: ["2910"] });
    expect(tenant.activePacks).toEqual(expect.arrayContaining(["pack/C", "pack/C29"]));
    await seedChartOfAccounts(e, { isicCodes: ["2910"] });
    const accts = await listAccounts(e);
    expect(accts.items.some((a) => a.accountCode === "1220")).toBe(true); // WIP from the C pack

    // 2. Tax codes
    await setTaxCode(e, { code: "JP-STD", name: "Standard 10%", ratePct: "10", jurisdiction: "JP" });

    // 3. Customer with a credit limit
    await registerParty(e, { partyId: "Acme", name: "Acme Corp", kind: "customer", creditLimit: "5000" });

    // 4. Inventory: receive raw materials, value moves at moving average
    await registerInventoryItem(e, { sku: "STEEL", name: "Steel coil", uom: "ton", qty: "0", unitCost: "0" });
    await receiveStock(e, { sku: "STEEL", qty: "10", unitCost: "100" });
    await receiveStock(e, { sku: "STEEL", qty: "10", unitCost: "120" }); // avg → 110
    await issueStock(e, { sku: "STEEL", qty: "5" }); // to production
    expect((await stockValuation(e)).totalValue).toBe("1650"); // 15 × 110

    // 5. Procurement: PO → receive → bill → post AP (Dr Expense 500 / Cr AP 500)
    await createPurchaseOrder(e, { number: "PO-1", supplier: "SteelCo", total: "500", status: "sent" });
    await receivePurchaseOrder(e, { number: "PO-1" });
    await billPurchaseOrder(e, { number: "PO-1" });
    await postInvoice(e, { number: "PO-1-BILL" });

    // 6. Sales: credit check → SO → invoice → post AR → collect
    const credit = await creditCheck(e, { party: "Acme", additionalAmount: "1100" });
    expect(credit.withinLimit).toBe(true);
    await createSalesOrder(e, { number: "SO-1", customer: "Acme", total: "1100", status: "confirmed" });
    await invoiceSalesOrder(e, { number: "SO-1", tax: "100" }); // sets AR-style invoice
    await postInvoice(e, { number: "SO-1-INV", taxAccount: "2800" }); // Dr AR 1100 / Cr Rev 1000 / Cr Tax 100
    await recordPayment(e, { invoiceNumber: "SO-1-INV" }); // Dr Cash 1100 / Cr AR 1100

    // 7. Fixed asset + one depreciation period
    await registerFixedAsset(e, { tag: "PRESS-1", name: "Stamping press", cost: "1200", salvage: "0", lifeMonths: 12 });
    await runDepreciation(e, { tag: "PRESS-1", periodIndex: 1 }); // 100/mo (not yet journalized in this scenario)
    const reg = await assetRegister(e);
    expect(reg.rows[0].accumulatedDepreciation).toBe("100");
    expect(reg.rows[0].netBookValue).toBe("1100");

    // 8. Tax report: output 100 (sale), input 0 (the AP bill carried no tax here)
    const tax = await taxReport(e);
    expect(tax.totalOutputTax).toBe("100");
    expect(tax.netTaxPayable).toBe("100");

    // 9. Statements BEFORE close — books balance across every posted module
    const tb = await getTrialBalance(e);
    expect(tb.balanced).toBe(true);
    const is = await incomeStatement(e);
    expect(is.totalRevenue).toBe("1000");
    expect(is.totalExpense).toBe("500"); // the AP bill expense
    expect(is.netIncome).toBe("500");
    const bs = await balanceSheet(e);
    expect(bs.balanced).toBe(true);
    const cf = await cashFlowStatement(e);
    // Cash in 1100 (collection) − 500 (AP payment not made; only billed) → only the collection moved cash
    expect(cf.netChangeInCash).toBe("1100");
    expect(cf.consistent).toBe(true);

    // 10. Coverage across modules
    const cov = await erpCoverage(e);
    expect(cov.apqcL1Active).toEqual(expect.arrayContaining(["3.0", "4.0", "5.0", "9.0", "10.0"]));

    // 11. Period close → P&L zeroes, equity holds the 500 net income, books stay balanced
    const close = await closePeriod(e, { period: "2026-Q1" });
    expect(close.status).toBe("closed");
    expect(close.netIncome).toBe("500");
    const isAfter = await incomeStatement(e);
    expect(isAfter.netIncome).toBe("0");
    const bsAfter = await balanceSheet(e);
    expect(bsAfter.equity.find((x) => x.account === "3200")?.amount).toBe("500");
    expect(bsAfter.balanced).toBe(true);
    expect((await getTrialBalance(e)).balanced).toBe(true);
  });
});
