import { describe, it, expect, beforeEach } from "vitest";
import {
  createXrpcBridge,
  type XrpcRepoClient,
  createAccount, listAccounts,
  createJournalEntry, getTrialBalance,
  createInvoice, listInvoices,
  registerTenant, getTenant,
  erpCoverage,
} from "../src/index.js";

/**
 * In-memory mock of the kotodama-host-sdk XrpcClient AT-repo surface, so we can drive the
 * real kotoba functions THROUGH the bridge and prove the worker wiring contract holds.
 */
class MockXrpc implements XrpcRepoClient {
  private store = new Map<string, Map<string, { uri: string; value: unknown; seq: number }>>();
  private seq = 0;
  constructor(public repo = "did:web:kyber.etzhayyim.com") {}
  async createRecord<T>(collection: string, record: T, rkey?: string) {
    let col = this.store.get(collection);
    if (!col) { col = new Map(); this.store.set(collection, col); }
    const key = rkey ?? `auto-${this.seq}`;
    const uri = `at://${this.repo}/${collection}/${key}`;
    col.set(key, { uri, value: record, seq: this.seq++ });
    return { uri, cid: `cid-${key}` };
  }
  async getRecord<T>(collection: string, rkey: string) {
    const r = this.store.get(collection)?.get(rkey);
    return r ? { uri: r.uri, value: r.value as T } : null;
  }
  async listRecords<T>(collection: string, opts?: { limit?: number; cursor?: string }) {
    const all = [...(this.store.get(collection)?.values() ?? [])].sort((a, b) => a.seq - b.seq);
    const limit = opts?.limit ?? 50;
    return { records: all.slice(0, limit).map((r) => ({ uri: r.uri, value: r.value as T })) };
  }
}

const OWNER = "did:web:kyber.etzhayyim.com";

describe("XrpcClient → Etzhayyim bridge (R2 worker wiring keystone)", () => {
  let e: any;
  beforeEach(() => {
    e = createXrpcBridge(new MockXrpc(OWNER), { did: OWNER });
  });

  it("drives accounting through the bridge (create + dedup + trial balance)", async () => {
    expect((await createAccount(e, { accountCode: "1000", name: "Cash", accountType: "asset" })).status).toBe("created");
    expect((await createAccount(e, { accountCode: "1000", name: "Cash", accountType: "asset" })).status).toBe("alreadyExists");
    await createJournalEntry(e, { number: "JE-1", lines: [
      { account: "1000", debit: "500", credit: "0" },
      { account: "4000", debit: "0", credit: "500" },
    ] });
    const tb = await getTrialBalance(e);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe("500");
    expect((await listAccounts(e)).total).toBe(1);
  });

  it("drives AP/AR + tenant + coverage through the bridge", async () => {
    await createInvoice(e, { number: "AR-1", direction: "receivable", party: "Acme", amount: "1000" });
    expect((await listInvoices(e, { direction: "receivable" })).total).toBe(1);

    const t = await registerTenant(e, { name: "Acme Motors", rootDid: "did:web:acme.example", isicCodes: ["2910"] });
    expect(t.activePacks).toContain("pack/C29");
    expect((await getTenant(e, { rootDid: "did:web:acme.example" })).tenant?.activePacks).toContain("pack/C");

    const cov = await erpCoverage(e);
    expect(cov.counts.invoice).toBe(1);
    expect(cov.apqcL1Active).toContain("9.0");
  });

  it("refuses encrypted ops when no encrypted transport is configured (no silent PII drop)", async () => {
    await expect(e.encryptedWrite({ innerType: "x", record: {}, recipients: [] })).rejects.toThrow(/encrypted transport not configured/);
    await expect(e.encryptedRead({ innerType: "x" })).rejects.toThrow(/encrypted transport not configured/);
  });

  it("delegates encrypted ops when an encrypted transport IS provided", async () => {
    let wrote = false;
    const enc = createXrpcBridge(new MockXrpc(OWNER), {
      did: OWNER,
      encrypted: {
        encryptedWrite: (async () => { wrote = true; return { uri: "at://enc", cid: "c", keyId: "k", keyWraps: [], skipped: [] }; }) as any,
        encryptedRead: (async () => ({ records: [] })) as any,
      },
    });
    await enc.encryptedWrite({ innerType: "x", record: {}, recipients: [] } as any);
    expect(wrote).toBe(true);
    expect((await enc.encryptedRead({ innerType: "x" } as any)).records).toEqual([]);
  });
});
