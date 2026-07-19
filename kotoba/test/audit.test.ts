import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  seedChartOfAccounts,
  createJournalEntry, reverseJournalEntry,
  createInvoice, postInvoice, recordPayment,
  ledgerAudit,
  JOURNAL_ENTRY_COLLECTION,
} from "../src/index.js";

const OWNER = "did:web:kyber.etzhayyim.com";

describe("ledger integrity audit", () => {
  let e: any;
  beforeEach(async () => {
    e = new MockEtzhayyim({ did: OWNER });
    await seedChartOfAccounts(e);
  });

  it("passes a clean ledger across all checks", async () => {
    await createJournalEntry(e, { entryId: "j1", number: "JE-1", lines: [
      { account: "1000", debit: "500", credit: "0" },
      { account: "4000", debit: "0", credit: "500" },
    ] });
    await reverseJournalEntry(e, { entryId: "j1" });
    await createInvoice(e, { number: "AR-1", direction: "receivable", party: "Acme", amount: "1000" });
    await postInvoice(e, { number: "AR-1" });
    await recordPayment(e, { invoiceNumber: "AR-1", amount: "400" }); // partial, not over-applied

    const audit = await ledgerAudit(e);
    expect(audit.ok).toBe(true);
    expect(audit.issueCount).toBe(0);
    expect(audit.checks.every((c) => c.passed)).toBe(true);
    expect(audit.checks.map((c) => c.name).sort()).toEqual([
      "entries-balance",
      "no-orphan-account-refs",
      "no-over-applied-invoices",
      "reversal-integrity",
      "trial-balance-balances",
    ]);
  });

  it("detects an unbalanced entry and an orphan account ref injected directly", async () => {
    // write a corrupt JE straight to the collection (bypassing validation), as a bad actor would
    await e.write({
      collection: JOURNAL_ENTRY_COLLECTION,
      rkey: "je-bad",
      record: {
        did: "x", entryId: "bad", number: "BAD", date: "2026-06-01T00:00:00Z", status: "posted",
        currency: "JPY", createdAt: "2026-06-01T00:00:00Z",
        lines: [
          { account: "1000", debit: "100", credit: "0" },
          { account: "9999", debit: "0", credit: "90" }, // unbalanced AND orphan account
        ],
      },
    });
    const audit = await ledgerAudit(e);
    expect(audit.ok).toBe(false);
    const balance = audit.checks.find((c) => c.name === "entries-balance")!;
    expect(balance.passed).toBe(false);
    expect(balance.issues[0]).toContain("bad");
    const orphan = audit.checks.find((c) => c.name === "no-orphan-account-refs")!;
    expect(orphan.passed).toBe(false);
    expect(orphan.issues[0]).toContain("9999");
  });
});
