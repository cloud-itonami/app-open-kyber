// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 etzhayyim Japan株式会社 / etzhayyim. All rights reserved.
// Licensed under the Apache License, Version 2.0 — see LICENSE at repo root.

// kyber.etzhayyim.com — Corporate ERP Intelligence
// TS Native Worker: 28 XRPC commands across Accounting / AP-AR / HR / Procurement / Inventory / Sales / Asset / Governance / Management / Billing
//
// SUBSTRATE (ADR-2606037200 D1 + ADR-2605262130 + ADR-2605312345): canonical state is the
// kotoba Datom log. RisingWave / Kysely / Hyperdrive are PROHIBITED in the religious-corp ERP
// path. Every read/write routes through the tested, kotoba-Datomic kotoba functions
// (@etzhayyim/open-kyber-kotoba) via `createXrpcBridge`, which adapts the kotodama-host-sdk
// AT-repo XrpcClient (createRecord / getRecord / listRecords → PDS → Datom log) to the
// `Etzhayyim` read/write surface. This SUPERSEDES the ADR-0036 "domain writes via Kysely"
// rule for this app (the runbook is 60-apps/etzhayyim-project-open-kyber/R2-WORKER-WIRING.md).
//
// NOTE: list/read paths now return REAL records from the Datom log (not the pre-cutover empty
// envelopes). The pagination uses AT listRecords; the kqe AEVT/AVET arrangement is the
// Phase-2.5 index optimization (ADR-2605262130 D7).

import {
  asAgentTool,
  createCadenceState,
  createInboxBuffer,
  createWorkerExport,
  decodeJson,
  genID,
  nowISO,
  nsid,
  str,
  withCapabilityTags,
  type ComAtprotoSyncSubscribeReposCommit,
  type HostSDK,
} from "@etzhayyim/kotodama-host-sdk";
import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  createXrpcBridge,
  // accounting
  createAccount,
  seedChartOfAccounts,
  createJournalEntry,
  listJournalEntries,
  getTrialBalance,
  // AP/AR
  createInvoice,
  listInvoices,
  // HR (E2E)
  registerEmployee,
  listEmployees,
  // procurement / inventory / sales
  createPurchaseOrder,
  listPurchaseOrders,
  registerInventoryItem,
  listInventory,
  createSalesOrder,
  listSalesOrders,
  // asset
  registerFixedAsset,
  listFixedAssets,
  runDepreciation,
  // governance
  registerPolicyControl,
  recordRiskIssue,
  listRiskIssues,
  // coverage (kqe replacement for the RisingWave getApqcCoverage MV)
  erpCoverage,
} from "@etzhayyim/open-kyber-kotoba";

// ───────────────────────────── shared state ─────────────────────────────

const cadenceState = createCadenceState();
const inbox = createInboxBuffer();
let appId = "";
let actorDID = "";

// Kyber APQC/BPMN projector (cross-project; see ADR-0025)
const APQC_PROJECTOR_DID = "did:web:kyber-projector.etzhayyim.com";
const APQC_PROJECTOR_NANOID = "kyb3proj";

// Department DIDs (multi-DID per app; pre-registered via kotodama.jsonld entities).
// Carried as the acting DID on the bridge so each record is tagged with its writer dept.
const DEPT = {
  accounting: "did:web:kyber.etzhayyim.com:dept:accounting",
  hr: "did:web:kyber.etzhayyim.com:dept:hr",
  procurement: "did:web:kyber.etzhayyim.com:dept:procurement",
  inventory: "did:web:kyber.etzhayyim.com:dept:inventory",
  sales: "did:web:kyber.etzhayyim.com:dept:sales",
  asset: "did:web:kyber.etzhayyim.com:dept:asset",
  governance: "did:web:kyber.etzhayyim.com:dept:governance",
} as const;

// ───────────────────────────── bridge + helpers ─────────────────────────────

/**
 * Build a kotoba-Datom bridge from the AT-repo XrpcClient (sdk.pds). The acting `did` tags
 * records with their writer department. The E2E employee path (ADR-2605181100) needs
 * `encrypted` delegates from a configured @etzhayyim/sdk Etzhayyim instance (PDS/IPFS/L2 env);
 * until that is wired the HR commands return the bridge's clear "encrypted transport not
 * configured" error rather than ever dropping PII to plaintext.
 */
function bridgeFor(sdk: HostSDK, did: string): Etzhayyim {
  return createXrpcBridge(sdk.pds as never, { did });
}

/** Whether an kotoba status string represents a successful (non-rejected) outcome. */
function okStatus(status: string): boolean {
  return status !== "rejected" && status !== "error";
}

/** Validate + normalize a number into a non-negative decimal money STRING (kotoba isMoney). */
function money(n: unknown): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v < 0) return "0";
  return String(v);
}

function parseItems(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  return [];
}

function sumItems(items: Array<Record<string, unknown>>): { subtotal: number; tax: number; total: number } {
  let subtotal = 0;
  let tax = 0;
  for (const it of items) {
    const qty = Number(it.quantity ?? 0);
    const price = Number(it.unitPrice ?? 0);
    const rate = Number(it.taxRate ?? 0);
    const line = qty * price;
    subtotal += line;
    tax += line * rate;
  }
  return { subtotal, tax, total: subtotal + tax };
}

// ───────────────────────────── Accounting (5) ─────────────────────────────

async function cmdCreateJournalEntry(sdk: HostSDK, body: Uint8Array) {
  const args = decodeJson(body, {}) as Record<string, unknown>;
  const rawLines = parseItems(args.lines);
  if (rawLines.length < 2) return { ok: false, error: "journal requires at least 2 lines (debit + credit)" };
  const lines = rawLines.map((l) => ({
    account: str(l.account ?? ""),
    debit: money(l.debit),
    credit: money(l.credit),
    memo: l.memo !== undefined ? str(l.memo) : undefined,
  }));
  const e = bridgeFor(sdk, DEPT.accounting);
  const r = await createJournalEntry(e, {
    number: str(args.number ?? genID("je")),
    date: args.date !== undefined ? str(args.date) : undefined,
    memo: args.memo !== undefined ? str(args.memo) : undefined,
    currency: args.currency !== undefined ? str(args.currency) : undefined,
    lines,
  });
  return { ok: okStatus(r.status), journalId: r.entryId, ...r };
}

async function cmdListJournalEntries(sdk: HostSDK, body: Uint8Array) {
  const args = decodeJson(body, {}) as Record<string, unknown>;
  const e = bridgeFor(sdk, DEPT.accounting);
  const r = await listJournalEntries(e, { limit: args.limit !== undefined ? Number(args.limit) : undefined });
  return { ok: true, journalEntries: r.items, items: r.items, total: r.total, cursor: r.cursor };
}

async function cmdGetTrialBalance(sdk: HostSDK, _body: Uint8Array) {
  const e = bridgeFor(sdk, DEPT.accounting);
  const r = await getTrialBalance(e, {});
  return {
    ok: true,
    asOf: nowISO().slice(0, 10),
    rows: r.rows,
    accounts: r.rows,
    totals: { debit: r.totalDebit, credit: r.totalCredit },
    balanced: r.balanced,
  };
}

async function cmdCreateAccount(sdk: HostSDK, body: Uint8Array) {
  const args = decodeJson(body, {}) as Record<string, unknown>;
  const code = str(args.code ?? "");
  const name = str(args.name ?? "");
  const type = str(args.type ?? "asset");
  if (!code || !name) return { ok: false, error: "code and name required" };
  const e = bridgeFor(sdk, DEPT.accounting);
  const r = await createAccount(e, {
    accountCode: code,
    name,
    accountType: type as never,
    openingBalance: args.openingBalance !== undefined ? money(args.openingBalance) : undefined,
    currency: args.currency !== undefined ? str(args.currency) : undefined,
  });
  return { ok: okStatus(r.status), code, name, type, ...r };
}

async function cmdSeedChartOfAccounts(sdk: HostSDK, body: Uint8Array) {
  const args = decodeJson(body, {}) as Record<string, unknown>;
  const isicCodes = Array.isArray(args.isicCodes) ? (args.isicCodes as string[]) : undefined;
  const e = bridgeFor(sdk, DEPT.accounting);
  const r = await seedChartOfAccounts(e, { isicCodes });
  return { ok: true, ...r };
}

// ───────────────────────────── AP / AR (2) ─────────────────────────────

async function cmdCreateInvoice(sdk: HostSDK, body: Uint8Array) {
  const args = decodeJson(body, {}) as Record<string, unknown>;
  const direction = str(args.direction ?? "receivable");
  const counterparty = str(args.counterparty ?? args.party ?? "");
  const items = parseItems(args.items);
  if (!counterparty || items.length === 0) return { ok: false, error: "counterparty and items required" };
  const { subtotal, tax } = sumItems(items);
  const e = bridgeFor(sdk, DEPT.accounting);
  const r = await createInvoice(e, {
    number: str(args.invoiceNumber ?? genID("inv")),
    direction: direction as never,
    party: counterparty,
    amount: money(subtotal),
    tax: money(tax),
    currency: args.currency !== undefined ? str(args.currency) : undefined,
    due: args.dueDate !== undefined ? str(args.dueDate) : undefined,
  });
  return { ok: okStatus(r.status), direction, counterparty, subtotal, tax, ...r };
}

async function cmdListInvoices(sdk: HostSDK, body: Uint8Array) {
  const args = decodeJson(body, {}) as Record<string, unknown>;
  const e = bridgeFor(sdk, DEPT.accounting);
  const r = await listInvoices(e, { limit: args.limit !== undefined ? Number(args.limit) : undefined });
  return { ok: true, invoices: r.items, items: r.items, total: r.total };
}

// ───────────────────────────── HR (2) — E2E PII (ADR-2605181100) ────────────────────

async function cmdRegisterEmployee(sdk: HostSDK, body: Uint8Array) {
  const args = decodeJson(body, {}) as Record<string, unknown>;
  const name = str(args.name ?? "");
  const department = str(args.department ?? "");
  if (!name || !department) return { ok: false, error: "name and department required" };
  const e = bridgeFor(sdk, DEPT.hr);
  try {
    const r = await registerEmployee(e, {
      employeeId: str(args.employeeId ?? genID("emp")),
      name,
      email: str(args.email ?? ""),
      department,
      position: args.position !== undefined ? str(args.position) : undefined,
      employmentType: args.employmentType !== undefined ? (str(args.employmentType) as never) : undefined,
      salary: args.salary !== undefined ? money(args.salary) : undefined,
      currency: args.currency !== undefined ? str(args.currency) : undefined,
    });
    return { ok: okStatus(r.status), name, department, ...r };
  } catch (err) {
    // bridge has no encrypted transport configured — refuse rather than drop PII to plaintext.
    return { ok: false, error: "EmployeeE2eUnavailable", detail: String(err) };
  }
}

async function cmdListEmployees(sdk: HostSDK, body: Uint8Array) {
  const args = decodeJson(body, {}) as Record<string, unknown>;
  const e = bridgeFor(sdk, DEPT.hr);
  try {
    const r = await listEmployees(e, { limit: args.limit !== undefined ? Number(args.limit) : undefined });
    return { ok: true, employees: r.items, items: r.items, total: r.total };
  } catch (err) {
    return { ok: false, error: "EmployeeE2eUnavailable", detail: String(err), employees: [], total: 0 };
  }
}

// ───────────────────────────── Procurement (2) ─────────────────────────────

async function cmdCreatePurchaseOrder(sdk: HostSDK, body: Uint8Array) {
  const args = decodeJson(body, {}) as Record<string, unknown>;
  const vendor = str(args.vendor ?? args.supplier ?? "");
  const items = parseItems(args.items);
  if (!vendor || items.length === 0) return { ok: false, error: "vendor and items required" };
  const { total } = sumItems(items);
  const e = bridgeFor(sdk, DEPT.procurement);
  const r = await createPurchaseOrder(e, {
    number: str(args.poNumber ?? genID("po")),
    supplier: vendor,
    total: money(total),
    currency: args.currency !== undefined ? str(args.currency) : undefined,
    ordered: args.deliveryDate !== undefined ? str(args.deliveryDate) : undefined,
  });
  return { ok: okStatus(r.status), vendor, total, ...r };
}

async function cmdListPurchaseOrders(sdk: HostSDK, body: Uint8Array) {
  const args = decodeJson(body, {}) as Record<string, unknown>;
  const e = bridgeFor(sdk, DEPT.procurement);
  const r = await listPurchaseOrders(e, { limit: args.limit !== undefined ? Number(args.limit) : undefined });
  return { ok: true, purchaseOrders: r.items, items: r.items, total: r.total };
}

// ───────────────────────────── Inventory (2) ─────────────────────────────

async function cmdRegisterInventoryItem(sdk: HostSDK, body: Uint8Array) {
  const args = decodeJson(body, {}) as Record<string, unknown>;
  const sku = str(args.sku ?? "");
  const name = str(args.name ?? "");
  if (!sku || !name) return { ok: false, error: "sku and name required" };
  const e = bridgeFor(sdk, DEPT.inventory);
  const r = await registerInventoryItem(e, {
    sku,
    name,
    qty: args.quantity !== undefined ? money(args.quantity) : undefined,
    unitCost: args.unitCost !== undefined ? money(args.unitCost) : undefined,
    currency: args.currency !== undefined ? str(args.currency) : undefined,
    unspsc: args.unspsc !== undefined ? str(args.unspsc) : undefined,
  });
  return { ok: okStatus(r.status), sku, name, ...r };
}

async function cmdListInventory(sdk: HostSDK, body: Uint8Array) {
  const args = decodeJson(body, {}) as Record<string, unknown>;
  const e = bridgeFor(sdk, DEPT.inventory);
  const r = await listInventory(e, { limit: args.limit !== undefined ? Number(args.limit) : undefined });
  return { ok: true, items: r.items, total: r.total };
}

// ───────────────────────────── Sales (2) ─────────────────────────────

async function cmdCreateSalesOrder(sdk: HostSDK, body: Uint8Array) {
  const args = decodeJson(body, {}) as Record<string, unknown>;
  const customer = str(args.customer ?? "");
  const items = parseItems(args.items);
  if (!customer || items.length === 0) return { ok: false, error: "customer and items required" };
  const { total } = sumItems(items);
  const shipping = Number(args.shipping ?? 0);
  const grandTotal = total + shipping;
  const e = bridgeFor(sdk, DEPT.sales);
  const r = await createSalesOrder(e, {
    number: str(args.orderNumber ?? genID("so")),
    customer,
    total: money(grandTotal),
    currency: args.currency !== undefined ? str(args.currency) : undefined,
  });
  return { ok: okStatus(r.status), customer, shipping, total: grandTotal, ...r };
}

async function cmdListSalesOrders(sdk: HostSDK, body: Uint8Array) {
  const args = decodeJson(body, {}) as Record<string, unknown>;
  const e = bridgeFor(sdk, DEPT.sales);
  const r = await listSalesOrders(e, { limit: args.limit !== undefined ? Number(args.limit) : undefined });
  return { ok: true, salesOrders: r.items, items: r.items, total: r.total };
}

// ───────────────────────────── Asset (3) ─────────────────────────────

async function cmdRegisterFixedAsset(sdk: HostSDK, body: Uint8Array) {
  const args = decodeJson(body, {}) as Record<string, unknown>;
  const assetTag = str(args.assetTag ?? "");
  const name = str(args.name ?? "");
  if (!assetTag || !name) return { ok: false, error: "assetTag and name required" };
  const e = bridgeFor(sdk, DEPT.asset);
  const r = await registerFixedAsset(e, {
    tag: assetTag,
    name,
    cost: money(args.cost),
    salvage: args.salvageValue !== undefined ? money(args.salvageValue) : undefined,
    lifeMonths: Number(args.usefulLifeMonths ?? 60),
    method: args.depreciationMethod !== undefined ? (str(args.depreciationMethod) as never) : undefined,
    acquired: args.acquisitionDate !== undefined ? str(args.acquisitionDate) : undefined,
    currency: args.currency !== undefined ? str(args.currency) : undefined,
  });
  return { ok: okStatus(r.status), assetTag, name, ...r };
}

async function cmdListFixedAssets(sdk: HostSDK, body: Uint8Array) {
  const args = decodeJson(body, {}) as Record<string, unknown>;
  const e = bridgeFor(sdk, DEPT.asset);
  const r = await listFixedAssets(e, { limit: args.limit !== undefined ? Number(args.limit) : undefined });
  return { ok: true, fixedAssets: r.items, items: r.items, total: r.total };
}

async function cmdRunDepreciation(sdk: HostSDK, body: Uint8Array) {
  const args = decodeJson(body, {}) as Record<string, unknown>;
  const period = str(args.period ?? nowISO().slice(0, 7));
  const periodIndex = Number(args.periodIndex ?? 0);
  const e = bridgeFor(sdk, DEPT.asset);

  // Single asset by tag, or a batch of asset tags. kotoba reads the persisted fixed asset
  // and posts an accumulating depreciation-run Datom (非終末論, never an in-place edit).
  const tag = str(args.tag ?? args.assetTag ?? "");
  if (tag) {
    const r = await runDepreciation(e, { tag, periodIndex, period });
    return { ok: okStatus(r.status), period, ...r };
  }
  const assets = parseItems(args.assets);
  const runs: unknown[] = [];
  for (const a of assets) {
    const t = str(a.tag ?? a.assetTag ?? "");
    if (!t) continue;
    runs.push(await runDepreciation(e, { tag: t, periodIndex, period }));
  }
  return { ok: true, period, assetCount: runs.length, runs };
}

// ───────────────────────────── Governance (3) ─────────────────────────────

async function cmdRegisterPolicyControl(sdk: HostSDK, body: Uint8Array) {
  const args = decodeJson(body, {}) as Record<string, unknown>;
  const controlCode = str(args.controlCode ?? "");
  const title = str(args.title ?? "");
  if (!controlCode || !title) return { ok: false, error: "controlCode and title required" };
  const e = bridgeFor(sdk, DEPT.governance);
  const r = await registerPolicyControl(e, {
    code: controlCode,
    title,
    framework: args.framework !== undefined ? str(args.framework) : undefined,
    status: args.status !== undefined ? (str(args.status) as never) : undefined,
  });
  return { ok: okStatus(r.status), controlCode, title, ...r };
}

async function cmdRecordRiskIssue(sdk: HostSDK, body: Uint8Array) {
  const args = decodeJson(body, {}) as Record<string, unknown>;
  const riskTitle = str(args.riskTitle ?? "");
  if (!riskTitle) return { ok: false, error: "riskTitle required" };
  const e = bridgeFor(sdk, DEPT.governance);
  const r = await recordRiskIssue(e, {
    issueId: str(args.issueId ?? genID("risk")),
    title: riskTitle,
    severity: (str(args.severity ?? "medium") as never),
    status: args.status !== undefined ? (str(args.status) as never) : undefined,
  });
  return { ok: okStatus(r.status), riskTitle, ...r };
}

async function cmdListRiskIssues(sdk: HostSDK, body: Uint8Array) {
  const args = decodeJson(body, {}) as Record<string, unknown>;
  const e = bridgeFor(sdk, DEPT.governance);
  const r = await listRiskIssues(e, { limit: args.limit !== undefined ? Number(args.limit) : undefined });
  return { ok: true, riskIssues: r.items, items: r.items, total: r.total };
}

// ───────────────────── Billing / Tenant (4) — kotoba-native, Stripe-disabled ─────────────────────
//
// Billing is the COMMERCIAL-FORK concern (kyber.etzhayyim.com for-profit tenancy). Stripe is
// removed from the canonical religious-corp repo per Charter Rider §1.3 + ADR-2605212100.
// Post-cutover these store billing tenant / usage-meter / stripe-report as kotoba Datom records
// (no RisingWave/Kysely). Usage is aggregated from the meter records, replacing the old
// RisingWave mv_kyber_monthly_usage materialized view.

const BILLING_DID = "did:web:kyber.etzhayyim.com:dept:billing";
const BILLING_TENANT_COLLECTION = "com.etzhayyim.apps.kyber.billingTenant";
const USAGE_METER_COLLECTION = "com.etzhayyim.apps.kyber.usageMeter";
const STRIPE_REPORT_COLLECTION = "com.etzhayyim.apps.kyber.kyberStripeReport";

function nowMonth(): string {
  return nowISO().slice(0, 7);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function planLimits(planId: string): { maxUsers: number; maxMonthlyTxns: number } {
  switch (planId) {
    case "starter": return { maxUsers: 5,      maxMonthlyTxns: 5000 };
    case "growth":  return { maxUsers: 20,     maxMonthlyTxns: 50000 };
    case "scale":   return { maxUsers: 999999, maxMonthlyTxns: 999999 };
    default:        return { maxUsers: 1,      maxMonthlyTxns: 100 };
  }
}

// Stripe is disabled in the canonical etzhayyim repo (Charter Rider §1.3 + ADR-2605212100).
// Downstream commercial forks re-implement stripePost locally. Calls degrade silently.
async function stripePost(
  _path: string,
  _params: Record<string, string>,
  _stripeKey: string,
): Promise<{ ok: boolean; id?: string; errorMessage?: string }> {
  return {
    ok: false,
    errorMessage:
      "Stripe disabled in canonical etzhayyim repo (Charter Rider §1.3). " +
      "Patch your downstream commercial fork to re-implement stripePost.",
  };
}

interface BillingTenantRecord {
  did: string; tenantId: string; orgDid: string; orgName: string; planId: string;
  stripeCustomerId: string; status: string; maxUsers: number; maxMonthlyTxns: number;
  planActivatedAt: string; createdAt: string;
}
interface UsageMeterRecord {
  did: string; meterId: string; orgDid: string; meterType: string; periodMonth: string;
  deltaCount: number; createdAt: string;
}

async function cmdProvisionTenant(sdk: HostSDK, body: Uint8Array) {
  const args = decodeJson(body, {}) as Record<string, unknown>;
  const orgDid = str(args.orgDid ?? "");
  const orgName = str(args.orgName ?? "");
  const email = str(args.email ?? "");
  const planId = str(args.planId ?? "free");
  if (!orgDid || !orgName) return { ok: false, error: "orgDid and orgName required" };

  const e = bridgeFor(sdk, BILLING_DID);
  const rkey = `tenant-${slug(orgDid)}`;

  // Idempotency: one billing tenant per org (read from the Datom log by rkey).
  const existing = await e
    .read<BillingTenantRecord>({ collection: BILLING_TENANT_COLLECTION, rkey })
    .catch(() => ({ records: [] as { uri: string; value: BillingTenantRecord }[] }));
  const prev = existing.records[0]?.value;
  if (prev) {
    return {
      ok: true, tenantId: prev.tenantId, planId: prev.planId, status: prev.status,
      stripeCustomerId: prev.stripeCustomerId, alreadyExisted: true,
    };
  }

  const tenantId = genID("tenant");
  let stripeCustomerId = "";
  const stripeKey = str((sdk.env as Record<string, unknown>).STRIPE_SECRET_KEY ?? "");
  if (stripeKey && planId !== "free") {
    const res = await stripePost("customers", {
      name: orgName, email, "metadata[orgDid]": orgDid, "metadata[tenantId]": tenantId, "metadata[planId]": planId,
    }, stripeKey);
    if (res.ok && res.id) stripeCustomerId = res.id;
  }

  const limits = planLimits(planId);
  const now = nowISO();
  const record: BillingTenantRecord = {
    did: `${BILLING_DID}`, tenantId, orgDid, orgName, planId, stripeCustomerId,
    status: "active", maxUsers: limits.maxUsers, maxMonthlyTxns: limits.maxMonthlyTxns,
    planActivatedAt: now, createdAt: now,
  };
  await e.write({ collection: BILLING_TENANT_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { ok: true, tenantId, planId, status: "active", stripeCustomerId, alreadyExisted: false };
}

async function cmdGetTenantPlan(sdk: HostSDK, body: Uint8Array) {
  const args = decodeJson(body, {}) as Record<string, unknown>;
  const orgDid = str(args.orgDid ?? "");
  if (!orgDid) return { ok: false, error: "orgDid required" };

  const e = bridgeFor(sdk, BILLING_DID);
  const t = await e
    .read<BillingTenantRecord>({ collection: BILLING_TENANT_COLLECTION, rkey: `tenant-${slug(orgDid)}` })
    .catch(() => ({ records: [] as { uri: string; value: BillingTenantRecord }[] }));
  const tenant = t.records[0]?.value;
  if (!tenant) return { ok: false, error: "TenantNotFound" };

  // Aggregate this month's usage from the meter records (replaces the RisingWave MV).
  const meters = await e
    .read<UsageMeterRecord>({ collection: USAGE_METER_COLLECTION, limit: 100 })
    .catch(() => ({ records: [] as { uri: string; value: UsageMeterRecord }[] }));
  const month = nowMonth();
  const usageMap: Record<string, number> = {};
  for (const r of meters.records) {
    const m = r.value;
    if (m.orgDid !== orgDid || m.periodMonth !== month) continue;
    usageMap[m.meterType] = (usageMap[m.meterType] ?? 0) + Number(m.deltaCount ?? 0);
  }

  return {
    ok: true,
    tenantId: tenant.tenantId, orgDid: tenant.orgDid, planId: tenant.planId, status: tenant.status,
    maxUsers: tenant.maxUsers, maxMonthlyTxns: tenant.maxMonthlyTxns,
    stripeCustomerId: tenant.stripeCustomerId, planActivatedAt: tenant.planActivatedAt,
    usage: {
      xrpcRequests: usageMap.xrpc_request ?? 0,
      rwRows: usageMap.rw_row ?? 0,
      llmTokens: usageMap.llm_token ?? 0,
      langserverInvocations: usageMap.langserver_invocation ?? 0,
      pdsBytes: usageMap.pds_byte ?? 0,
    },
  };
}

async function cmdRecordUsage(sdk: HostSDK, body: Uint8Array) {
  const args = decodeJson(body, {}) as Record<string, unknown>;
  const orgDid = str(args.orgDid ?? "");
  const meterType = str(args.meterType ?? "");
  const deltaCount = Number(args.deltaCount ?? 1);
  const periodMonth = str(args.periodMonth ?? nowMonth());
  if (!orgDid || !meterType) return { ok: false, error: "orgDid and meterType required" };
  if (deltaCount <= 0) return { ok: false, error: "deltaCount must be > 0" };

  const e = bridgeFor(sdk, BILLING_DID);
  const meterId = genID("meter");
  const record: UsageMeterRecord = {
    did: BILLING_DID, meterId, orgDid, meterType, periodMonth, deltaCount, createdAt: nowISO(),
  };
  await e.write({ collection: USAGE_METER_COLLECTION, record: record as unknown as Record<string, unknown>, rkey: `meter-${meterId}` });
  return { ok: true, meterId };
}

async function cmdReportUsageToStripe(sdk: HostSDK, body: Uint8Array) {
  const args = decodeJson(body, {}) as Record<string, unknown>;
  const dryRun = Boolean(args.dryRun ?? false);
  const periodMonth = str(args.periodMonth ?? nowMonth());
  const stripeKey = str((sdk.env as Record<string, unknown>).STRIPE_SECRET_KEY ?? "");
  if (!stripeKey) return { ok: false, reported: 0, skipped: 0, errors: ["STRIPE_SECRET_KEY not configured (Stripe disabled in canonical repo)"] };

  const e = bridgeFor(sdk, BILLING_DID);
  const tenants = await e
    .read<BillingTenantRecord>({ collection: BILLING_TENANT_COLLECTION, limit: 100 })
    .catch(() => ({ records: [] as { uri: string; value: BillingTenantRecord }[] }));
  const meters = await e
    .read<UsageMeterRecord>({ collection: USAGE_METER_COLLECTION, limit: 100 })
    .catch(() => ({ records: [] as { uri: string; value: UsageMeterRecord }[] }));

  // Join paid tenants × this-month usage (the in-memory replacement for the RisingWave join).
  const paidByOrg = new Map<string, BillingTenantRecord>();
  for (const r of tenants.records) if (r.value.planId !== "free") paidByOrg.set(r.value.orgDid, r.value);
  const agg = new Map<string, { tenant: BillingTenantRecord; meterType: string; total: number }>();
  for (const r of meters.records) {
    const m = r.value;
    if (m.periodMonth !== periodMonth) continue;
    const tenant = paidByOrg.get(m.orgDid);
    if (!tenant) continue;
    const key = `${tenant.tenantId}:${m.meterType}`;
    const cur = agg.get(key) ?? { tenant, meterType: m.meterType, total: 0 };
    cur.total += Number(m.deltaCount ?? 0);
    agg.set(key, cur);
  }
  const rows = [...agg.values()];
  if (dryRun) return { ok: true, reported: 0, skipped: rows.length, errors: [], dryRun: true, periodMonth };

  let reported = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const row of rows) {
    if (!row.tenant.stripeCustomerId || row.total === 0) { skipped++; continue; }
    const res = await stripePost("billing/meter_events", {
      event_name: `kyber_${row.meterType}`,
      payload: JSON.stringify({ stripe_customer_id: row.tenant.stripeCustomerId, value: String(row.total) }),
      identifier: `${row.tenant.tenantId}:${periodMonth}:${row.meterType}`,
    }, stripeKey);
    if (res.ok) {
      reported++;
      const reportId = genID("srpt");
      const at = nowISO();
      await e.write({
        collection: STRIPE_REPORT_COLLECTION,
        record: {
          did: BILLING_DID, reportId, tenantId: row.tenant.tenantId, orgDid: row.tenant.orgDid,
          periodMonth, meterType: row.meterType, totalCount: row.total, stripeEventId: res.id ?? "",
          status: "reported", reportedAt: at, createdAt: at,
        },
        rkey: `srpt-${reportId}`,
      }).catch(() => {}); // non-fatal: Stripe event already sent
    } else {
      errors.push(`${row.tenant.tenantId}/${row.meterType}: ${res.errorMessage}`);
    }
  }
  return { ok: errors.length === 0, reported, skipped, errors, periodMonth };
}

// ───────────────────────────── Management / Integration (5) ─────────────────────────────

function cmdRegisterDepartments(_sdk: HostSDK, _body: Uint8Array) {
  // Department DIDs are pre-registered via kotodama.jsonld entities; this returns the roster.
  const entries = Object.entries(DEPT).map(([role, did]) => ({ role, did }));
  return { ok: true, departments: entries };
}

async function cmdDashboard(sdk: HostSDK, body: Uint8Array) {
  const args = decodeJson(body, {}) as Record<string, unknown>;
  const period = str(args.period ?? nowISO().slice(0, 7));
  // kqe replacement for the RisingWave getApqcCoverage MV — real counts off the Datom log.
  const e = bridgeFor(sdk, actorDID || "did:web:kyber.etzhayyim.com");
  const cov = await erpCoverage(e, {});
  const c = cov.counts;
  return {
    ok: true,
    period,
    modules: {
      accounting: { journalEntries: c.journalEntry ?? 0, accounts: c.account ?? 0 },
      apAr: { invoices: c.invoice ?? 0 },
      hr: { activeEmployees: c.employee ?? 0, departments: Object.keys(DEPT).length },
      procurement: { openPOs: c.purchaseOrder ?? 0 },
      inventory: { skus: c.inventoryItem ?? 0 },
      sales: { openOrders: c.salesOrder ?? 0 },
      asset: { activeAssets: c.fixedAsset ?? 0, depreciationRuns: c.depreciationRun ?? 0 },
      governance: { activeControls: c.policyControl ?? 0, openRiskIssues: c.riskIssue ?? 0 },
    },
    departments: Object.keys(DEPT),
    apqcL1Active: cov.apqcL1Active,
    modulesActive: cov.modulesActive,
    total: cov.total,
  };
}

// ───── Integration catalog (referenced from UI) ─────

const INTEGRATION_CATALOG = [
  { id: "mailer", name: "com.etzhayyim.apps.mailer", kind: "messaging", status: "available" },
  { id: "calendar", name: "com.etzhayyim.apps.calendar", kind: "scheduling", status: "available" },
  { id: "projector", name: "com.etzhayyim.projector", kind: "pm", status: "available" },
  { id: "drive", name: "com.etzhayyim.apps.drive", kind: "storage", status: "available" },
  { id: "apqc", name: "com.etzhayyim.apps.apqc", kind: "process-framework", status: "available" },
];

function cmdListIntegrationCatalog(_sdk: HostSDK, _body: Uint8Array) {
  return { ok: true, integrations: INTEGRATION_CATALOG, total: INTEGRATION_CATALOG.length };
}

async function cmdSyncIntegrationCatalog(sdk: HostSDK, _body: Uint8Array) {
  const e = bridgeFor(sdk, actorDID || "did:web:kyber.etzhayyim.com");
  const now = nowISO();
  for (const i of INTEGRATION_CATALOG) {
    const record = {
      did: actorDID || "did:web:kyber.etzhayyim.com", integrationId: i.id, name: i.name,
      category: i.kind, status: "available", createdAt: now,
    };
    await e
      .write({ collection: "com.etzhayyim.apps.openKyber.integrationBinding", record, rkey: `bind-${slug(i.id)}` })
      .catch(() => {}); // idempotent: skip duplicates on re-sync
  }
  return { ok: true, synced: INTEGRATION_CATALOG.length };
}

// ───────────────────────────── Reactive input ─────────────────────────────

export function handleComAtprotoSyncSubscribeReposCommit(
  _sdk: HostSDK,
  commit: ComAtprotoSyncSubscribeReposCommit,
): { ok: true; detail: string } {
  if (commit.action !== "create") return { ok: true, detail: "skip non-create" };
  const c = commit as unknown as Record<string, unknown>;
  const collection = str(commit.collection ?? "");
  inbox.inboundCommits.push({
    collection,
    repo: str(c.repo ?? c.did ?? ""),
    rkey: str(c.rkey ?? c.path ?? ""),
    time: nowISO(),
  });
  return { ok: true, detail: `accepted ${collection}` };
}

// ───────────────────────────── APQC projector bootstrap ─────────────────────────────

function cmdInitApqcProjector(sdk: HostSDK, body: Uint8Array) {
  const args = decodeJson(body, {}) as Record<string, unknown>;
  const projectorDid = str(args.projectorDid ?? APQC_PROJECTOR_DID);
  const projectorNanoid = str(args.projectorNanoid ?? APQC_PROJECTOR_NANOID);
  const scope = str(args.scope ?? "all");

  // 1. Follow projector so its subscribeRepos delivers kyber commits.
  sdk.pds.dispatch({
    type: "app.bsky.graph.follow",
    payload: { nanoid: projectorNanoid, subject: projectorDid },
  });

  // 2. Emit bootstrap record — projector onCommit detects this and auto-registers
  //    the 13 APQC L1 DIDs + 28 BPMN bindings (idempotent).
  const bootstrapRkey = genID("boot");
  sdk.pds.dispatch({
    type: "com.atproto.repo.createRecord",
    payload: {
      collection: "com.etzhayyim.apps.kyber.apqcBootstrap",
      recordJson: JSON.stringify({
        projectorDid,
        scope,
        requestedAt: nowISO(),
        org_id: "anon",
        user_id: "anon",
        actor_id: appId,
      }),
    },
  });

  return { ok: true, projectorDid, followed: true, bootstrapRkey, scope };
}

// ───────────────────────────── Command wiring ─────────────────────────────

function configureApp(sdk: HostSDK): void {
  const app = sdk.app;
  app
    // Accounting (5)
    .command(nsid("com.etzhayyim.apps.kyber.createJournalEntry"), async (_c, b) => cmdCreateJournalEntry(sdk, b),
      asAgentTool("Create a double-entry journal (debit/credit balance required)"),
      withCapabilityTags("accounting", "gl"))
    .command(nsid("com.etzhayyim.apps.kyber.listJournalEntries"), async (_c, b) => cmdListJournalEntries(sdk, b),
      asAgentTool("List journal entries (date/account filter)"),
      withCapabilityTags("accounting", "query"))
    .command(nsid("com.etzhayyim.apps.kyber.getTrialBalance"), async (_c, b) => cmdGetTrialBalance(sdk, b),
      asAgentTool("Trial balance as of date"),
      withCapabilityTags("accounting", "report"))
    .command(nsid("com.etzhayyim.apps.kyber.createAccount"), async (_c, b) => cmdCreateAccount(sdk, b),
      asAgentTool("Add a chart-of-accounts entry"),
      withCapabilityTags("accounting", "coa"))
    .command(nsid("com.etzhayyim.apps.kyber.seedChartOfAccounts"), async (_c, b) => cmdSeedChartOfAccounts(sdk, b),
      asAgentTool("Seed 25 IFRS-aligned default accounts (+ ISIC pack extensions)"),
      withCapabilityTags("accounting", "coa", "seed"))
    // AP/AR (2)
    .command(nsid("com.etzhayyim.apps.kyber.createInvoice"), async (_c, b) => cmdCreateInvoice(sdk, b),
      asAgentTool("Create invoice (AP or AR; multi-line items; tax)"),
      withCapabilityTags("finance", "invoice"))
    .command(nsid("com.etzhayyim.apps.kyber.listInvoices"), async (_c, b) => cmdListInvoices(sdk, b),
      asAgentTool("List invoices (direction/status filter)"),
      withCapabilityTags("finance", "query"))
    // HR (2)
    .command(nsid("com.etzhayyim.apps.kyber.registerEmployee"), async (_c, b) => cmdRegisterEmployee(sdk, b),
      asAgentTool("Register employee with department/position/salary"),
      withCapabilityTags("hr", "employee"))
    .command(nsid("com.etzhayyim.apps.kyber.listEmployees"), async (_c, b) => cmdListEmployees(sdk, b),
      asAgentTool("List employees (department/status filter)"),
      withCapabilityTags("hr", "query"))
    // Procurement (2)
    .command(nsid("com.etzhayyim.apps.kyber.createPurchaseOrder"), async (_c, b) => cmdCreatePurchaseOrder(sdk, b),
      asAgentTool("Create purchase order (vendor / items / delivery)"),
      withCapabilityTags("procurement", "po"))
    .command(nsid("com.etzhayyim.apps.kyber.listPurchaseOrders"), async (_c, b) => cmdListPurchaseOrders(sdk, b),
      asAgentTool("List purchase orders (vendor/status filter)"),
      withCapabilityTags("procurement", "query"))
    // Inventory (2)
    .command(nsid("com.etzhayyim.apps.kyber.registerInventoryItem"), async (_c, b) => cmdRegisterInventoryItem(sdk, b),
      asAgentTool("Register inventory item (SKU / warehouse / reorder)"),
      withCapabilityTags("inventory", "sku"))
    .command(nsid("com.etzhayyim.apps.kyber.listInventory"), async (_c, b) => cmdListInventory(sdk, b),
      asAgentTool("List inventory (category / warehouse / low-stock filter)"),
      withCapabilityTags("inventory", "query"))
    // Sales (2)
    .command(nsid("com.etzhayyim.apps.kyber.createSalesOrder"), async (_c, b) => cmdCreateSalesOrder(sdk, b),
      asAgentTool("Create sales order (customer / items / tax / shipping)"),
      withCapabilityTags("sales", "so"))
    .command(nsid("com.etzhayyim.apps.kyber.listSalesOrders"), async (_c, b) => cmdListSalesOrders(sdk, b),
      asAgentTool("List sales orders (customer/status filter)"),
      withCapabilityTags("sales", "query"))
    // Asset (3)
    .command(nsid("com.etzhayyim.apps.kyber.registerFixedAsset"), async (_c, b) => cmdRegisterFixedAsset(sdk, b),
      asAgentTool("Register fixed asset for capitalization and depreciation"),
      withCapabilityTags("asset", "fixed-asset"))
    .command(nsid("com.etzhayyim.apps.kyber.listFixedAssets"), async (_c, b) => cmdListFixedAssets(sdk, b),
      asAgentTool("List fixed assets (category/status/owner filter)"),
      withCapabilityTags("asset", "query"))
    .command(nsid("com.etzhayyim.apps.kyber.runDepreciation"), async (_c, b) => cmdRunDepreciation(sdk, b),
      asAgentTool("Run period depreciation and post an accumulating summary"),
      withCapabilityTags("asset", "depreciation", "accounting"))
    // Governance (3)
    .command(nsid("com.etzhayyim.apps.kyber.registerPolicyControl"), async (_c, b) => cmdRegisterPolicyControl(sdk, b),
      asAgentTool("Register policy/control item for governance and compliance"),
      withCapabilityTags("governance", "compliance", "control"))
    .command(nsid("com.etzhayyim.apps.kyber.recordRiskIssue"), async (_c, b) => cmdRecordRiskIssue(sdk, b),
      asAgentTool("Record enterprise risk issue with severity and mitigation plan"),
      withCapabilityTags("governance", "risk", "issue"))
    .command(nsid("com.etzhayyim.apps.kyber.listRiskIssues"), async (_c, b) => cmdListRiskIssues(sdk, b),
      asAgentTool("List risk issues (severity/status/owner filter)"),
      withCapabilityTags("governance", "risk", "query"))
    // Management (5 incl. integrations)
    .command(nsid("com.etzhayyim.apps.kyber.registerDepartments"), async (_c, b) => cmdRegisterDepartments(sdk, b),
      asAgentTool("Register the 7 department DIDs"),
      withCapabilityTags("management", "did"))
    .command(nsid("com.etzhayyim.apps.kyber.dashboard"), async (_c, b) => cmdDashboard(sdk, b),
      asAgentTool("ERP dashboard — period summary across 8 modules"),
      withCapabilityTags("management", "dashboard"))
    .command(nsid("com.etzhayyim.apps.kyber.listIntegrationCatalog"), async (_c, b) => cmdListIntegrationCatalog(sdk, b),
      asAgentTool("List available cross-app integrations"),
      withCapabilityTags("integration", "catalog"))
    .command(nsid("com.etzhayyim.apps.kyber.syncIntegrationCatalog"), async (_c, b) => cmdSyncIntegrationCatalog(sdk, b),
      asAgentTool("Sync integration catalog into integrationBinding records"),
      withCapabilityTags("integration", "sync"))
    // APQC/BPMN projector bootstrap (cross-project; ADR-0025)
    .command(nsid("com.etzhayyim.apps.kyber.initApqcProjector"), async (_c, b) => cmdInitApqcProjector(sdk, b),
      asAgentTool("Bootstrap kyber-projector: follow + emit apqcBootstrap record"),
      withCapabilityTags("apqc", "bpmn", "bootstrap", "cross-project"))
    // Billing (4) — ADR-2605072300 (kotoba-native, Stripe disabled in canonical repo)
    .command(nsid("com.etzhayyim.apps.kyber.provisionTenant"), async (_c, b) => cmdProvisionTenant(sdk, b),
      asAgentTool("Provision a kyber tenant (idempotent by orgDid). Called by yoro.etzhayyim.com signup flow."),
      withCapabilityTags("billing", "tenant", "signup"))
    .command(nsid("com.etzhayyim.apps.kyber.getTenantPlan"), async (_c, b) => cmdGetTenantPlan(sdk, b),
      asAgentTool("Return current plan, usage counters, and limits for a tenant"),
      withCapabilityTags("billing", "plan", "query"))
    .command(nsid("com.etzhayyim.apps.kyber.recordUsage"), async (_c, b) => cmdRecordUsage(sdk, b),
      asAgentTool("Append a usage delta to the usage meter (xrpc_request / rw_row / llm_token / langserver_invocation / pds_byte)"),
      withCapabilityTags("billing", "meter"))
    .command(nsid("com.etzhayyim.apps.kyber.reportUsageToStripe"), async (_c, b) => cmdReportUsageToStripe(sdk, b),
      asAgentTool("Flush monthly usage for paid tenants to Stripe Meter API (scheduled monthly)"),
      withCapabilityTags("billing", "stripe", "scheduled"));
}

// ───────────────────────────── Worker export ─────────────────────────────

export default createWorkerExport((sdk) => {
  appId = sdk.pds.selfNanoid ?? "kyb3rerp";
  actorDID = sdk.pds.selfRepo ?? "did:web:kyber.etzhayyim.com";
  void actorDID;
  void cadenceState;
  configureApp(sdk);
});
