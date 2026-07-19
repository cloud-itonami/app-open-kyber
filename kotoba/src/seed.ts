/**
 * open-kyber kotoba — chart-of-accounts SEEDING, ISIC-pack-aware (ADR-2606037200 D2+D3).
 *
 * `seedChartOfAccounts` seeds the base IFRS-aligned chart, then — given a tenant's declared
 * ISIC activity codes — ALSO seeds the industry pack's `:pack/coa-ext` accounts, so the ERP
 * a manufacturer gets has Raw Materials / WIP / Finished Goods, the one a bank gets has
 * Loans & Advances / Technical Provisions, etc. This is the concrete "industry-tailored
 * ERP" behaviour: same engine, industry-correct ledger out of the box. Idempotent
 * (createAccount dedups on code), so re-seeding or adding a pack later is safe.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import { createAccount } from "./registry.js";
import type { AccountType } from "./types.js";
import { coaExtForPacks, resolvePacks } from "./isic-packs.js";

/** Base IFRS-aligned chart of accounts (mirrors the worker's 25-account seed). */
export const BASE_CHART_OF_ACCOUNTS: ReadonlyArray<{ code: string; name: string; type: AccountType }> = [
  { code: "1000", name: "Cash", type: "asset" },
  { code: "1100", name: "Accounts Receivable", type: "asset" },
  { code: "1200", name: "Inventory", type: "asset" },
  { code: "1300", name: "Prepaid Expenses", type: "asset" },
  { code: "1500", name: "Property, Plant & Equipment", type: "asset" },
  { code: "1510", name: "Accumulated Depreciation", type: "contra-asset" },
  { code: "1600", name: "Intangible Assets", type: "asset" },
  { code: "2000", name: "Accounts Payable", type: "liability" },
  { code: "2100", name: "Accrued Liabilities", type: "liability" },
  { code: "2200", name: "Unearned Revenue", type: "liability" },
  { code: "2300", name: "Short-Term Debt", type: "liability" },
  { code: "2700", name: "Long-Term Debt", type: "liability" },
  { code: "2800", name: "Tax Payable", type: "liability" },
  { code: "3000", name: "Share Capital", type: "equity" },
  { code: "3200", name: "Retained Earnings", type: "equity" },
  { code: "3300", name: "Other Comprehensive Income", type: "equity" },
  { code: "4000", name: "Revenue", type: "revenue" },
  { code: "4900", name: "Other Income", type: "revenue" },
  { code: "5000", name: "Cost of Sales", type: "expense" },
  { code: "6000", name: "Salaries & Wages", type: "expense" },
  { code: "6100", name: "Rent Expense", type: "expense" },
  { code: "6200", name: "Utilities Expense", type: "expense" },
  { code: "6300", name: "Depreciation Expense", type: "expense" },
  { code: "6400", name: "Marketing Expense", type: "expense" },
  { code: "7000", name: "Interest Expense", type: "expense" },
];

export interface SeedChartInput {
  /** tenant ISIC activity codes; their packs' CoA extensions are seeded too. */
  isicCodes?: string[];
  /** skip the base 25 accounts (seed only the pack extensions). Default false. */
  packsOnly?: boolean;
  currency?: string;
}
export interface SeedChartOutput {
  baseSeeded: number;
  packSeeded: number;
  packAccounts: string[];
  activePacks: string[];
  alreadyExisted: number;
}

export async function seedChartOfAccounts(e: Etzhayyim, input: SeedChartInput = {}): Promise<SeedChartOutput> {
  const currency = input.currency ?? "JPY";
  let baseSeeded = 0;
  let packSeeded = 0;
  let alreadyExisted = 0;

  if (!input.packsOnly) {
    for (const a of BASE_CHART_OF_ACCOUNTS) {
      const r = await createAccount(e, { accountCode: a.code, name: a.name, accountType: a.type, currency });
      if (r.status === "created") baseSeeded += 1;
      else if (r.status === "alreadyExists") alreadyExisted += 1;
    }
  }

  const resolved = resolvePacks(input.isicCodes ?? []);
  const packExt = coaExtForPacks(resolved.packIds);
  const packAccounts: string[] = [];
  for (const a of packExt) {
    const r = await createAccount(e, { accountCode: a.code, name: a.name, accountType: a.type, currency });
    if (r.status === "created") {
      packSeeded += 1;
      packAccounts.push(a.code);
    } else if (r.status === "alreadyExists") {
      alreadyExisted += 1;
    }
  }

  return {
    baseSeeded,
    packSeeded,
    packAccounts,
    activePacks: resolved.packIds,
    alreadyExisted,
  };
}
