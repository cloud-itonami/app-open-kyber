import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  setTaxCode, listTaxCodes, taxReport,
  createInvoice,
} from "../src/index.js";

const OWNER = "did:web:kyber.etzhayyim.com";

describe("tax codes + consumption-tax / VAT report", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: OWNER });
  });

  it("registers tax codes (upsert / re-rate)", async () => {
    expect((await setTaxCode(e, { code: "JP-STD", name: "Standard 10%", ratePct: "10", jurisdiction: "JP" })).status).toBe("set");
    await setTaxCode(e, { code: "JP-RED", name: "Reduced 8%", ratePct: "8", jurisdiction: "JP" });
    expect((await setTaxCode(e, { code: "JP-STD", name: "x", ratePct: "bad" })).status).toBe("rejected");
    await setTaxCode(e, { code: "JP-STD", name: "Standard 10%", ratePct: "10" }); // re-rate, upsert
    expect((await listTaxCodes(e)).length).toBe(2);
  });

  it("rolls up output vs input tax into net tax payable, by code and currency", async () => {
    // sales: 2 receivable invoices (gross / tax) → output tax
    await createInvoice(e, { number: "AR-1", direction: "receivable", party: "Acme", amount: "1100", tax: "100", taxCode: "JP-STD" });
    await createInvoice(e, { number: "AR-2", direction: "receivable", party: "Beta", amount: "1080", tax: "80", taxCode: "JP-RED" });
    // purchases: 1 payable invoice → input tax
    await createInvoice(e, { number: "AP-1", direction: "payable", party: "Sup", amount: "550", tax: "50", taxCode: "JP-STD" });
    // a foreign-currency sale (separate currency bucket)
    await createInvoice(e, { number: "AR-USD", direction: "receivable", party: "US Co", amount: "210", tax: "10", taxCode: "US-STD", currency: "USD" });

    const r = await taxReport(e);
    expect(r.totalOutputTax).toBe("190"); // 100 + 80 + 10
    expect(r.totalInputTax).toBe("50");
    expect(r.netTaxPayable).toBe("140"); // 190 − 50

    // per-currency (no cross-currency sum)
    expect(r.byCurrency.JPY.outputTax).toBe("180");
    expect(r.byCurrency.JPY.inputTax).toBe("50");
    expect(r.byCurrency.JPY.net).toBe("130");
    expect(r.byCurrency.USD.outputTax).toBe("10");
    expect(r.byCurrency.USD.net).toBe("10");

    // taxable base by code (amount − tax)
    const std = r.rows.find((x) => x.taxCode === "JP-STD" && x.currency === "JPY")!;
    expect(std.outputBase).toBe("1000"); // 1100 − 100
    expect(std.outputTax).toBe("100");
    expect(std.inputBase).toBe("500"); // 550 − 50
    expect(std.inputTax).toBe("50");
    const red = r.rows.find((x) => x.taxCode === "JP-RED")!;
    expect(red.outputBase).toBe("1000"); // 1080 − 80
  });

  it("untagged invoices fall under the default code", async () => {
    await createInvoice(e, { number: "AR-x", direction: "receivable", party: "p", amount: "110", tax: "10" });
    const r = await taxReport(e, { defaultCode: "DEFAULT" });
    expect(r.rows[0].taxCode).toBe("DEFAULT");
    expect(r.totalOutputTax).toBe("10");
  });
});
