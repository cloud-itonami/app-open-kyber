/**
 * open-kyber kotoba — fixed-asset REGISTER / book-value roll-forward (ADR-2606037200 D2).
 * Per-asset cost → accumulated depreciation (from the depreciation-run Datoms) → net book
 * value, with fleet totals. The classic asset schedule that supports the PP&E note.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import { subMoney, sumMoney } from "./money.js";
import { listFixedAssets, listDepreciationRuns, type DepreciationMethod } from "./assets.js";

export interface AssetRegisterRow {
  tag: string;
  name: string;
  method: DepreciationMethod;
  lifeMonths: number;
  cost: string;
  accumulatedDepreciation: string;
  netBookValue: string;
  periodsRun: number;
  fullyDepreciated: boolean;
}
export interface AssetRegisterOutput {
  rows: AssetRegisterRow[];
  totalCost: string;
  totalAccumulated: string;
  totalNetBookValue: string;
}

export async function assetRegister(e: Etzhayyim): Promise<AssetRegisterOutput> {
  const assets = await listFixedAssets(e, { limit: 100_000 });
  const allRuns = await listDepreciationRuns(e, { limit: 1_000_000 });
  const runsByTag = new Map<string, { amounts: string[]; count: number }>();
  for (const r of allRuns.items) {
    const g = runsByTag.get(r.asset) ?? { amounts: [], count: 0 };
    g.amounts.push(r.amount);
    g.count += 1;
    runsByTag.set(r.asset, g);
  }

  const rows: AssetRegisterRow[] = assets.items.map((a) => {
    const g = runsByTag.get(a.tag) ?? { amounts: [], count: 0 };
    const accumulated = sumMoney(g.amounts.length ? g.amounts : ["0"]);
    const netBookValue = subMoney(a.cost, accumulated);
    return {
      tag: a.tag,
      name: a.name,
      method: a.method,
      lifeMonths: a.lifeMonths,
      cost: a.cost,
      accumulatedDepreciation: accumulated,
      netBookValue,
      periodsRun: g.count,
      fullyDepreciated: subMoney(netBookValue, a.salvage).startsWith("-") || netBookValue === a.salvage,
    };
  });

  return {
    rows,
    totalCost: sumMoney(rows.map((r) => r.cost)),
    totalAccumulated: sumMoney(rows.map((r) => r.accumulatedDepreciation)),
    totalNetBookValue: sumMoney(rows.map((r) => r.netBookValue)),
  };
}
