import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  seedChartOfAccounts,
  createInvoice, listInvoices, postInvoice,
  recordPayment, listPayments,
  getTrialBalance, cashFlowStatement,
} from "../src/index.js";

const OWNER = "did:web:kyber.etzhayyim.com";

describe("payment application (invoice → cash settlement → GL)", () => {
  let e: any;
  beforeEach(async () => {
    e = new MockEtzhayyim({ did: OWNER });
    await seedChartOfAccounts(e);
  });

  it("collects a receivable in full: Dr Cash / Cr AR, AR nets to zero, status paid", async () => {
    await createInvoice(e, { number: "AR-1", direction: "receivable", party: "Acme", amount: "1000" });
    await postInvoice(e, { number: "AR-1" }); // Dr AR 1000 / Cr Revenue 1000
    const pay = await recordPayment(e, { invoiceNumber: "AR-1" }); // full
    expect(pay.status).toBe("applied");
    expect(pay.invoiceStatus).toBe("paid");
    expect(pay.outstanding).toBe("0");

    const tb = await getTrialBalance(e);
    expect(tb.balanced).toBe(true);
    expect(tb.rows.find((r) => r.account === "1100")?.net).toBe("0"); // AR cleared
    expect(tb.rows.find((r) => r.account === "1000")?.net).toBe("1000"); // Cash in
    // cash flow: operating inflow from AR collection
    const cf = await cashFlowStatement(e);
    expect(cf.netChangeInCash).toBe("1000");
    expect(cf.totalOperating).toBe("1000");

    const inv = await listInvoices(e);
    expect((inv.items[0] as any).status).toBe("paid");
    expect((await listPayments(e, { invoiceNumber: "AR-1" })).total).toBe(1);
  });

  it("supports partial payments and rejects overpayment", async () => {
    await createInvoice(e, { number: "AR-2", direction: "receivable", party: "Acme", amount: "1000" });
    await postInvoice(e, { number: "AR-2" });
    const p1 = await recordPayment(e, { invoiceNumber: "AR-2", amount: "600" });
    expect(p1.invoiceStatus).toBe("partial");
    expect(p1.outstanding).toBe("400");
    expect((await recordPayment(e, { invoiceNumber: "AR-2", amount: "500" })).error).toBe("overpayment");
    const p2 = await recordPayment(e, { invoiceNumber: "AR-2", amount: "400" });
    expect(p2.invoiceStatus).toBe("paid");
    expect((await recordPayment(e, { invoiceNumber: "AR-2" })).error).toBe("alreadyPaid");
    expect((await listPayments(e, { invoiceNumber: "AR-2" })).total).toBe(2);
  });

  it("pays a payable: Dr AP / Cr Cash (cash out)", async () => {
    await createInvoice(e, { number: "AP-1", direction: "payable", party: "Supplier", amount: "500" });
    await postInvoice(e, { number: "AP-1" }); // Dr Expense 500 / Cr AP 500
    const pay = await recordPayment(e, { invoiceNumber: "AP-1" });
    expect(pay.status).toBe("applied");
    const tb = await getTrialBalance(e);
    expect(tb.balanced).toBe(true);
    expect(tb.rows.find((r) => r.account === "2000")?.net).toBe("0"); // AP cleared
    expect(tb.rows.find((r) => r.account === "1000")?.net).toBe("-500"); // Cash out
  });

  it("rejects payment on unknown invoice", async () => {
    expect((await recordPayment(e, { invoiceNumber: "ghost" })).error).toBe("invoiceNotFound");
  });
});
