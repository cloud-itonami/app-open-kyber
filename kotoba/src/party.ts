/**
 * open-kyber kotoba — PARTY master (customers / suppliers) with credit limits.
 * ADR-2606037200 D2. A lightweight business-partner register on the kotoba Datom log,
 * the anchor for credit-limit checking (credit.ts) and aging attribution (aging.ts).
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import { isMoney } from "./money.js";
import { OPEN_KYBER_DID_PREFIX } from "./types.js";
import { createUnique, listAll, slug } from "./_shared.js";

export const PARTY_COLLECTION = "com.etzhayyim.apps.openKyber.party";

export type PartyKind = "customer" | "supplier" | "both";

export interface PartyRecord {
  did: string;
  partyId: string;
  name: string;
  kind: PartyKind;
  /** AR exposure ceiling; omitted = unlimited. Decimal string. */
  creditLimit?: string;
  currency: string;
  createdAt: string;
}
export interface PartyView extends PartyRecord {
  uri: string;
}

export interface RegisterPartyInput {
  partyId: string;
  name: string;
  kind?: PartyKind;
  creditLimit?: string;
  currency?: string;
}

export async function registerParty(e: Etzhayyim, input: RegisterPartyInput): Promise<{ status: "registered" | "alreadyExists" | "rejected"; uri?: string; partyId?: string; error?: string }> {
  if (!input.partyId || !input.name) return { status: "rejected", error: "missingRequiredFields" };
  if (input.creditLimit !== undefined && !isMoney(input.creditLimit)) return { status: "rejected", error: "invalidCreditLimit" };
  const record: PartyRecord = {
    did: `${OPEN_KYBER_DID_PREFIX}party:${slug(input.partyId)}`,
    partyId: input.partyId,
    name: input.name,
    kind: input.kind ?? "customer",
    creditLimit: input.creditLimit,
    currency: input.currency ?? "JPY",
    createdAt: new Date().toISOString(),
  };
  const r = await createUnique(e, PARTY_COLLECTION, `party-${slug(input.partyId)}`, record);
  return r.created
    ? { status: "registered", uri: r.uri, partyId: input.partyId }
    : { status: "alreadyExists", uri: r.uri, partyId: input.partyId };
}

/** Set or change a credit limit (upsert; preserves the rest of the record). */
export async function setCreditLimit(e: Etzhayyim, input: { partyId: string; creditLimit: string }): Promise<{ status: "set" | "rejected"; error?: string }> {
  if (!isMoney(input.creditLimit)) return { status: "rejected", error: "invalidCreditLimit" };
  const rkey = `party-${slug(input.partyId)}`;
  const resp = await e.read<PartyRecord>({ collection: PARTY_COLLECTION, rkey }).catch(() => ({ records: [] as { uri: string; value: PartyRecord }[] }));
  const prev = resp.records[0]?.value;
  if (!prev) return { status: "rejected", error: "partyNotFound" };
  await e.write({ collection: PARTY_COLLECTION, record: { ...prev, creditLimit: input.creditLimit } as unknown as Record<string, unknown>, rkey });
  return { status: "set" };
}

export async function getParty(e: Etzhayyim, input: { partyId: string }): Promise<PartyView | null> {
  const resp = await e.read<PartyRecord>({ collection: PARTY_COLLECTION, rkey: `party-${slug(input.partyId)}` }).catch(() => ({ records: [] as { uri: string; value: PartyRecord }[] }));
  const r = resp.records[0];
  return r?.value ? { ...r.value, uri: r.uri } : null;
}

export async function listParties(e: Etzhayyim, input: { kind?: PartyKind; limit?: number } = {}): Promise<{ items: PartyView[]; total: number }> {
  return listAll<PartyRecord>(e, PARTY_COLLECTION, (v) => !input.kind || v.kind === input.kind || v.kind === "both", input.limit);
}
