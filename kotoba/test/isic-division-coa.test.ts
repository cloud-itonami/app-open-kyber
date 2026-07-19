import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  coaExtForPacks, DIVISION_COA_EXT,
  resolvePacks,
  seedChartOfAccounts, listAccounts,
} from "../src/index.js";

const OWNER = "did:web:kyber.etzhayyim.com";

describe("ISIC division-level chart-of-accounts depth", () => {
  it("composes section + division accounts (division-specific accounts added)", () => {
    // pharma (ISIC 21 → section C + division pack/C21)
    const packs = resolvePacks(["2100"]).packIds; // [pack/C, pack/C21]
    expect(packs).toContain("pack/C21");
    const coa = coaExtForPacks(packs);
    const codes = coa.map((a) => a.code);
    // section C accounts present (Raw Materials / WIP / Finished Goods / Overhead)
    expect(codes).toEqual(expect.arrayContaining(["1210", "1220", "1230", "5300"]));
    // division C21 GMP accounts ALSO present
    expect(codes).toEqual(expect.arrayContaining(["1235", "5310"]));
    expect(coa.find((a) => a.code === "5310")?.name).toContain("GMP");
  });

  it("a bank (ISIC 64) gets interbank + customer-deposit accounts on top of section K", () => {
    const coa = coaExtForPacks(resolvePacks(["6419"]).packIds);
    const codes = coa.map((a) => a.code);
    expect(codes).toEqual(expect.arrayContaining(["1900", "2600"])); // section K
    expect(codes).toEqual(expect.arrayContaining(["1910", "2610"])); // division K64
    expect(coa.find((a) => a.code === "2610")?.type).toBe("liability");
  });

  it("every division CoA-ext account has a valid account type", () => {
    const valid = new Set(["asset", "contra-asset", "liability", "equity", "revenue", "expense"]);
    for (const accs of Object.values(DIVISION_COA_EXT)) {
      for (const a of accs) expect(valid.has(a.type)).toBe(true);
    }
  });

  it("seeds the deeper division accounts into the ledger", async () => {
    const e: any = new MockEtzhayyim({ did: OWNER });
    const r = await seedChartOfAccounts(e, { isicCodes: ["2100"] }); // pharma
    expect(r.packAccounts).toEqual(expect.arrayContaining(["1235", "5310"]));
    const accts = await listAccounts(e);
    expect(accts.items.find((a) => a.accountCode === "1235")?.name).toContain("Batch");
  });
});
