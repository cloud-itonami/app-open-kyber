import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  createJournalEntry,
  listJournalEntries,
  reverseJournalEntry,
  getTrialBalance,
  validateLines,
  sumMoney,
  subMoney,
  eqMoney,
} from "../src/index.js";

const OWNER = "did:web:kyber.etzhayyim.com";

describe("money (exact decimal, no float)", () => {
  it("sums without float error", () => {
    expect(sumMoney(["0.1", "0.2"])).toBe("0.3"); // the classic 0.30000000000000004 trap
    expect(sumMoney(["1000.50", "999.50"])).toBe("2000");
    expect(sumMoney([])).toBe("0");
    expect(subMoney("100", "100")).toBe("0");
    expect(subMoney("100.00", "150")).toBe("-50");
    expect(eqMoney("8000000", "8000000.000")).toBe(true);
  });
});

describe("accounting — double-entry GL (kotoba-Datomic, 非終末論)", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: OWNER });
  });

  const balanced = [
    { account: "1000", debit: "1000", credit: "0" },
    { account: "4000", debit: "0", credit: "1000" },
  ];

  it("validates double-entry balance", () => {
    expect(validateLines(balanced)).toBeNull();
    expect(validateLines([{ account: "1000", debit: "1000", credit: "0" }])).toBe("needAtLeastTwoLines");
    expect(
      validateLines([
        { account: "1000", debit: "1000", credit: "0" },
        { account: "4000", debit: "0", credit: "900" },
      ]),
    ).toBe("unbalanced");
    expect(
      validateLines([
        { account: "1000", debit: "1000", credit: "5" },
        { account: "4000", debit: "0", credit: "995" },
      ]),
    ).toBe("lineHasBothDebitAndCredit");
  });

  it("creates, dedups, lists, filters by status", async () => {
    expect((await createJournalEntry(e, { number: "JE-001", lines: balanced })).status).toBe("posted");
    expect((await createJournalEntry(e, { number: "JE-001", lines: balanced })).status).toBe("alreadyExists");
    expect((await createJournalEntry(e, { number: "JE-bad", lines: [balanced[0]] })).status).toBe("rejected");
    await createJournalEntry(e, { number: "JE-002", lines: balanced, status: "draft" });
    expect((await listJournalEntries(e)).total).toBe(2);
    expect((await listJournalEntries(e, { status: "posted" })).total).toBe(1);
    expect((await listJournalEntries(e, { status: "draft" })).total).toBe(1);
  });

  it("trial balance is balanced and excludes drafts", async () => {
    await createJournalEntry(e, { number: "JE-001", lines: balanced }); // Dr Cash 1000 / Cr Revenue 1000
    await createJournalEntry(e, {
      number: "JE-002",
      lines: [
        { account: "1200", debit: "300.50", credit: "0" },
        { account: "2000", debit: "0", credit: "300.50" },
      ],
    });
    await createJournalEntry(e, { number: "JE-draft", lines: balanced, status: "draft" });
    const tb = await getTrialBalance(e);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe("1300.5");
    expect(tb.totalCredit).toBe("1300.5");
    expect(tb.entriesScanned).toBe(2); // draft excluded
    expect(tb.rows.find((r) => r.account === "1000")?.net).toBe("1000");
    expect(tb.rows.find((r) => r.account === "4000")?.net).toBe("-1000");
  });

  it("reversal asserts a contra entry and nets to zero (non-終末論: original preserved)", async () => {
    await createJournalEntry(e, { entryId: "e1", number: "JE-001", lines: balanced });
    const rev = await reverseJournalEntry(e, { entryId: "e1" });
    expect(rev.status).toBe("reversed");
    expect(rev.reversalEntryId).toBe("e1-rev");

    // Original is preserved (still present) but now marked reversed; contra entry exists.
    const all = await listJournalEntries(e);
    expect(all.total).toBe(2);
    const orig = all.items.find((j) => j.entryId === "e1");
    expect(orig?.status).toBe("reversed");
    expect(orig?.reversedBy).toBe("e1-rev");
    const contra = all.items.find((j) => j.entryId === "e1-rev");
    expect(contra?.reverses).toBe("e1");

    // Books net to zero after reversal.
    const tb = await getTrialBalance(e);
    expect(tb.rows.find((r) => r.account === "1000")?.net).toBe("0");
    expect(tb.rows.find((r) => r.account === "4000")?.net).toBe("0");
    expect(tb.balanced).toBe(true);

    // Cannot reverse twice; cannot reverse unknown.
    expect((await reverseJournalEntry(e, { entryId: "e1" })).error).toBe("alreadyReversed");
    expect((await reverseJournalEntry(e, { entryId: "nope" })).error).toBe("notFound");
  });
});
