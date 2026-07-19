import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  setFxRate, getFxRate, convert, listFxRates, invoiceTotalsInBase,
  createInvoice,
} from "../src/index.js";

const OWNER = "did:web:kyber.etzhayyim.com";

describe("multi-currency FX", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: OWNER });
  });

  it("stores rates, resolves direct + inverse, and rejects bad input", async () => {
    expect((await setFxRate(e, { base: "USD", quote: "JPY", rate: "150" })).status).toBe("set");
    expect((await setFxRate(e, { base: "EUR", quote: "EUR", rate: "1" })).status).toBe("rejected"); // same
    expect((await setFxRate(e, { base: "USD", quote: "JPY", rate: "0" })).status).toBe("rejected");

    expect(await getFxRate(e, { from: "USD", to: "JPY" })).toBe("150");
    expect(await getFxRate(e, { from: "JPY", to: "USD" })).toBe("0.00666667"); // inverse 1/150
    expect(await getFxRate(e, { from: "USD", to: "USD" })).toBe("1");
    expect(await getFxRate(e, { from: "USD", to: "GBP" })).toBeNull();
    expect((await listFxRates(e)).length).toBe(1);
  });

  it("converts amounts (rounded) and handles missing rates / same currency", async () => {
    await setFxRate(e, { base: "USD", quote: "JPY", rate: "150" });
    const c = await convert(e, { amount: "10", from: "USD", to: "JPY" });
    expect(c.status).toBe("ok");
    expect(c.amount).toBe("1500");
    expect(c.rate).toBe("150");

    const same = await convert(e, { amount: "42.5", from: "JPY", to: "JPY" });
    expect(same.amount).toBe("42.5");

    const back = await convert(e, { amount: "1500", from: "JPY", to: "USD", dp: 2 });
    expect(back.amount).toBe("10"); // 1500 × (1/150)

    expect((await convert(e, { amount: "10", from: "USD", to: "GBP" })).status).toBe("noRate");
  });

  it("consolidates multi-currency invoices into a base currency", async () => {
    await setFxRate(e, { base: "USD", quote: "JPY", rate: "150" });
    await createInvoice(e, { number: "AR-USD", direction: "receivable", party: "US Co", amount: "100", currency: "USD" });
    await createInvoice(e, { number: "AR-JPY", direction: "receivable", party: "JP Co", amount: "5000", currency: "JPY" });
    await createInvoice(e, { number: "AP-USD", direction: "payable", party: "US Sup", amount: "20", currency: "USD" });
    await createInvoice(e, { number: "AR-GBP", direction: "receivable", party: "UK Co", amount: "80", currency: "GBP" }); // no rate

    const t = await invoiceTotalsInBase(e, { baseCurrency: "JPY" });
    expect(t.receivable).toBe("20000"); // 100×150 + 5000
    expect(t.payable).toBe("3000"); // 20×150
    expect(t.net).toBe("17000");
    expect(t.unconverted).toEqual(["GBP"]); // GBP skipped (no rate)
  });
});
