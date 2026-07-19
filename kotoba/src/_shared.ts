/**
 * open-kyber kotoba — shared collection helpers (idempotent create + full-scan list).
 * Both the core ERP modules and the productivity suite write plaintext records to kotoba
 * collections through these, so the create/list semantics stay identical everywhere.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";

const PAGE_LIMIT = 100;

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** The sender DID of an SDK instance (the SDK stores it; the type doesn't surface it). */
export function senderDid(e: Etzhayyim): string {
  return (e as unknown as { did?: string }).did ?? "";
}

/** Idempotent create: if the rkey already exists, return it unchanged; else write. */
export async function createUnique<T>(
  e: Etzhayyim,
  collection: string,
  rkey: string,
  record: T,
): Promise<{ created: boolean; uri: string }> {
  const existing = await e
    .read<T>({ collection, rkey })
    .catch(() => ({ records: [] as { uri: string; value: T }[] }));
  if (existing.records[0]?.value) return { created: false, uri: existing.records[0].uri };
  const receipt = await e.write({ collection, record: record as unknown as Record<string, unknown>, rkey });
  return { created: true, uri: receipt.uri };
}

/** Full-scan list with an optional predicate and a result cap. */
export async function listAll<T>(
  e: Etzhayyim,
  collection: string,
  pred?: (v: T) => boolean,
  limit = 200,
): Promise<{ items: Array<T & { uri: string }>; total: number }> {
  const out: Array<T & { uri: string }> = [];
  let cursor: string | undefined;
  while (out.length < 10_000) {
    const page = await e.read<T>({ collection, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) out.push({ ...(r.value as T), uri: r.uri });
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }
  const filtered = pred ? out.filter(pred) : out;
  return { items: filtered.slice(0, limit), total: filtered.length };
}
