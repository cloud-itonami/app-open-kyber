/**
 * open-kyber kotoba — registry.
 *
 * Plaintext path (account, integrationBinding): sdk.write / sdk.read — public
 * accounting reference data + open integration catalog.
 * E2E path (employee): sdk.encryptedWrite / sdk.encryptedRead — Tier-3 HR PII
 * (name / email / salary) sealed in the kotoba envelope (ADR-2605181100),
 * read-cap = owner DID (+ explicit recipients, e.g. HR dept DID). The substrate
 * never sees salary or personal contact in plaintext.
 *
 * Fiat merchant-of-record usage metering + warehouse/edge persistence EXECUTION
 * stay etzhayyim, consumed via consent-capability (not collections here).
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  ACCOUNT_COLLECTION,
  EMPLOYEE_INNER_TYPE,
  INTEGRATION_BINDING_COLLECTION,
  accountDidFor,
  accountRkey,
  employeeRkey,
  integrationDidFor,
  integrationRkey,
  isAccountType,
  isDecimalString,
  isEmploymentType,
  type AccountRecord,
  type AccountView,
  type CoverageInput,
  type CoverageOutput,
  type CreateAccountInput,
  type CreateAccountOutput,
  type EmployeeBody,
  type EmployeeView,
  type GetEmployeeInput,
  type GetEmployeeOutput,
  type IntegrationBindingRecord,
  type IntegrationBindingView,
  type ListAccountsInput,
  type ListAccountsOutput,
  type ListEmployeesInput,
  type ListEmployeesOutput,
  type ListIntegrationsInput,
  type ListIntegrationsOutput,
  type RegisterEmployeeInput,
  type RegisterEmployeeOutput,
  type RegisterIntegrationInput,
  type RegisterIntegrationOutput,
} from "./types.js";

const PAGE_LIMIT = 100;
const DEFAULT_MAX_SCAN = 10_000;

// ─── Account (PLAINTEXT) ────────────────────────────────────────────

export async function createAccount(e: Etzhayyim, input: CreateAccountInput): Promise<CreateAccountOutput> {
  if (!input.accountCode || !input.name) return { status: "rejected", error: "missingRequiredFields" };
  if (!isAccountType(input.accountType)) return { status: "rejected", error: "invalidAccountType" };
  const openingBalance = input.openingBalance ?? "0";
  if (!isDecimalString(openingBalance)) return { status: "rejected", error: "invalidOpeningBalance" };
  const rkey = accountRkey(input.accountCode);
  const existing = await e.read<AccountRecord>({ collection: ACCOUNT_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", accountUri: existing.records[0].uri, did: existing.records[0].value.did, accountCode: input.accountCode };
  }
  const did = accountDidFor(input.accountCode);
  const record: AccountRecord = {
    did,
    accountCode: input.accountCode,
    name: input.name,
    accountType: input.accountType,
    openingBalance,
    currency: input.currency ?? "JPY",
    createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({ collection: ACCOUNT_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "created", accountUri: receipt.uri, did, accountCode: input.accountCode };
}

export async function listAccounts(e: Etzhayyim, input: ListAccountsInput = {}): Promise<ListAccountsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<AccountRecord>({ collection: ACCOUNT_COLLECTION, cursor: input.cursor, limit });
  const items: AccountView[] = resp.records
    .filter((r) => !input.accountType || r.value.accountType === input.accountType)
    .map((r) => ({ ...r.value, accountUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Integration binding (PLAINTEXT, public catalog) ────────────────

export async function registerIntegration(e: Etzhayyim, input: RegisterIntegrationInput): Promise<RegisterIntegrationOutput> {
  if (!input.integrationId || !input.name || !input.category) return { status: "rejected", error: "missingRequiredFields" };
  const rkey = integrationRkey(input.integrationId);
  const existing = await e.read<IntegrationBindingRecord>({ collection: INTEGRATION_BINDING_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", bindingUri: existing.records[0].uri, did: existing.records[0].value.did, integrationId: input.integrationId };
  }
  const did = integrationDidFor(input.integrationId);
  const record: IntegrationBindingRecord = {
    did,
    integrationId: input.integrationId,
    name: input.name,
    category: input.category,
    status: input.status ?? "available",
    createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({ collection: INTEGRATION_BINDING_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "registered", bindingUri: receipt.uri, did, integrationId: input.integrationId };
}

export async function listIntegrations(e: Etzhayyim, input: ListIntegrationsInput = {}): Promise<ListIntegrationsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<IntegrationBindingRecord>({ collection: INTEGRATION_BINDING_COLLECTION, cursor: input.cursor, limit });
  const items: IntegrationBindingView[] = resp.records
    .filter((r) => !input.category || r.value.category === input.category)
    .map((r) => ({ ...r.value, bindingUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Employee (E2E-ENCRYPTED, Tier-3 PII) ───────────────────────────

export async function registerEmployee(e: Etzhayyim, input: RegisterEmployeeInput): Promise<RegisterEmployeeOutput> {
  if (!input.employeeId || !input.name || !input.email || !input.department) return { status: "rejected", error: "missingRequiredFields" };
  const salary = input.salary ?? "0";
  if (!isDecimalString(salary)) return { status: "rejected", error: "invalidSalary" };
  const employmentType = input.employmentType ?? "full-time";
  if (!isEmploymentType(employmentType)) return { status: "rejected", error: "invalidEmploymentType" };
  const body: EmployeeBody = {
    employeeId: input.employeeId,
    name: input.name,
    email: input.email,
    department: input.department,
    position: input.position ?? "",
    employmentType,
    salary,
    currency: input.currency ?? "JPY",
    hireDate: input.hireDate ?? new Date().toISOString().slice(0, 10),
  };
  // Read-cap = owner DID (sender, auto-wrapped) + any explicit recipients.
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: EMPLOYEE_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: employeeRkey(input.employeeId),
  });
  return { status: "registered", uri: receipt.uri, keyId: receipt.keyId, employeeId: input.employeeId };
}

async function scanEmployees(e: Etzhayyim, maxScan: number): Promise<EmployeeView[]> {
  const out: EmployeeView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<EmployeeBody>({ innerType: EMPLOYEE_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    }
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

export async function listEmployees(e: Etzhayyim, input: ListEmployeesInput = {}): Promise<ListEmployeesOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanEmployees(e, DEFAULT_MAX_SCAN);
  const filtered = all.filter((emp) => !input.department || emp.department === input.department);
  return { items: filtered.slice(0, limit), total: filtered.length };
}

export async function getEmployee(e: Etzhayyim, input: GetEmployeeInput): Promise<GetEmployeeOutput> {
  if (!input.employeeId) return { error: "invalidEmployeeId" };
  const all = await scanEmployees(e, DEFAULT_MAX_SCAN);
  const found = all.find((emp) => emp.employeeId === input.employeeId);
  if (!found) return { error: "notFound" };
  return { employee: found };
}

// ─── Coverage rollup ────────────────────────────────────────────────

export async function coverage(e: Etzhayyim, input: CoverageInput = {}): Promise<CoverageOutput> {
  const maxScan = Math.min(input.maxScan ?? DEFAULT_MAX_SCAN, DEFAULT_MAX_SCAN);
  const accountsByType: Record<string, number> = {};
  let accountCount = 0;
  let cursor: string | undefined;
  while (accountCount < maxScan) {
    const page = await e.read<AccountRecord>({ collection: ACCOUNT_COLLECTION, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      accountsByType[r.value.accountType] = (accountsByType[r.value.accountType] ?? 0) + 1;
      accountCount += 1;
    }
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }

  let integrationBindingCount = 0;
  let bcursor: string | undefined;
  while (integrationBindingCount < maxScan) {
    const page = await e.read<IntegrationBindingRecord>({ collection: INTEGRATION_BINDING_COLLECTION, cursor: bcursor, limit: PAGE_LIMIT });
    integrationBindingCount += page.records.length;
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    bcursor = page.cursor;
  }

  const employeeCount = (await scanEmployees(e, maxScan)).length;
  return {
    accountCount,
    integrationBindingCount,
    employeeCount,
    accountsByType,
    truncated: accountCount >= maxScan || employeeCount >= maxScan,
  };
}
