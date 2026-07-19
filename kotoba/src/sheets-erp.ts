/**
 * open-kyber kotoba — SHEET ↔ ERP binding (ADR-2606037200 D5). Generates a suite `sheet`
 * grid from live ERP Datom-log data, so a financial worksheet's totals are COMPUTED by the
 * sheets formula engine over real ledger figures — the concrete "連携・統合" of the
 * productivity suite with the ERP. `buildTrialBalanceGrid` emits a Debit/Credit grid whose
 * footer SUM() formulas reproduce the trial-balance totals when evaluated.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import { getTrialBalance } from "./accounting.js";
import { evaluateGrid, type Grid, type EvalResult } from "./sheets-eval.js";

export interface TrialBalanceGridOutput {
  grid: Grid;
  evaluated: EvalResult;
  /** addresses of the footer total cells. */
  totals: { debit: string; credit: string };
  rowCount: number;
}

export async function buildTrialBalanceGrid(e: Etzhayyim): Promise<TrialBalanceGridOutput> {
  const tb = await getTrialBalance(e);
  const grid: Grid = {
    A1: { value: "Account" },
    B1: { value: "Debit" },
    C1: { value: "Credit" },
  };
  let row = 2;
  for (const r of tb.rows) {
    grid[`A${row}`] = { value: r.account };
    grid[`B${row}`] = { value: r.debit };
    grid[`C${row}`] = { value: r.credit };
    row++;
  }
  const lastDataRow = row - 1;
  const totalRow = row;
  grid[`A${totalRow}`] = { value: "Total" };
  // footer totals are FORMULAS over the data range — the engine computes them from the grid
  grid[`B${totalRow}`] = { formula: lastDataRow >= 2 ? `=SUM(B2:B${lastDataRow})` : "=0" };
  grid[`C${totalRow}`] = { formula: lastDataRow >= 2 ? `=SUM(C2:C${lastDataRow})` : "=0" };

  return {
    grid,
    evaluated: evaluateGrid(grid),
    totals: { debit: `B${totalRow}`, credit: `C${totalRow}` },
    rowCount: tb.rows.length,
  };
}
