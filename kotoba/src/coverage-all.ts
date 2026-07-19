/**
 * open-kyber kotoba — all-module COVERAGE rollup (ADR-2606037200 D1).
 *
 * Counts records across every kotoba-Datomic ERP module + the productivity suite, and
 * reports which APQC PCF L1 categories are populated. This is the kqe-side replacement for
 * the old RisingWave `getApqcCoverage` streaming MV: the count is rolled up directly off
 * the Datom-log collections. The legacy `coverage()` in registry.ts (account/integration/
 * employee only) stays for back-compat; this is the full surface.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import { ACCOUNT_COLLECTION, INTEGRATION_BINDING_COLLECTION, EMPLOYEE_INNER_TYPE } from "./types.js";
import { JOURNAL_ENTRY_COLLECTION } from "./accounting.js";
import { FIXED_ASSET_COLLECTION, DEPRECIATION_RUN_COLLECTION } from "./assets.js";
import {
  INVOICE_COLLECTION, PURCHASE_ORDER_COLLECTION, INVENTORY_ITEM_COLLECTION,
  SALES_ORDER_COLLECTION, POLICY_CONTROL_COLLECTION, RISK_ISSUE_COLLECTION,
} from "./erp-modules.js";
import {
  MAIL_COLLECTION, DRIVE_COLLECTION, DOC_COLLECTION, SHEET_COLLECTION, CALENDAR_COLLECTION,
} from "./suite.js";
import { TENANT_COLLECTION } from "./tenant.js";

const PAGE_LIMIT = 100;
const DEFAULT_MAX_SCAN = 10_000;

/** module key → { collection, apqcL1 } (apqcL1 null for the suite/tenant rows). */
const MODULE_COLLECTIONS: ReadonlyArray<{ key: string; collection: string; apqc: string | null }> = [
  { key: "account", collection: ACCOUNT_COLLECTION, apqc: "9.0" },
  { key: "journalEntry", collection: JOURNAL_ENTRY_COLLECTION, apqc: "9.0" },
  { key: "invoice", collection: INVOICE_COLLECTION, apqc: "9.0" },
  { key: "purchaseOrder", collection: PURCHASE_ORDER_COLLECTION, apqc: "4.0" },
  { key: "inventoryItem", collection: INVENTORY_ITEM_COLLECTION, apqc: "5.0" },
  { key: "salesOrder", collection: SALES_ORDER_COLLECTION, apqc: "3.0" },
  { key: "fixedAsset", collection: FIXED_ASSET_COLLECTION, apqc: "10.0" },
  { key: "depreciationRun", collection: DEPRECIATION_RUN_COLLECTION, apqc: "10.0" },
  { key: "policyControl", collection: POLICY_CONTROL_COLLECTION, apqc: "11.0" },
  { key: "riskIssue", collection: RISK_ISSUE_COLLECTION, apqc: "11.0" },
  { key: "integrationBinding", collection: INTEGRATION_BINDING_COLLECTION, apqc: null },
  { key: "tenant", collection: TENANT_COLLECTION, apqc: null },
  { key: "mail", collection: MAIL_COLLECTION, apqc: null },
  { key: "driveNode", collection: DRIVE_COLLECTION, apqc: null },
  { key: "doc", collection: DOC_COLLECTION, apqc: null },
  { key: "sheet", collection: SHEET_COLLECTION, apqc: null },
  { key: "calendarEvent", collection: CALENDAR_COLLECTION, apqc: null },
];

export interface ErpCoverageOutput {
  /** per-module record counts (keys above + `employee`). */
  counts: Record<string, number>;
  /** APQC L1 categories that have at least one record. */
  apqcL1Active: string[];
  /** module keys with at least one record. */
  modulesActive: string[];
  /** total business records across all modules (incl. employee when E2E is reachable). */
  total: number;
  truncated: boolean;
  /** true when the encrypted employee transport wasn't configured/reachable (count omitted). */
  employeeE2eUnavailable: boolean;
}

async function countCollection(e: Etzhayyim, collection: string, maxScan: number): Promise<number> {
  let n = 0;
  let cursor: string | undefined;
  while (n < maxScan) {
    const page = await e.read<Record<string, unknown>>({ collection, cursor, limit: PAGE_LIMIT });
    n += page.records.length;
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }
  return n;
}

/**
 * Count E2E employees via the encrypted envelope. Returns -1 (not 0) when the encrypted
 * transport is unavailable, so callers can distinguish "no employees" from "E2E not wired"
 * rather than under-reporting coverage silently.
 */
async function countEmployees(e: Etzhayyim, maxScan: number): Promise<number> {
  let n = 0;
  let cursor: string | undefined;
  try {
    while (n < maxScan) {
      const page = await e.encryptedRead<Record<string, unknown>>({ innerType: EMPLOYEE_INNER_TYPE, cursor, limit: PAGE_LIMIT });
      n += page.records.length;
      if (!page.cursor || page.records.length === 0) break;
      cursor = page.cursor;
    }
    return n;
  } catch {
    return -1; // encrypted transport not configured / unreachable
  }
}

export async function erpCoverage(e: Etzhayyim, input: { maxScan?: number } = {}): Promise<ErpCoverageOutput> {
  const maxScan = Math.min(input.maxScan ?? DEFAULT_MAX_SCAN, DEFAULT_MAX_SCAN);
  const counts: Record<string, number> = {};
  const apqcActive = new Set<string>();
  const modulesActive: string[] = [];
  let total = 0;
  let truncated = false;

  for (const m of MODULE_COLLECTIONS) {
    const c = await countCollection(e, m.collection, maxScan);
    counts[m.key] = c;
    if (c > 0) {
      modulesActive.push(m.key);
      if (m.apqc) apqcActive.add(m.apqc);
    }
    // tenant rows are config, not business records — exclude from `total`.
    if (m.key !== "tenant") total += c;
    if (c >= maxScan) truncated = true;
  }

  // Employee (E2E) — counted via the encrypted envelope; APQC 7.0 Human Capital.
  const emp = await countEmployees(e, maxScan);
  const employeeE2eUnavailable = emp < 0;
  counts.employee = employeeE2eUnavailable ? 0 : emp;
  if (emp > 0) {
    modulesActive.push("employee");
    apqcActive.add("7.0");
  }
  if (!employeeE2eUnavailable) total += emp;

  return {
    counts,
    apqcL1Active: [...apqcActive].sort(),
    modulesActive,
    total,
    truncated,
    employeeE2eUnavailable,
  };
}
