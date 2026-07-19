import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  seedChartOfAccounts, BASE_CHART_OF_ACCOUNTS,
  coaExtForPacks,
  listAccounts,
  createInvoice, listInvoices,
  postInvoice,
  getTrialBalance, listJournalEntries,
} from "../src/index.js";

const OWNER = "did:web:kyber.etzhayyim.com";

describe("ISIC-pack-aware chart-of-accounts seeding (industry-tailored ERP)", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: OWNER });
  });

  it("seeds the base IFRS chart (idempotent)", async () => {
    const r = await seedChartOfAccounts(e);
    expect(r.baseSeeded).toBe(BASE_CHART_OF_ACCOUNTS.length);
    expect(r.packSeeded).toBe(0);
    expect((await listAccounts(e)).total).toBe(BASE_CHART_OF_ACCOUNTS.length);
    // re-seed is a no-op
    const r2 = await seedChartOfAccounts(e);
    expect(r2.baseSeeded).toBe(0);
    expect(r2.alreadyExisted).toBe(BASE_CHART_OF_ACCOUNTS.length);
  });

  it("a manufacturer gets Raw Materials / WIP / Finished Goods; a bank gets Loans & Reserves", async () => {
    const mfg = coaExtForPacks(["pack/C"]);
    expect(mfg.map((a) => a.code)).toEqual(["1210", "1220", "1230", "5300"]);

    const r = await seedChartOfAccounts(e, { isicCodes: ["2910"] }); // ISIC 29 → section C
    expect(r.activePacks).toContain("pack/C");
    expect(r.packAccounts).toContain("1220"); // Work in Process
    const accts = await listAccounts(e);
    expect(accts.items.find((a) => a.accountCode === "1230")?.name).toBe("Finished Goods");

    const bank = new MockEtzhayyim({ did: OWNER });
    const rb = await seedChartOfAccounts(bank as any, { isicCodes: ["6419"] }); // ISIC 64 → section K
    expect(rb.packAccounts).toContain("1900"); // Loans & Advances
    expect(rb.packAccounts).toContain("2600"); // Technical Provisions
  });

  it("contra-asset account type is accepted (Accumulated Depreciation)", async () => {
    await seedChartOfAccounts(e);
    const accts = await listAccounts(e, { accountType: "contra-asset" as any });
    expect(accts.items.find((a) => a.accountCode === "1510")?.name).toBe("Accumulated Depreciation");
  });
});

describe("invoice → journal-entry posting (AP/AR ties to the GL)", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: OWNER });
  });

  it("posts a receivable: Dr AR(gross) / Cr Revenue(net) + Cr Tax(tax), balanced", async () => {
    await createInvoice(e, { number: "AR-1", direction: "receivable", party: "Acme", amount: "1100", tax: "100" });
    const r = await postInvoice(e, { number: "AR-1" });
    expect(r.status).toBe("posted");
    expect(r.journalEntryId).toBe("inv-ar-1-je");

    const tb = await getTrialBalance(e);
    expect(tb.balanced).toBe(true);
    expect(tb.rows.find((x) => x.account === "1100")?.debit).toBe("1100"); // AR gross
    expect(tb.rows.find((x) => x.account === "4000")?.credit).toBe("1000"); // Revenue net
    expect(tb.rows.find((x) => x.account === "2800")?.credit).toBe("100"); // Tax

    // invoice now linked to its JE; re-posting is idempotent
    expect((await listInvoices(e)).items[0] as any).toHaveProperty("je", "inv-ar-1-je");
    expect((await postInvoice(e, { number: "AR-1" })).status).toBe("alreadyPosted");
  });

  it("posts a payable: Dr Expense(net) + Dr Tax / Cr AP(gross), balanced", async () => {
    await createInvoice(e, { number: "AP-1", direction: "payable", party: "Supplier", amount: "550", tax: "50" });
    const r = await postInvoice(e, { number: "AP-1" });
    expect(r.status).toBe("posted");
    const tb = await getTrialBalance(e);
    expect(tb.balanced).toBe(true);
    expect(tb.rows.find((x) => x.account === "5000")?.debit).toBe("500"); // Expense net
    expect(tb.rows.find((x) => x.account === "2000")?.credit).toBe("550"); // AP gross
    expect((await listJournalEntries(e)).total).toBe(1);
  });

  it("rejects unknown invoice + tax-exceeds-amount", async () => {
    expect((await postInvoice(e, { number: "ghost" })).error).toBe("invoiceNotFound");
    await createInvoice(e, { number: "BAD", direction: "receivable", party: "p", amount: "100", tax: "200" });
    expect((await postInvoice(e, { number: "BAD" })).error).toBe("taxExceedsAmount");
  });
});
