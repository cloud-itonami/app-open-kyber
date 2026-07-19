/**
 * open-kyber kotoba — ISIC industry-pack LOADER (ADR-2606037200 D3).
 *
 * Realizes "ISIC のすべての産業にそれぞれ対応した ERP": ONE base ERP + a composable
 * overlay pack per ISIC Rev.4 section (21, A..U) plus higher-resolution division packs.
 * A tenant declares its ISIC activity codes; this loader resolves the matching packs.
 *
 * The FULL pack overlays (CoA extensions, units, compliance, KPIs, actor links) are the
 * SSoT in `industry-packs/isic-packs.kotoba.edn`. This module carries the COMPACT
 * resolution descriptors (id / section / scope / division) needed to map a code to its
 * packs, plus the section-range table mirroring open-isic `sectionForDivision`
 * (60-apps/etzhayyim-project-open-isic/kotoba/src/types.ts). Resolution is a PURE function;
 * the persisted activation (:erp.tenant/active-packs) is written by the tenant module.
 *
 * Composition rule (ADR-2606037200 D3): the SECTION pack always applies; the most-specific
 * DIVISION (or class) pack also applies and WINS on conflicting CoA codes. A code with no
 * declared ISIC activity falls back to the generic base (no pack).
 */

import type { AccountType } from "./types.js";

export type PackScope = "section" | "division" | "class";

export interface PackDescriptor {
  /** e.g. "pack/C" (section) or "pack/C29" (division). Matches :isic.pack/id in the EDN. */
  id: string;
  /** ISIC section letter A..U. */
  section: string;
  scope: PackScope;
  /** 2-digit division, for division/class packs. */
  division?: string;
}

/** division 2-digit range → ISIC section (mirrors open-isic sectionForDivision). */
const SECTION_RANGES: ReadonlyArray<{ from: number; to: number; section: string }> = [
  { from: 1, to: 3, section: "A" }, { from: 5, to: 9, section: "B" }, { from: 10, to: 33, section: "C" },
  { from: 35, to: 35, section: "D" }, { from: 36, to: 39, section: "E" }, { from: 41, to: 43, section: "F" },
  { from: 45, to: 47, section: "G" }, { from: 49, to: 53, section: "H" }, { from: 55, to: 56, section: "I" },
  { from: 58, to: 63, section: "J" }, { from: 64, to: 66, section: "K" }, { from: 68, to: 68, section: "L" },
  { from: 69, to: 75, section: "M" }, { from: 77, to: 82, section: "N" }, { from: 84, to: 84, section: "O" },
  { from: 85, to: 85, section: "P" }, { from: 86, to: 88, section: "Q" }, { from: 90, to: 93, section: "R" },
  { from: 94, to: 96, section: "S" }, { from: 97, to: 98, section: "T" }, { from: 99, to: 99, section: "U" },
];

/** All 21 ISIC Rev.4 section letters, A..U. */
export const ISIC_SECTIONS: readonly string[] = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U",
];

/** The 21 section packs, keyed by section letter. */
export const SECTION_PACKS: Readonly<Record<string, PackDescriptor>> = Object.freeze(
  Object.fromEntries(
    ISIC_SECTIONS.map((s) => [s, { id: `pack/${s}`, section: s, scope: "section" as const }]),
  ),
);

/** The division packs (ADR-2606037200 D3). More land incrementally. */
export const DIVISION_PACKS: readonly PackDescriptor[] = [
  { id: "pack/A01", section: "A", scope: "division", division: "01" },
  { id: "pack/A03", section: "A", scope: "division", division: "03" },
  { id: "pack/C10", section: "C", scope: "division", division: "10" },
  { id: "pack/C21", section: "C", scope: "division", division: "21" },
  { id: "pack/C26", section: "C", scope: "division", division: "26" }, // computers/electronics
  { id: "pack/C29", section: "C", scope: "division", division: "29" },
  { id: "pack/F41", section: "F", scope: "division", division: "41" }, // building construction
  { id: "pack/H49", section: "H", scope: "division", division: "49" }, // land transport
  { id: "pack/H50", section: "H", scope: "division", division: "50" }, // water transport
  { id: "pack/I55", section: "I", scope: "division", division: "55" }, // accommodation
  { id: "pack/J62", section: "J", scope: "division", division: "62" }, // software/IT services
  { id: "pack/K64", section: "K", scope: "division", division: "64" },
  { id: "pack/K65", section: "K", scope: "division", division: "65" },
  { id: "pack/P85", section: "P", scope: "division", division: "85" }, // education
  { id: "pack/Q86", section: "Q", scope: "division", division: "86" },
];

/**
 * Section chart-of-accounts EXTENSIONS — the TS runtime MIRROR of `:pack/coa-ext` in
 * `industry-packs/isic-packs.kotoba.edn` (the EDN is the documentation SSoT; this is the
 * runtime data the seeder reads, same EDN→TS mirror pattern as the actor-profile seed).
 * Keyed by section letter; codes are additive to the base IFRS chart.
 */
export const SECTION_COA_EXT: Readonly<Record<string, ReadonlyArray<{ code: string; name: string; type: AccountType }>>> = Object.freeze({
  A: [{ code: "5100", name: "Seed & Feed", type: "expense" }, { code: "1250", name: "Biological Assets (livestock/crops)", type: "asset" }, { code: "4100", name: "Crop & Livestock Sales", type: "revenue" }],
  B: [{ code: "1700", name: "Mineral Reserves", type: "asset" }, { code: "5200", name: "Site Restoration Provision", type: "expense" }],
  C: [{ code: "1210", name: "Raw Materials", type: "asset" }, { code: "1220", name: "Work in Process", type: "asset" }, { code: "1230", name: "Finished Goods", type: "asset" }, { code: "5300", name: "Manufacturing Overhead", type: "expense" }],
  D: [{ code: "1800", name: "Grid Infrastructure", type: "asset" }, { code: "4200", name: "Energy Sales (kWh)", type: "revenue" }, { code: "2400", name: "Renewable Obligation", type: "liability" }],
  E: [{ code: "1810", name: "Treatment Plant & Network", type: "asset" }, { code: "4250", name: "Tariff & Gate Fees", type: "revenue" }],
  F: [{ code: "1240", name: "Construction in Progress", type: "asset" }, { code: "2410", name: "Retention Payable", type: "liability" }, { code: "4300", name: "Contract Revenue (POC)", type: "revenue" }],
  G: [{ code: "4000", name: "Merchandise Sales", type: "revenue" }, { code: "5000", name: "Cost of Goods Sold", type: "expense" }, { code: "4050", name: "Sales Returns & Allowances", type: "revenue" }],
  H: [{ code: "1820", name: "Fleet & Rolling Stock", type: "asset" }, { code: "4350", name: "Freight & Logistics Revenue", type: "revenue" }, { code: "5400", name: "Fuel & Maintenance", type: "expense" }],
  I: [{ code: "4400", name: "F&B / Room Revenue", type: "revenue" }, { code: "5050", name: "Food & Beverage Cost", type: "expense" }],
  J: [{ code: "1320", name: "Deferred Subscription Cost", type: "asset" }, { code: "2500", name: "Deferred Revenue", type: "liability" }, { code: "4450", name: "Recurring (SaaS) Revenue", type: "revenue" }],
  K: [{ code: "1900", name: "Loans & Advances", type: "asset" }, { code: "2600", name: "Technical Provisions / Reserves", type: "liability" }, { code: "4500", name: "Interest & Premium Income", type: "revenue" }],
  L: [{ code: "1830", name: "Investment Property", type: "asset" }, { code: "4550", name: "Rental Income", type: "revenue" }, { code: "2510", name: "Tenant Deposits", type: "liability" }],
  M: [{ code: "1330", name: "Unbilled WIP (services)", type: "asset" }, { code: "4600", name: "Professional Fees", type: "revenue" }],
  N: [{ code: "4650", name: "Service Contract Revenue", type: "revenue" }, { code: "5450", name: "Subcontracted Labor", type: "expense" }],
  O: [{ code: "3100", name: "Appropriations / Fund Balance", type: "equity" }, { code: "4700", name: "Grants & Transfers Received", type: "revenue" }],
  P: [{ code: "4750", name: "Tuition & Fees", type: "revenue" }, { code: "2520", name: "Deferred Tuition", type: "liability" }],
  Q: [{ code: "1340", name: "Patient Receivables (net)", type: "asset" }, { code: "4800", name: "Patient & Payer Revenue", type: "revenue" }, { code: "5060", name: "Pharmaceutical & Supplies", type: "expense" }],
  R: [{ code: "4850", name: "Box Office & Royalties", type: "revenue" }, { code: "2530", name: "Deferred Ticket Revenue", type: "liability" }],
  S: [{ code: "4900", name: "Membership & Service Revenue", type: "revenue" }],
  T: [{ code: "5500", name: "Household Wages", type: "expense" }],
  U: [{ code: "4700", name: "Assessed & Voluntary Contributions", type: "revenue" }, { code: "3100", name: "Fund Balance (restricted)", type: "equity" }],
});

/**
 * Division chart-of-accounts EXTENSIONS — deeper, sector-specific accounts for the
 * higher-resolution division packs (ADR-2606037200 D3: a section is too coarse for, e.g.,
 * pharma GMP batch costing or a bank's interbank book). Keyed by division pack id; these
 * COMPOSE on top of (and override on code conflict) the section ext.
 */
export const DIVISION_COA_EXT: Readonly<Record<string, ReadonlyArray<{ code: string; name: string; type: AccountType }>>> = Object.freeze({
  "pack/C21": [{ code: "1235", name: "Batch Work in Process (GMP)", type: "asset" }, { code: "5310", name: "GMP Quality & Validation Cost", type: "expense" }], // pharma
  "pack/C29": [{ code: "1236", name: "Vehicles in Process", type: "asset" }, { code: "5320", name: "Warranty Provision Cost", type: "expense" }], // motor vehicles
  "pack/F41": [{ code: "1245", name: "Retention Receivable", type: "asset" }], // building construction
  "pack/J62": [{ code: "1325", name: "Capitalized Development Cost", type: "asset" }], // software/IT
  "pack/K64": [{ code: "1910", name: "Interbank Placements", type: "asset" }, { code: "2610", name: "Customer Deposits", type: "liability" }], // banking
  "pack/K65": [{ code: "2620", name: "Unearned Premium Reserve", type: "liability" }, { code: "5610", name: "Claims Incurred", type: "expense" }], // insurance
  "pack/Q86": [{ code: "1345", name: "Insurance Claims Receivable", type: "asset" }], // human health
});

/**
 * Resolve the chart-of-accounts extensions for a set of pack ids (deduped by code). The
 * SECTION ext applies first; the more-specific DIVISION ext composes on top and WINS on a
 * code conflict (ADR-2606037200 D3).
 */
export function coaExtForPacks(packIds: readonly string[]): Array<{ code: string; name: string; type: AccountType }> {
  const byCode = new Map<string, { code: string; name: string; type: AccountType }>();
  // 1. section ext (section packs "pack/<L>"; division packs "pack/<L><dd>" inherit their section's)
  for (const id of packIds) {
    const section = id.slice("pack/".length, "pack/".length + 1);
    for (const acc of SECTION_COA_EXT[section] ?? []) {
      if (!byCode.has(acc.code)) byCode.set(acc.code, acc);
    }
  }
  // 2. division ext composes on top, overriding on code conflict
  for (const id of packIds) {
    for (const acc of DIVISION_COA_EXT[id] ?? []) byCode.set(acc.code, acc);
  }
  return [...byCode.values()];
}

/** Map a 2-digit ISIC division to its section letter (throws on out-of-range). */
export function sectionForDivision(division: string): string {
  const d = Number(division);
  if (!Number.isInteger(d) || d < 1 || d > 99) {
    throw new Error(`invalid ISIC division: ${division}`);
  }
  const hit = SECTION_RANGES.find((r) => d >= r.from && d <= r.to);
  if (!hit) throw new Error(`ISIC division ${division} maps to no section (gap code)`);
  return hit.section;
}

/** Normalize a declared ISIC code to its 2-digit division (accepts 2/3/4-digit codes). */
export function divisionOf(code: string): string {
  const c = String(code).trim();
  if (!/^\d{2,4}$/.test(c)) throw new Error(`invalid ISIC code: ${code}`);
  return c.slice(0, 2);
}

export interface ResolveResult {
  /** Resolved pack ids in apply order (sections first, then the more-specific division packs). */
  packIds: string[];
  /** Full descriptors, deduped. */
  packs: PackDescriptor[];
  /** Per-input-code resolution, for diagnostics. */
  perCode: Array<{ code: string; section: string; division: string; packIds: string[] }>;
}

/**
 * Resolve a tenant's declared ISIC codes to its active packs (PURE).
 *
 * For each code: the section pack always applies; if a division pack exists for that
 * division it also applies (and would win on CoA conflicts at compose time). Unknown /
 * malformed codes are skipped (reported with empty packIds in `perCode`). An empty input
 * yields no packs (generic base).
 */
export function resolvePacks(isicCodes: readonly string[]): ResolveResult {
  const sectionIds = new Set<string>();
  const divisionIds = new Set<string>();
  const perCode: ResolveResult["perCode"] = [];

  for (const raw of isicCodes ?? []) {
    let division: string;
    let section: string;
    try {
      division = divisionOf(raw);
      section = sectionForDivision(division);
    } catch {
      perCode.push({ code: String(raw), section: "", division: "", packIds: [] });
      continue;
    }
    const ids: string[] = [SECTION_PACKS[section].id];
    sectionIds.add(SECTION_PACKS[section].id);
    const dpack = DIVISION_PACKS.find((p) => p.division === division);
    if (dpack) {
      ids.push(dpack.id);
      divisionIds.add(dpack.id);
    }
    perCode.push({ code: String(raw), section, division, packIds: ids });
  }

  // Sections first (broad overlay), then division packs (specific, win on conflict).
  const packIds = [...sectionIds, ...divisionIds];
  const byId = new Map<string, PackDescriptor>();
  for (const s of sectionIds) byId.set(s, SECTION_PACKS[s.slice("pack/".length)]);
  for (const d of divisionIds) {
    const desc = DIVISION_PACKS.find((p) => p.id === d);
    if (desc) byId.set(d, desc);
  }
  return { packIds, packs: packIds.map((id) => byId.get(id)!).filter(Boolean), perCode };
}
