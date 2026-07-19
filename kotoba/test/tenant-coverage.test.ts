import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  registerTenant, getTenant, listTenants,
  erpCoverage,
  createAccount, registerIntegration, registerEmployee,
  createJournalEntry, createInvoice, registerInventoryItem, createSalesOrder,
  createPurchaseOrder, registerFixedAsset, runDepreciation,
  registerPolicyControl, recordRiskIssue,
  sendMail, putDriveNode, putDoc, putSheet, createCalendarEvent,
} from "../src/index.js";

const OWNER = "did:web:kyber.etzhayyim.com";

describe("tenant registration + ISIC pack activation (end-to-end)", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: OWNER });
  });

  it("declares ISIC codes → resolves + persists active packs; upsert re-resolves", async () => {
    const auto = await registerTenant(e, { name: "Acme Motors", rootDid: "did:web:acme.example", isicCodes: ["2910"] });
    expect(auto.status).toBe("registered");
    expect(auto.activePacks).toContain("pack/C");
    expect(auto.activePacks).toContain("pack/C29");

    const got = await getTenant(e, { rootDid: "did:web:acme.example" });
    expect(got.tenant?.activePacks).toEqual(auto.activePacks);
    expect(got.tenant?.isicCodes).toEqual(["2910"]);

    // pivot industries → upsert re-resolves (now a bank)
    const pivot = await registerTenant(e, { name: "Acme Capital", rootDid: "did:web:acme.example", isicCodes: ["6419"] });
    expect(pivot.status).toBe("updated");
    expect(pivot.activePacks).toContain("pack/K");
    expect(pivot.activePacks).toContain("pack/K64");
    expect(pivot.activePacks).not.toContain("pack/C29");

    expect((await listTenants(e)).total).toBe(1); // same rootDid, upserted in place
  });

  it("validates root DID + reports unknown codes", async () => {
    expect((await registerTenant(e, { name: "x", rootDid: "not-a-did" })).status).toBe("rejected");
    const r = await registerTenant(e, { name: "Mixed", rootDid: "did:web:mix.example", isicCodes: ["0111", "zzz"] });
    expect(r.activePacks).toContain("pack/A");
    expect(r.resolution?.find((c) => c.code === "zzz")?.packIds).toEqual([]);
  });

  it("tenant with no ISIC codes → generic base (no packs)", async () => {
    const r = await registerTenant(e, { name: "Generic", rootDid: "did:web:gen.example" });
    expect(r.activePacks).toEqual([]);
  });
});

describe("all-module coverage rollup (kqe getApqcCoverage replacement)", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: OWNER });
  });

  it("counts every module + suite and reports active APQC L1 categories", async () => {
    await createAccount(e, { accountCode: "1000", name: "Cash", accountType: "asset" });
    await createJournalEntry(e, { number: "JE-1", lines: [
      { account: "1000", debit: "100", credit: "0" },
      { account: "4000", debit: "0", credit: "100" },
    ] });
    await createInvoice(e, { number: "AR-1", direction: "receivable", party: "p", amount: "100" });
    await createPurchaseOrder(e, { number: "PO-1", supplier: "s", total: "50" });
    await registerInventoryItem(e, { sku: "SKU-1", name: "Widget" });
    await createSalesOrder(e, { number: "SO-1", customer: "c", total: "200" });
    await registerFixedAsset(e, { tag: "FA-1", name: "Lathe", cost: "1200", lifeMonths: 12 });
    await runDepreciation(e, { tag: "FA-1", periodIndex: 1 });
    await registerPolicyControl(e, { code: "C-1", title: "ctrl" });
    await recordRiskIssue(e, { issueId: "R-1", title: "risk", severity: "low" });
    await registerIntegration(e, { integrationId: "mailer", name: "mail", category: "productivity" });
    await registerEmployee(e, { employeeId: "E-1", name: "Taro", email: "t@x.com", department: "hr", salary: "1" });
    await registerTenant(e, { name: "T", rootDid: "did:web:t.example", isicCodes: ["2910"] });
    await sendMail(e, { messageId: "m1", to: ["did:web:x"], subject: "s", bodyCid: "cid" });
    await putDriveNode(e, { path: "/f", name: "f", nodeType: "folder" });
    await putDoc(e, { docId: "d1", title: "t", bodyCid: "cid" });
    await putSheet(e, { sheetId: "s1", title: "t", gridCid: "cid" });
    await createCalendarEvent(e, { eventId: "ev1", title: "t", start: "2026-06-30T09:00:00Z", end: "2026-06-30T10:00:00Z" });

    const cov = await erpCoverage(e);
    // every core module present
    for (const k of ["account", "journalEntry", "invoice", "purchaseOrder", "inventoryItem",
      "salesOrder", "fixedAsset", "depreciationRun", "policyControl", "riskIssue",
      "integrationBinding", "employee", "mail", "driveNode", "doc", "sheet", "calendarEvent"]) {
      expect(cov.counts[k]).toBe(1);
    }
    // all 7 APQC L1 categories active (3/4/5/7/9/10/11)
    expect(cov.apqcL1Active).toEqual(["10.0", "11.0", "3.0", "4.0", "5.0", "7.0", "9.0"]);
    // tenant excluded from business total; 17 business records (10 core + integration + employee + 5 suite)
    expect(cov.counts.tenant).toBe(1);
    expect(cov.total).toBe(17);
    expect(cov.truncated).toBe(false);
  });
});
