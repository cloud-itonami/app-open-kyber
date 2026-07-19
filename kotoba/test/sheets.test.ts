import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  evaluateGrid,
  buildTrialBalanceGrid,
  seedChartOfAccounts, createJournalEntry,
} from "../src/index.js";

describe("sheets formula engine (exact decimal)", () => {
  it("evaluates literals, refs, arithmetic with precedence + parens", () => {
    const r = evaluateGrid({
      A1: { value: "10" },
      A2: { value: "20" },
      B1: { formula: "=A1+A2*2" }, // 10 + 40 = 50
      B2: { formula: "=(A1+A2)*2" }, // 60
      B3: { formula: "=A2/A1" }, // 2
      B4: { formula: "=-A1+5" }, // -5
    });
    expect(r.values.B1).toBe("50");
    expect(r.values.B2).toBe("60");
    expect(r.values.B3).toBe("2");
    expect(r.values.B4).toBe("-5");
    expect(Object.keys(r.errors)).toHaveLength(0);
  });

  it("evaluates SUM/AVG/MIN/MAX/COUNT over ranges", () => {
    const r = evaluateGrid({
      A1: { value: "10" }, A2: { value: "20" }, A3: { value: "30" },
      C1: { formula: "=SUM(A1:A3)" },
      C2: { formula: "=AVG(A1:A3)" },
      C3: { formula: "=MIN(A1:A3)" },
      C4: { formula: "=MAX(A1:A3)" },
      C5: { formula: "=COUNT(A1:A3)" },
      C6: { formula: "=SUM(A1:A3)/COUNT(A1:A3)" },
    });
    expect(r.values.C1).toBe("60");
    expect(r.values.C2).toBe("20");
    expect(r.values.C3).toBe("10");
    expect(r.values.C4).toBe("30");
    expect(r.values.C5).toBe("3");
    expect(r.values.C6).toBe("20");
  });

  it("flags cycles, div-by-zero, and bad references", () => {
    const r = evaluateGrid({
      A1: { formula: "=B1" }, B1: { formula: "=A1" }, // cycle
      C1: { formula: "=1/0" },
      D1: { formula: "=SUM(1,2,," } as any, // parse error (unbalanced)
    });
    expect(r.errors.A1).toBe("#CYCLE");
    expect(r.errors.C1).toBe("#DIV/0");
    expect(r.errors.D1).toBe("#PARSE");
  });
});

describe("sheet ↔ ERP binding (trial-balance worksheet)", () => {
  let e: any;
  beforeEach(async () => {
    e = new MockEtzhayyim({ did: "did:web:kyber.etzhayyim.com" });
    await seedChartOfAccounts(e);
  });

  it("computes the trial-balance totals via the sheets engine over live ledger data", async () => {
    await createJournalEntry(e, { number: "JE-1", lines: [
      { account: "1000", debit: "1000", credit: "0" },
      { account: "4000", debit: "0", credit: "1000" },
    ] });
    await createJournalEntry(e, { number: "JE-2", lines: [
      { account: "1200", debit: "250.50", credit: "0" },
      { account: "2000", debit: "0", credit: "250.50" },
    ] });

    const out = await buildTrialBalanceGrid(e);
    const debitTotal = out.evaluated.values[out.totals.debit];
    const creditTotal = out.evaluated.values[out.totals.credit];
    expect(debitTotal).toBe("1250.5"); // SUM of the debit column, computed by the engine
    expect(creditTotal).toBe("1250.5");
    expect(debitTotal).toBe(creditTotal); // balanced trial balance, rendered as a sheet
    expect(out.rowCount).toBe(4);
    expect(Object.keys(out.evaluated.errors)).toHaveLength(0);
  });
});
