/**
 * open-kyber kotoba — XrpcClient → Etzhayyim BRIDGE (ADR-2606037200 D1, R2 keystone).
 *
 * The ERP Worker (`etzhayyim-wasm-kyber-erp-kyb3rerp/src/app.ts`) runs on
 * `@etzhayyim/kotodama-host-sdk`, whose `sdk.pds` is an AT-repo XrpcClient
 * (createRecord / getRecord / listRecords). The kotoba reference functions take the
 * `@etzhayyim/sdk` `Etzhayyim` read/write surface. This adapter bridges the two so the
 * worker can DELETE its `createKyselyDb(env.HYPERDRIVE)` read paths (prohibited under
 * ADR-2605262130 — no RisingWave) and route every command through the tested kotoba
 * functions instead, with the kotoba Datom log as the canonical store.
 *
 *   worker cmd handler ── createXrpcBridge(sdk.pds, { did }) ──▶ kotoba fn ──▶ Datom log
 *
 * Plaintext read/write map 1:1 onto the XrpcClient. The E2E employee path (encrypted
 * envelope, ADR-2605181100) is NOT an XrpcClient primitive; pass `encrypted` delegates
 * (the worker already has the @etzhayyim/sdk encrypted client) or leave it unset — the
 * bridge then refuses encrypted ops with a clear error rather than silently dropping PII.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";

/** Minimal AT-repo surface we consume from kotodama-host-sdk's XrpcClient. */
export interface XrpcRepoClient {
  createRecord<T = unknown>(collection: string, record: T, rkey?: string): Promise<{ uri: string; cid?: string }>;
  getRecord<T = unknown>(collection: string, rkey: string, repo?: string): Promise<{ uri: string; value: T } | null>;
  listRecords<T = unknown>(
    collection: string,
    opts?: { limit?: number; cursor?: string; repo?: string },
  ): Promise<{ records: Array<{ uri: string; value: T }>; cursor?: string }>;
}

/** Optional encrypted-envelope delegates (the worker's @etzhayyim/sdk encrypted client). */
export interface EncryptedDelegates {
  encryptedWrite: Etzhayyim["encryptedWrite"];
  encryptedRead: Etzhayyim["encryptedRead"];
}

export interface BridgeOptions {
  /** Acting DID (did:web:kyber.etzhayyim.com or a dept DID). Surfaced as bridge.did. */
  did: string;
  /** Wire the E2E employee path; omit to make encrypted ops throw (no silent PII drop). */
  encrypted?: EncryptedDelegates;
}

/**
 * Adapt an AT-repo XrpcClient to the `Etzhayyim` read/write surface the kotoba functions
 * use. Returns an object usable as the `e` argument to every kotoba function.
 */
export function createXrpcBridge(pds: XrpcRepoClient, opts: BridgeOptions): Etzhayyim {
  const enc = opts.encrypted;
  const bridge = {
    did: opts.did,

    async read<T>(params: { collection: string; rkey?: string; cursor?: string; limit?: number }) {
      if (params.rkey) {
        const view = await pds.getRecord<T>(params.collection, params.rkey);
        return { records: view ? [{ uri: view.uri, value: view.value }] : [] };
      }
      const page = await pds.listRecords<T>(params.collection, { limit: params.limit, cursor: params.cursor });
      return { records: page.records.map((r) => ({ uri: r.uri, value: r.value })), cursor: page.cursor };
    },

    async write(params: { collection: string; record: Record<string, unknown>; rkey?: string }) {
      const ref = await pds.createRecord(params.collection, params.record, params.rkey);
      return { uri: ref.uri };
    },

    async encryptedWrite(...args: Parameters<Etzhayyim["encryptedWrite"]>) {
      if (!enc) throw new Error("xrpc-bridge: encrypted transport not configured (employee E2E path requires `encrypted` delegates)");
      return enc.encryptedWrite(...args);
    },

    async encryptedRead(...args: Parameters<Etzhayyim["encryptedRead"]>) {
      if (!enc) throw new Error("xrpc-bridge: encrypted transport not configured (employee E2E path requires `encrypted` delegates)");
      return enc.encryptedRead(...args);
    },
  };
  // The kotoba functions only touch read / write / encryptedRead / encryptedWrite / did.
  return bridge as unknown as Etzhayyim;
}
