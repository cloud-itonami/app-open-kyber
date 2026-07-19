/**
 * open-kyber kotoba — TENANT registration + ISIC pack activation (ADR-2606037200 D3).
 *
 * Closes the ISIC story end-to-end: a tenant declares its ISIC Rev.4 activity codes, the
 * loader (isic-packs.resolvePacks) maps them to the matching section + division packs, and
 * the resolved set is PERSISTED as :erp.tenant/active-packs. Records created thereafter can
 * be stamped with those pack ids (:erp/isic-pack) for per-industry coverage + compliance.
 *
 * registerTenant is an UPSERT (re-declaring ISIC codes re-resolves the active packs) so a
 * tenant can pivot industries without orphaning the row. Plaintext collection (a tenant's
 * declared industry + base currency are not PII).
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import { slug } from "./_shared.js";
import { resolvePacks } from "./isic-packs.js";

export const TENANT_COLLECTION = "com.etzhayyim.apps.openKyber.tenant";

export interface TenantRecord {
  /** tenant root DID (e.g. did:web:kyber.etzhayyim.com). */
  did: string;
  name: string;
  /** declared ISIC Rev.4 activity codes (2/3/4-digit). */
  isicCodes: string[];
  /** resolved pack ids, sections first then division packs (derived from isicCodes). */
  activePacks: string[];
  baseCurrency: string;
  createdAt: string;
  updatedAt: string;
}
export interface TenantView extends TenantRecord {
  uri: string;
}

export interface RegisterTenantInput {
  rootDid: string;
  name: string;
  isicCodes?: string[];
  baseCurrency?: string;
}
export interface RegisterTenantOutput {
  status: "registered" | "updated" | "rejected";
  uri?: string;
  rootDid?: string;
  activePacks?: string[];
  /** per-code resolution diagnostics (unknown codes reported with empty packIds). */
  resolution?: ReturnType<typeof resolvePacks>["perCode"];
  error?: string;
}

function tenantRkey(rootDid: string): string {
  return `tn-${slug(rootDid)}`;
}

export async function registerTenant(e: Etzhayyim, input: RegisterTenantInput): Promise<RegisterTenantOutput> {
  if (!input.rootDid || !input.name) return { status: "rejected", error: "missingRequiredFields" };
  if (!input.rootDid.startsWith("did:")) return { status: "rejected", error: "invalidRootDid" };

  const isicCodes = input.isicCodes ?? [];
  const resolved = resolvePacks(isicCodes);
  const rkey = tenantRkey(input.rootDid);
  const existing = await e
    .read<TenantRecord>({ collection: TENANT_COLLECTION, rkey })
    .catch(() => ({ records: [] as { uri: string; value: TenantRecord }[] }));
  const prev = existing.records[0]?.value;

  const now = new Date().toISOString();
  const record: TenantRecord = {
    did: input.rootDid,
    name: input.name,
    isicCodes,
    activePacks: resolved.packIds,
    baseCurrency: input.baseCurrency ?? prev?.baseCurrency ?? "JPY",
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };
  const receipt = await e.write({
    collection: TENANT_COLLECTION,
    record: record as unknown as Record<string, unknown>,
    rkey,
  });
  return {
    status: prev ? "updated" : "registered",
    uri: receipt.uri,
    rootDid: input.rootDid,
    activePacks: resolved.packIds,
    resolution: resolved.perCode,
  };
}

export async function getTenant(e: Etzhayyim, input: { rootDid: string }): Promise<{ tenant?: TenantView; error?: string }> {
  if (!input.rootDid) return { error: "missingRootDid" };
  const resp = await e
    .read<TenantRecord>({ collection: TENANT_COLLECTION, rkey: tenantRkey(input.rootDid) })
    .catch(() => ({ records: [] as { uri: string; value: TenantRecord }[] }));
  const r = resp.records[0];
  if (!r?.value) return { error: "notFound" };
  return { tenant: { ...r.value, uri: r.uri } };
}

export async function listTenants(e: Etzhayyim, input: { limit?: number } = {}): Promise<{ items: TenantView[]; total: number }> {
  const limit = Math.min(input.limit ?? 100, 500);
  const resp = await e.read<TenantRecord>({ collection: TENANT_COLLECTION, limit: 100 });
  const items = resp.records.map((r) => ({ ...r.value, uri: r.uri }));
  return { items: items.slice(0, limit), total: items.length };
}
