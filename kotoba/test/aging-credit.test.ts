import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  createInvoice, postInvoice, recordPayment, seedChartOfAccounts,
  registerParty, setCreditLimit, getParty,
  arAging, creditCheck,
} from "../src/index.js";

const OWNER = "did:web:kyber.etzhayyim.com";

describe("AR aging report", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: OWNER });
  });

  it("buckets open receivables by days past due, nets paid amounts", async () => {
    // asOf 2026-06-30. due dates put invoices in different buckets.
    await createInvoice(e, { number: "AR-current", direction: "receivable", party: "Acme", amount: "100", due: "2026-07-15" });
    await createInvoice(e, { number: "AR-30", direction: "receivable", party: "Acme", amount: "200", due: "2026-06-10" }); // 20 days
    await createInvoice(e, { number: "AR-90p", direction: "receivable", party: "Beta", amount: "300", due: "2026-01-01" }); // >90
    await createInvoice(e, { number: "AR-paid", direction: "receivable", party: "Acme", amount: "400", due: "2026-05-01" });
    await seedChartOfAccounts(e);
    await postInvoice(e, { number: "AR-paid" });
    await recordPayment(e, { invoiceNumber: "AR-paid" }); // fully paid → excluded

    const r = await arAging(e, { asOf: "2026-06-30" });
    expect(r.byBucket.current).toBe("100");
    expect(r.byBucket["1-30"]).toBe("200");
    expect(r.byBucket["90+"]).toBe("300");
    expect(r.totalOutstanding).toBe("600"); // paid invoice excluded
    expect(r.byParty.Acme).toBe("300");
    expect(r.byParty.Beta).toBe("300");
    expect(r.lines.find((l) => l.number === "AR-30")?.daysOverdue).toBe(20);
  });
});

describe("party master + credit-limit check", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: OWNER });
  });

  it("registers a party, sets a credit limit, and checks exposure", async () => {
    expect((await registerParty(e, { partyId: "Acme", name: "Acme Corp", kind: "customer", creditLimit: "1000" })).status).toBe("registered");
    expect((await registerParty(e, { partyId: "Acme", name: "dup" })).status).toBe("alreadyExists");
    expect((await getParty(e, { partyId: "Acme" }))?.creditLimit).toBe("1000");

    await createInvoice(e, { number: "AR-1", direction: "receivable", party: "Acme", amount: "600" });
    const c1 = await creditCheck(e, { party: "Acme" });
    expect(c1.outstanding).toBe("600");
    expect(c1.available).toBe("400");
    expect(c1.withinLimit).toBe(true);

    // a proposed new order of 500 would breach the 1000 limit (600 + 500 = 1100)
    const c2 = await creditCheck(e, { party: "Acme", additionalAmount: "500" });
    expect(c2.exposure).toBe("1100");
    expect(c2.withinLimit).toBe(false);

    // raise the limit → now within
    await setCreditLimit(e, { partyId: "Acme", creditLimit: "2000" });
    expect((await creditCheck(e, { party: "Acme", additionalAmount: "500" })).withinLimit).toBe(true);
  });

  it("treats a party with no limit (or unknown) as unlimited", async () => {
    await createInvoice(e, { number: "AR-1", direction: "receivable", party: "NoLimit", amount: "9999" });
    const c = await creditCheck(e, { party: "NoLimit" });
    expect(c.limit).toBeNull();
    expect(c.available).toBeNull();
    expect(c.withinLimit).toBe(true);
  });
});
