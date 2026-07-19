/**
 * open-kyber kotoba — Open-source ERP (APQC-aligned), kotoba-E2E split.
 *
 * Per ADR-0025 (kyber APQC/BPMN consolidation) + ADR-2606011400 (Consensys
 * product-front / infra-back) + ADR-2605172400 (3-axis) + ADR-2605181100
 * (kotoba E2E encrypted-record envelope). Founder directive 2026-06-03: PII /
 * CUI / LE may migrate to etzhayyim when made safe via kotoba E2E.
 *
 * SPLIT (designed from the real ERP surface in
 * etzhayyim-wasm-kyber-erp-kyb3rerp/src/app.ts):
 *
 *   PUBLIC (plaintext AT records)
 *     - account            chart-of-accounts reference data (code/name/type).
 *                          Pure accounting reference — no subject PII. Frontable.
 *     - integrationBinding public integration catalog (mailer/calendar/drive/
 *                          apqc…) — open app-discovery metadata.
 *
 *   SENSITIVE / PII (kotoba E2E, com.etzhayyim.encrypted.record)
 *     - employee           HR record: name / email / department / position +
 *                          salary (Tier-3 PII, explicitly "Not in Scope" for
 *                          plaintext per open-kyber CLAUDE.md). Sealed via
 *                          sdk.encryptedWrite (read-cap = owner DID + explicit
 *                          recipients, e.g. the HR department DID). The substrate
 *                          never sees salary / personal contact in plaintext.
 *
 *   STAYS etzhayyim (consumed via consent-capability, NOT a collection)
 *     - usage metering toward the fiat merchant-of-record settlement EXECUTION.
 *     - warehouse / edge persistence + APQC OCEL projector streaming-view
 *       EXECUTION (the regulated act of running the substrate, not the records).
 *     The resulting DATA records migrate (plaintext above / E2E above); only the
 *     EXECUTION stays etzhayyim.
 *
 * AT-Lexicon: no float. Money (account balances, salary) carried as decimal
 * STRINGS; counts are integers.
 */

// Plaintext public collections.
export const ACCOUNT_COLLECTION = "com.etzhayyim.apps.openKyber.account";
export const INTEGRATION_BINDING_COLLECTION = "com.etzhayyim.apps.openKyber.integrationBinding";
// E2E inner-type NSID (body shape inside the encrypted envelope).
export const EMPLOYEE_INNER_TYPE = "com.etzhayyim.apps.openKyber.employee";

export const OPEN_KYBER_DID_PREFIX = "did:web:kyber.etzhayyim.com:" as const;

// ─── Account (PLAINTEXT, chart-of-accounts reference) ───────────────

export type AccountType = "asset" | "contra-asset" | "liability" | "equity" | "revenue" | "expense";

export interface AccountRecord {
  did: string;
  accountCode: string;
  name: string;
  accountType: AccountType;
  /** Opening balance as a decimal STRING (no float in AT-Lexicon). */
  openingBalance: string;
  currency: string;
  createdAt: string;
}
export interface AccountView extends AccountRecord {
  accountUri: string;
}
export interface CreateAccountInput {
  accountCode: string;
  name: string;
  accountType: AccountType;
  openingBalance?: string;
  currency?: string;
}
export interface CreateAccountOutput {
  status: "created" | "alreadyExists" | "rejected";
  accountUri?: string;
  did?: string;
  accountCode?: string;
  error?: string;
}
export interface ListAccountsInput {
  accountType?: AccountType;
  limit?: number;
  cursor?: string;
}
export interface ListAccountsOutput {
  items: AccountView[];
  cursor?: string;
  total: number;
}

// ─── Integration binding (PLAINTEXT, public catalog) ────────────────

export interface IntegrationBindingRecord {
  did: string;
  integrationId: string;
  name: string;
  category: string;
  status: string;
  createdAt: string;
}
export interface IntegrationBindingView extends IntegrationBindingRecord {
  bindingUri: string;
}
export interface RegisterIntegrationInput {
  integrationId: string;
  name: string;
  category: string;
  status?: string;
}
export interface RegisterIntegrationOutput {
  status: "registered" | "alreadyExists" | "rejected";
  bindingUri?: string;
  did?: string;
  integrationId?: string;
  error?: string;
}
export interface ListIntegrationsInput {
  category?: string;
  limit?: number;
  cursor?: string;
}
export interface ListIntegrationsOutput {
  items: IntegrationBindingView[];
  cursor?: string;
  total: number;
}

// ─── Employee (E2E-ENCRYPTED, Tier-3 PII) ───────────────────────────

export type EmploymentType = "full-time" | "part-time" | "contract" | "intern";

export interface EmployeeBody {
  employeeId: string;
  name: string;
  email: string;
  department: string;
  position: string;
  employmentType: EmploymentType;
  /** Annual salary as a decimal STRING (no float in AT-Lexicon). */
  salary: string;
  currency: string;
  hireDate: string;
}
export interface EmployeeView extends EmployeeBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface RegisterEmployeeInput {
  employeeId: string;
  name: string;
  email: string;
  department: string;
  position?: string;
  employmentType?: EmploymentType;
  salary?: string;
  currency?: string;
  hireDate?: string;
  /** Extra DIDs to grant read-cap (owner always included). */
  recipients?: string[];
}
export interface RegisterEmployeeOutput {
  status: "registered" | "rejected";
  uri?: string;
  keyId?: string;
  employeeId?: string;
  error?: string;
}
export interface ListEmployeesInput {
  department?: string;
  limit?: number;
  cursor?: string;
}
export interface ListEmployeesOutput {
  items: EmployeeView[];
  cursor?: string;
  total: number;
}
export interface GetEmployeeInput {
  employeeId: string;
}
export interface GetEmployeeOutput {
  employee?: EmployeeView;
  error?: string;
}

// ─── Coverage rollup ────────────────────────────────────────────────

export interface CoverageInput {
  maxScan?: number;
}
export interface CoverageOutput {
  accountCount?: number;
  integrationBindingCount?: number;
  employeeCount?: number;
  accountsByType?: Record<string, number>;
  truncated?: boolean;
  error?: string;
}

// ─── Validation + helpers ───────────────────────────────────────────

const ACCOUNT_TYPES: ReadonlySet<string> = new Set([
  "asset",
  "contra-asset",
  "liability",
  "equity",
  "revenue",
  "expense",
]);
const EMPLOYMENT_TYPES: ReadonlySet<string> = new Set([
  "full-time",
  "part-time",
  "contract",
  "intern",
]);

export function isAccountType(s: unknown): s is AccountType {
  return typeof s === "string" && ACCOUNT_TYPES.has(s);
}
export function isEmploymentType(s: unknown): s is EmploymentType {
  return typeof s === "string" && EMPLOYMENT_TYPES.has(s);
}
/** Validates a non-negative decimal money STRING (no float types). */
export function isDecimalString(s: unknown): s is string {
  return typeof s === "string" && /^\d+(\.\d+)?$/.test(s);
}
export function accountDidFor(code: string): string {
  return `${OPEN_KYBER_DID_PREFIX}acct:${code.toLowerCase()}`;
}
export function accountRkey(code: string): string {
  return `acct-${code.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
export function integrationDidFor(id: string): string {
  return `${OPEN_KYBER_DID_PREFIX}bind:${id.toLowerCase()}`;
}
export function integrationRkey(id: string): string {
  return `bind-${id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
export function employeeRkey(id: string): string {
  return `emp-${id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
