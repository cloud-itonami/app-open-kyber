/**
 * open-kyber kotoba — core ERP modules (kotoba-Datomic, ADR-2606037200).
 *
 * AP/AR invoice (APQC 9.0) · procurement purchase-order (4.0) · inventory item (5.0) ·
 * sales order (3.0) · governance policy-control + risk-issue (11.0). All plaintext
 * collections on the kotoba Datom log (no PII here — HR PII stays E2E in registry.ts).
 * Money as exact decimal STRINGS. Each create is idempotent on its natural key.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import { isMoney } from "./money.js";
import { OPEN_KYBER_DID_PREFIX } from "./types.js";
import { createUnique, listAll, slug } from "./_shared.js";

// ─── AP/AR Invoice (APQC 9.0) ───────────────────────────────────────────────
export const INVOICE_COLLECTION = "com.etzhayyim.apps.openKyber.invoice";
export type InvoiceDirection = "receivable" | "payable";
export type InvoiceStatus = "open" | "partial" | "paid" | "void";
export interface InvoiceRecord {
  did: string; number: string; direction: InvoiceDirection; party: string;
  issued: string; due: string; amount: string; tax?: string; taxCode?: string; currency: string;
  status: InvoiceStatus; createdAt: string;
}
export interface CreateInvoiceInput {
  number: string; direction: InvoiceDirection; party: string; amount: string;
  due?: string; issued?: string; tax?: string; taxCode?: string; currency?: string; status?: InvoiceStatus;
}
export async function createInvoice(e: Etzhayyim, i: CreateInvoiceInput) {
  if (!i.number || !i.party) return { status: "rejected" as const, error: "missingRequiredFields" };
  if (i.direction !== "receivable" && i.direction !== "payable") return { status: "rejected" as const, error: "invalidDirection" };
  if (!isMoney(i.amount)) return { status: "rejected" as const, error: "invalidAmount" };
  if (i.tax !== undefined && !isMoney(i.tax)) return { status: "rejected" as const, error: "invalidTax" };
  const record: InvoiceRecord = {
    did: `${OPEN_KYBER_DID_PREFIX}inv:${slug(i.number)}`, number: i.number, direction: i.direction,
    party: i.party, issued: i.issued ?? new Date().toISOString(), due: i.due ?? new Date().toISOString(),
    amount: i.amount, tax: i.tax, taxCode: i.taxCode, currency: i.currency ?? "JPY", status: i.status ?? "open",
    createdAt: new Date().toISOString(),
  };
  const r = await createUnique(e, INVOICE_COLLECTION, `inv-${slug(i.number)}`, record);
  return r.created ? { status: "created" as const, uri: r.uri, number: i.number } : { status: "alreadyExists" as const, uri: r.uri, number: i.number };
}
export async function listInvoices(e: Etzhayyim, f: { direction?: InvoiceDirection; status?: InvoiceStatus; limit?: number } = {}) {
  return listAll<InvoiceRecord>(e, INVOICE_COLLECTION,
    (v) => (!f.direction || v.direction === f.direction) && (!f.status || v.status === f.status), f.limit);
}

// ─── Procurement Purchase Order (APQC 4.0) ──────────────────────────────────
export const PURCHASE_ORDER_COLLECTION = "com.etzhayyim.apps.openKyber.purchaseOrder";
export type POStatus = "draft" | "sent" | "received" | "closed" | "cancelled";
export interface PurchaseOrderRecord {
  did: string; number: string; supplier: string; ordered: string; status: POStatus;
  total: string; currency: string; createdAt: string;
}
export interface CreatePurchaseOrderInput {
  number: string; supplier: string; total: string; ordered?: string; status?: POStatus; currency?: string;
}
export async function createPurchaseOrder(e: Etzhayyim, i: CreatePurchaseOrderInput) {
  if (!i.number || !i.supplier) return { status: "rejected" as const, error: "missingRequiredFields" };
  if (!isMoney(i.total)) return { status: "rejected" as const, error: "invalidTotal" };
  const record: PurchaseOrderRecord = {
    did: `${OPEN_KYBER_DID_PREFIX}po:${slug(i.number)}`, number: i.number, supplier: i.supplier,
    ordered: i.ordered ?? new Date().toISOString(), status: i.status ?? "draft", total: i.total,
    currency: i.currency ?? "JPY", createdAt: new Date().toISOString(),
  };
  const r = await createUnique(e, PURCHASE_ORDER_COLLECTION, `po-${slug(i.number)}`, record);
  return r.created ? { status: "created" as const, uri: r.uri, number: i.number } : { status: "alreadyExists" as const, uri: r.uri, number: i.number };
}
export async function listPurchaseOrders(e: Etzhayyim, f: { status?: POStatus; limit?: number } = {}) {
  return listAll<PurchaseOrderRecord>(e, PURCHASE_ORDER_COLLECTION, (v) => !f.status || v.status === f.status, f.limit);
}

// ─── Inventory Item (APQC 5.0) ──────────────────────────────────────────────
export const INVENTORY_ITEM_COLLECTION = "com.etzhayyim.apps.openKyber.inventoryItem";
export interface InventoryItemRecord {
  did: string; sku: string; name: string; uom: string; qty: string; unitCost: string;
  currency: string; unspsc?: string; createdAt: string;
}
export interface RegisterInventoryItemInput {
  sku: string; name: string; uom?: string; qty?: string; unitCost?: string; currency?: string; unspsc?: string;
}
export async function registerInventoryItem(e: Etzhayyim, i: RegisterInventoryItemInput) {
  if (!i.sku || !i.name) return { status: "rejected" as const, error: "missingRequiredFields" };
  const qty = i.qty ?? "0";
  const unitCost = i.unitCost ?? "0";
  if (!isMoney(qty)) return { status: "rejected" as const, error: "invalidQty" };
  if (!isMoney(unitCost)) return { status: "rejected" as const, error: "invalidUnitCost" };
  const record: InventoryItemRecord = {
    did: `${OPEN_KYBER_DID_PREFIX}sku:${slug(i.sku)}`, sku: i.sku, name: i.name, uom: i.uom ?? "pcs",
    qty, unitCost, currency: i.currency ?? "JPY", unspsc: i.unspsc, createdAt: new Date().toISOString(),
  };
  const r = await createUnique(e, INVENTORY_ITEM_COLLECTION, `sku-${slug(i.sku)}`, record);
  return r.created ? { status: "registered" as const, uri: r.uri, sku: i.sku } : { status: "alreadyExists" as const, uri: r.uri, sku: i.sku };
}
export async function listInventory(e: Etzhayyim, f: { limit?: number } = {}) {
  return listAll<InventoryItemRecord>(e, INVENTORY_ITEM_COLLECTION, undefined, f.limit);
}

// ─── Sales Order (APQC 3.0) ─────────────────────────────────────────────────
export const SALES_ORDER_COLLECTION = "com.etzhayyim.apps.openKyber.salesOrder";
export type SOStatus = "quote" | "confirmed" | "fulfilled" | "invoiced" | "cancelled";
export interface SalesOrderRecord {
  did: string; number: string; customer: string; ordered: string; status: SOStatus;
  total: string; currency: string; createdAt: string;
}
export interface CreateSalesOrderInput {
  number: string; customer: string; total: string; ordered?: string; status?: SOStatus; currency?: string;
}
export async function createSalesOrder(e: Etzhayyim, i: CreateSalesOrderInput) {
  if (!i.number || !i.customer) return { status: "rejected" as const, error: "missingRequiredFields" };
  if (!isMoney(i.total)) return { status: "rejected" as const, error: "invalidTotal" };
  const record: SalesOrderRecord = {
    did: `${OPEN_KYBER_DID_PREFIX}so:${slug(i.number)}`, number: i.number, customer: i.customer,
    ordered: i.ordered ?? new Date().toISOString(), status: i.status ?? "quote", total: i.total,
    currency: i.currency ?? "JPY", createdAt: new Date().toISOString(),
  };
  const r = await createUnique(e, SALES_ORDER_COLLECTION, `so-${slug(i.number)}`, record);
  return r.created ? { status: "created" as const, uri: r.uri, number: i.number } : { status: "alreadyExists" as const, uri: r.uri, number: i.number };
}
export async function listSalesOrders(e: Etzhayyim, f: { status?: SOStatus; limit?: number } = {}) {
  return listAll<SalesOrderRecord>(e, SALES_ORDER_COLLECTION, (v) => !f.status || v.status === f.status, f.limit);
}

// ─── Governance: Policy Control + Risk Issue (APQC 11.0) ────────────────────
export const POLICY_CONTROL_COLLECTION = "com.etzhayyim.apps.openKyber.policyControl";
export const RISK_ISSUE_COLLECTION = "com.etzhayyim.apps.openKyber.riskIssue";
export type ControlStatus = "active" | "draft" | "retired";
export type RiskSeverity = "low" | "medium" | "high" | "critical";
export type RiskStatus = "open" | "mitigating" | "closed";
export interface PolicyControlRecord {
  did: string; code: string; title: string; framework?: string; status: ControlStatus; createdAt: string;
}
export interface RiskIssueRecord {
  did: string; issueId: string; title: string; severity: RiskSeverity; status: RiskStatus;
  control?: string; createdAt: string;
}
const SEVERITIES = new Set<RiskSeverity>(["low", "medium", "high", "critical"]);
export async function registerPolicyControl(e: Etzhayyim, i: { code: string; title: string; framework?: string; status?: ControlStatus }) {
  if (!i.code || !i.title) return { status: "rejected" as const, error: "missingRequiredFields" };
  const record: PolicyControlRecord = {
    did: `${OPEN_KYBER_DID_PREFIX}ctrl:${slug(i.code)}`, code: i.code, title: i.title,
    framework: i.framework, status: i.status ?? "active", createdAt: new Date().toISOString(),
  };
  const r = await createUnique(e, POLICY_CONTROL_COLLECTION, `ctrl-${slug(i.code)}`, record);
  return r.created ? { status: "registered" as const, uri: r.uri, code: i.code } : { status: "alreadyExists" as const, uri: r.uri, code: i.code };
}
export async function listPolicyControls(e: Etzhayyim, f: { framework?: string; limit?: number } = {}) {
  return listAll<PolicyControlRecord>(e, POLICY_CONTROL_COLLECTION, (v) => !f.framework || v.framework === f.framework, f.limit);
}
export async function recordRiskIssue(e: Etzhayyim, i: { issueId: string; title: string; severity: RiskSeverity; status?: RiskStatus; control?: string }) {
  if (!i.issueId || !i.title) return { status: "rejected" as const, error: "missingRequiredFields" };
  if (!SEVERITIES.has(i.severity)) return { status: "rejected" as const, error: "invalidSeverity" };
  const record: RiskIssueRecord = {
    did: `${OPEN_KYBER_DID_PREFIX}risk:${slug(i.issueId)}`, issueId: i.issueId, title: i.title,
    severity: i.severity, status: i.status ?? "open", control: i.control, createdAt: new Date().toISOString(),
  };
  const r = await createUnique(e, RISK_ISSUE_COLLECTION, `risk-${slug(i.issueId)}`, record);
  return r.created ? { status: "recorded" as const, uri: r.uri, issueId: i.issueId } : { status: "alreadyExists" as const, uri: r.uri, issueId: i.issueId };
}
export async function listRiskIssues(e: Etzhayyim, f: { severity?: RiskSeverity; status?: RiskStatus; limit?: number } = {}) {
  return listAll<RiskIssueRecord>(e, RISK_ISSUE_COLLECTION,
    (v) => (!f.severity || v.severity === f.severity) && (!f.status || v.status === f.status), f.limit);
}
