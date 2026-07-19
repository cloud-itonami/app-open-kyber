/**
 * open-kyber kotoba — ASSET module (kotoba-Datomic, ADR-2606037200; APQC 10.0).
 *
 * Fixed assets + depreciation. Each depreciation period is a NEW fact (a
 * :depreciation-run), accumulating — never an overwrite (非終末論). The schedule math
 * is exact (money.ts BigInt fixed-point) and the final period is adjusted so the sum of
 * charges equals the depreciable base to the cent (no rounding drift).
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import { divMoney, isMoney, mulMoneyInt, subMoney, sumMoney } from "./money.js";
import { OPEN_KYBER_DID_PREFIX } from "./types.js";

export const FIXED_ASSET_COLLECTION = "com.etzhayyim.apps.openKyber.fixedAsset";
export const DEPRECIATION_RUN_COLLECTION = "com.etzhayyim.apps.openKyber.depreciationRun";

export type DepreciationMethod = "straight-line" | "declining-balance" | "units-of-production";

export interface FixedAssetRecord {
  did: string;
  tag: string;
  name: string;
  acquired: string; // ISO
  cost: string; // decimal string
  salvage: string; // decimal string
  lifeMonths: number;
  method: DepreciationMethod;
  currency: string;
  createdAt: string;
}
export interface FixedAssetView extends FixedAssetRecord {
  uri: string;
}
export interface RegisterFixedAssetInput {
  tag: string;
  name: string;
  cost: string;
  salvage?: string;
  lifeMonths: number;
  method?: DepreciationMethod;
  acquired?: string;
  currency?: string;
}
export interface RegisterFixedAssetOutput {
  status: "registered" | "alreadyExists" | "rejected";
  uri?: string;
  tag?: string;
  error?: string;
}

export interface DepreciationRunRecord {
  did: string;
  asset: string; // asset tag
  period: string; // YYYY-MM or a 1-based index label
  periodIndex: number; // 1-based
  amount: string; // charge for the period
  accumulated: string; // accumulated after this run
  currency: string;
  createdAt: string;
}
export interface DepreciationRunView extends DepreciationRunRecord {
  uri: string;
}

const PAGE_LIMIT = 100;
const DEFAULT_MAX_SCAN = 10_000;

function assetRkey(tag: string): string {
  return `fa-${tag.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
function assetDidFor(tag: string): string {
  return `${OPEN_KYBER_DID_PREFIX}fa:${tag.toLowerCase()}`;
}
function runRkey(tag: string, idx: number): string {
  return `dep-${tag.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${String(idx).padStart(4, "0")}`;
}

/**
 * Straight-line schedule (PURE). Returns one charge per month; every month equals
 * round((cost-salvage)/life) except the LAST, which absorbs the rounding remainder so
 * `sum(charges) === cost - salvage` exactly.
 */
export function straightLineSchedule(
  cost: string,
  salvage: string,
  lifeMonths: number,
  dp = 2,
): Array<{ index: number; amount: string; accumulated: string }> {
  if (!isMoney(cost) || !isMoney(salvage)) throw new Error("amounts must be decimal strings");
  if (!Number.isInteger(lifeMonths) || lifeMonths <= 0) throw new Error("lifeMonths must be a positive integer");
  const base = subMoney(cost, salvage);
  if (base.startsWith("-")) throw new Error("salvage exceeds cost");
  const per = divMoney(base, lifeMonths, dp);
  const out: Array<{ index: number; amount: string; accumulated: string }> = [];
  let accum = "0";
  for (let i = 1; i <= lifeMonths; i++) {
    const amount = i < lifeMonths ? per : subMoney(base, mulMoneyInt(per, lifeMonths - 1));
    accum = sumMoney([accum, amount]);
    out.push({ index: i, amount, accumulated: accum });
  }
  return out;
}

/**
 * Declining-balance schedule (PURE). Each period charges `bookValue × (factor / life)`,
 * floored so the book value never drops below salvage (the charge is clamped, and the
 * final periods naturally taper). `factor` 2 = double-declining (default). Exact decimal.
 */
export function decliningBalanceSchedule(
  cost: string,
  salvage: string,
  lifeMonths: number,
  factor = 2,
  dp = 2,
): Array<{ index: number; amount: string; accumulated: string }> {
  if (!isMoney(cost) || !isMoney(salvage)) throw new Error("amounts must be decimal strings");
  if (!Number.isInteger(lifeMonths) || lifeMonths <= 0) throw new Error("lifeMonths must be a positive integer");
  if (!Number.isInteger(factor) || factor <= 0) throw new Error("factor must be a positive integer");
  if (subMoney(cost, salvage).startsWith("-")) throw new Error("salvage exceeds cost");
  const out: Array<{ index: number; amount: string; accumulated: string }> = [];
  let accum = "0";
  for (let i = 1; i <= lifeMonths; i++) {
    const bookBegin = subMoney(cost, accum); // cost − accumulated
    const depreciableLeft = subMoney(bookBegin, salvage); // cannot depreciate below salvage
    let amount: string;
    if (depreciableLeft.startsWith("-") || depreciableLeft === "0") {
      amount = "0";
    } else if (i === lifeMonths) {
      // final period trues-up the remaining book value down to salvage (DB→SL switch),
      // so the asset is fully depreciated to salvage by end of life.
      amount = depreciableLeft;
    } else {
      amount = divMoney(mulMoneyInt(bookBegin, factor), lifeMonths, dp); // bookBegin × factor/life
      // clamp so the charge never carries book value below salvage
      if (!subMoney(amount, depreciableLeft).startsWith("-")) amount = depreciableLeft;
    }
    accum = sumMoney([accum, amount]);
    out.push({ index: i, amount, accumulated: accum });
  }
  return out;
}

export async function registerFixedAsset(
  e: Etzhayyim,
  input: RegisterFixedAssetInput,
): Promise<RegisterFixedAssetOutput> {
  if (!input.tag || !input.name) return { status: "rejected", error: "missingRequiredFields" };
  if (!isMoney(input.cost)) return { status: "rejected", error: "invalidCost" };
  const salvage = input.salvage ?? "0";
  if (!isMoney(salvage)) return { status: "rejected", error: "invalidSalvage" };
  if (!Number.isInteger(input.lifeMonths) || input.lifeMonths <= 0) {
    return { status: "rejected", error: "invalidLifeMonths" };
  }
  if (subMoney(input.cost, salvage).startsWith("-")) return { status: "rejected", error: "salvageExceedsCost" };

  const rkey = assetRkey(input.tag);
  const existing = await e
    .read<FixedAssetRecord>({ collection: FIXED_ASSET_COLLECTION, rkey })
    .catch(() => ({ records: [] as { uri: string; value: FixedAssetRecord }[] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", uri: existing.records[0].uri, tag: input.tag };
  }
  const record: FixedAssetRecord = {
    did: assetDidFor(input.tag),
    tag: input.tag,
    name: input.name,
    acquired: input.acquired ?? new Date().toISOString(),
    cost: input.cost,
    salvage,
    lifeMonths: input.lifeMonths,
    method: input.method ?? "straight-line",
    currency: input.currency ?? "JPY",
    createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({
    collection: FIXED_ASSET_COLLECTION,
    record: record as unknown as Record<string, unknown>,
    rkey,
  });
  return { status: "registered", uri: receipt.uri, tag: input.tag };
}

export async function listFixedAssets(
  e: Etzhayyim,
  input: { limit?: number } = {},
): Promise<{ items: FixedAssetView[]; total: number }> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<FixedAssetRecord>({ collection: FIXED_ASSET_COLLECTION, limit: PAGE_LIMIT });
  const items = resp.records.map((r) => ({ ...r.value, uri: r.uri }));
  return { items: items.slice(0, limit), total: items.length };
}

/**
 * Run depreciation for one period of an asset. Idempotent per (tag, periodIndex):
 * re-running the same period is a no-op. Straight-line and declining-balance supported;
 * units-of-production needs per-period usage input (deferred). Each run is a new
 * accumulating fact.
 */
export async function runDepreciation(
  e: Etzhayyim,
  input: { tag: string; periodIndex: number; period?: string },
): Promise<{ status: "posted" | "alreadyRun" | "rejected"; run?: DepreciationRunView; error?: string }> {
  if (!input.tag) return { status: "rejected", error: "missingTag" };
  if (!Number.isInteger(input.periodIndex) || input.periodIndex <= 0) {
    return { status: "rejected", error: "invalidPeriodIndex" };
  }
  const assetResp = await e
    .read<FixedAssetRecord>({ collection: FIXED_ASSET_COLLECTION, rkey: assetRkey(input.tag) })
    .catch(() => ({ records: [] as { uri: string; value: FixedAssetRecord }[] }));
  const asset = assetResp.records[0]?.value;
  if (!asset) return { status: "rejected", error: "assetNotFound" };
  if (asset.method === "units-of-production") return { status: "rejected", error: "unitsOfProductionNeedsUsageInput" };
  if (input.periodIndex > asset.lifeMonths) return { status: "rejected", error: "periodBeyondLife" };

  const rkey = runRkey(input.tag, input.periodIndex);
  const existing = await e
    .read<DepreciationRunRecord>({ collection: DEPRECIATION_RUN_COLLECTION, rkey })
    .catch(() => ({ records: [] as { uri: string; value: DepreciationRunRecord }[] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyRun", run: { ...existing.records[0].value, uri: existing.records[0].uri } };
  }

  const schedule = asset.method === "declining-balance"
    ? decliningBalanceSchedule(asset.cost, asset.salvage, asset.lifeMonths)
    : straightLineSchedule(asset.cost, asset.salvage, asset.lifeMonths);
  const row = schedule[input.periodIndex - 1];
  const record: DepreciationRunRecord = {
    did: `${assetDidFor(input.tag)}:p${input.periodIndex}`,
    asset: input.tag,
    period: input.period ?? `P${String(input.periodIndex).padStart(4, "0")}`,
    periodIndex: input.periodIndex,
    amount: row.amount,
    accumulated: row.accumulated,
    currency: asset.currency,
    createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({
    collection: DEPRECIATION_RUN_COLLECTION,
    record: record as unknown as Record<string, unknown>,
    rkey,
  });
  return { status: "posted", run: { ...record, uri: receipt.uri } };
}

export async function listDepreciationRuns(
  e: Etzhayyim,
  input: { tag?: string; limit?: number } = {},
): Promise<{ items: DepreciationRunView[]; total: number }> {
  const limit = Math.min(input.limit ?? 200, 1000);
  const out: DepreciationRunView[] = [];
  let cursor: string | undefined;
  while (out.length < DEFAULT_MAX_SCAN) {
    const page = await e.read<DepreciationRunRecord>({
      collection: DEPRECIATION_RUN_COLLECTION,
      cursor,
      limit: PAGE_LIMIT,
    });
    for (const r of page.records) out.push({ ...r.value, uri: r.uri });
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }
  const filtered = out.filter((r) => !input.tag || r.asset === input.tag);
  return { items: filtered.slice(0, limit), total: filtered.length };
}
