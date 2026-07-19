import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  createInvoice, listInvoices,
  createPurchaseOrder, listPurchaseOrders,
  registerInventoryItem, listInventory,
  createSalesOrder, listSalesOrders,
  registerPolicyControl, listPolicyControls,
  recordRiskIssue, listRiskIssues,
} from "../src/index.js";

const OWNER = "did:web:kyber.etzhayyim.com";

describe("core ERP modules (invoice / PO / inventory / SO / governance)", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: OWNER });
  });

  it("invoice: create, dedup, validate, filter by direction/status", async () => {
    expect((await createInvoice(e, { number: "AR-1", direction: "receivable", party: "Acme", amount: "1000", tax: "100" })).status).toBe("created");
    expect((await createInvoice(e, { number: "AR-1", direction: "receivable", party: "Acme", amount: "1000" })).status).toBe("alreadyExists");
    expect((await createInvoice(e, { number: "X", direction: "bogus" as any, party: "p", amount: "1" })).status).toBe("rejected");
    expect((await createInvoice(e, { number: "Y", direction: "payable", party: "p", amount: "abc" })).status).toBe("rejected");
    await createInvoice(e, { number: "AP-1", direction: "payable", party: "Supplier", amount: "500" });
    expect((await listInvoices(e)).total).toBe(2);
    expect((await listInvoices(e, { direction: "payable" })).total).toBe(1);
  });

  it("purchase order: create, validate total, filter by status", async () => {
    expect((await createPurchaseOrder(e, { number: "PO-1", supplier: "Sup", total: "9999.99", status: "sent" })).status).toBe("created");
    expect((await createPurchaseOrder(e, { number: "PO-2", supplier: "Sup", total: "bad" })).status).toBe("rejected");
    expect((await listPurchaseOrders(e, { status: "sent" })).total).toBe(1);
  });

  it("inventory: register with uom/unspsc, validate qty/cost", async () => {
    expect((await registerInventoryItem(e, { sku: "SKU-1", name: "Widget", uom: "pcs", qty: "100", unitCost: "12.50", unspsc: "31201600" })).status).toBe("registered");
    expect((await registerInventoryItem(e, { sku: "SKU-1", name: "Widget" })).status).toBe("alreadyExists");
    expect((await registerInventoryItem(e, { sku: "SKU-2", name: "Bad", qty: "-5" })).status).toBe("rejected");
    const inv = await listInventory(e);
    expect(inv.total).toBe(1);
    expect(inv.items[0].uom).toBe("pcs");
  });

  it("sales order: create, filter by status", async () => {
    expect((await createSalesOrder(e, { number: "SO-1", customer: "Cust", total: "2500", status: "confirmed" })).status).toBe("created");
    expect((await createSalesOrder(e, { number: "SO-2", customer: "Cust", total: "0" })).status).toBe("created");
    expect((await listSalesOrders(e, { status: "confirmed" })).total).toBe(1);
    expect((await listSalesOrders(e)).total).toBe(2);
  });

  it("governance: policy control + risk issue with severity validation", async () => {
    expect((await registerPolicyControl(e, { code: "JSOX-1", title: "Segregation of duties", framework: "J-SOX" })).status).toBe("registered");
    expect((await listPolicyControls(e, { framework: "J-SOX" })).total).toBe(1);
    expect((await recordRiskIssue(e, { issueId: "R-1", title: "Vendor concentration", severity: "high" })).status).toBe("recorded");
    expect((await recordRiskIssue(e, { issueId: "R-2", title: "Bad sev", severity: "extreme" as any })).status).toBe("rejected");
    expect((await listRiskIssues(e, { severity: "high" })).total).toBe(1);
  });
});
