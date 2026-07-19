/**
 * open-kyber kotoba — barrel. Open-source ERP (APQC-aligned), kotoba-E2E split
 * (ADR-2605181100): public accounting reference + integration catalog plaintext,
 * Tier-3 HR PII (employee) sealed via kotoba E2E. Fiat merchant-of-record usage
 * metering + warehouse/edge persistence EXECUTION stay etzhayyim via consent-capability.
 */
export * from "./types.js";
export {
  createAccount,
  listAccounts,
  registerIntegration,
  listIntegrations,
  registerEmployee,
  listEmployees,
  getEmployee,
  coverage,
} from "./registry.js";

// Money helpers (exact decimal, no float).
export { isMoney, sumMoney, subMoney, eqMoney, isZero } from "./money.js";

// Accounting module (kotoba-Datomic double-entry GL, 非終末論 reversal) — ADR-2606037200 D2.
export {
  JOURNAL_ENTRY_COLLECTION,
  validateLines,
  createJournalEntry,
  listJournalEntries,
  reverseJournalEntry,
  getTrialBalance,
} from "./accounting.js";
export type {
  JournalStatus,
  JournalLine,
  JournalEntryRecord,
  JournalEntryView,
  CreateJournalEntryInput,
  CreateJournalEntryOutput,
  ListJournalEntriesInput,
  ListJournalEntriesOutput,
  ReverseJournalEntryInput,
  ReverseJournalEntryOutput,
  TrialBalanceRow,
  TrialBalanceOutput,
} from "./accounting.js";

// Money helpers extension (depreciation math + inventory valuation).
export { mulMoneyInt, divMoney, mulMoney, divMoneyBy } from "./money.js";

// Asset module (fixed assets + straight-line depreciation, accumulating fact) — ADR-2606037200.
export {
  FIXED_ASSET_COLLECTION,
  DEPRECIATION_RUN_COLLECTION,
  straightLineSchedule,
  decliningBalanceSchedule,
  registerFixedAsset,
  listFixedAssets,
  runDepreciation,
  listDepreciationRuns,
} from "./assets.js";
export type {
  DepreciationMethod,
  FixedAssetRecord,
  FixedAssetView,
  RegisterFixedAssetInput,
  RegisterFixedAssetOutput,
  DepreciationRunRecord,
  DepreciationRunView,
} from "./assets.js";

// Core ERP modules: invoice / purchase-order / inventory / sales-order / governance.
export {
  INVOICE_COLLECTION,
  PURCHASE_ORDER_COLLECTION,
  INVENTORY_ITEM_COLLECTION,
  SALES_ORDER_COLLECTION,
  POLICY_CONTROL_COLLECTION,
  RISK_ISSUE_COLLECTION,
  createInvoice,
  listInvoices,
  createPurchaseOrder,
  listPurchaseOrders,
  registerInventoryItem,
  listInventory,
  createSalesOrder,
  listSalesOrders,
  registerPolicyControl,
  listPolicyControls,
  recordRiskIssue,
  listRiskIssues,
} from "./erp-modules.js";
export type {
  InvoiceDirection, InvoiceStatus, InvoiceRecord, CreateInvoiceInput,
  POStatus, PurchaseOrderRecord, CreatePurchaseOrderInput,
  InventoryItemRecord, RegisterInventoryItemInput,
  SOStatus, SalesOrderRecord, CreateSalesOrderInput,
  ControlStatus, RiskSeverity, RiskStatus, PolicyControlRecord, RiskIssueRecord,
} from "./erp-modules.js";

// Productivity suite (mailer / drive / docs / sheets / calendar) — ADR-2606037200 D5.
export {
  MAIL_COLLECTION, DRIVE_COLLECTION, DOC_COLLECTION, SHEET_COLLECTION, CALENDAR_COLLECTION,
  sendMail, listMail,
  putDriveNode, listDrive,
  putDoc, listDocs,
  putSheet, listSheets,
  createCalendarEvent, listCalendar,
} from "./suite.js";
export type {
  MailRecord, SendMailInput,
  DriveNodeType, DriveNodeRecord, PutDriveNodeInput,
  DocFormat, DocRecord,
  SheetRecord,
  CalendarEventRecord,
} from "./suite.js";

// ISIC industry-pack loader (one base + 21 section packs A–U + division packs) — ADR-2606037200 D3.
export {
  ISIC_SECTIONS,
  SECTION_PACKS,
  DIVISION_PACKS,
  sectionForDivision,
  divisionOf,
  resolvePacks,
} from "./isic-packs.js";
export type { PackScope, PackDescriptor, ResolveResult } from "./isic-packs.js";

export { SECTION_COA_EXT, DIVISION_COA_EXT, coaExtForPacks } from "./isic-packs.js";

// Tenant registration + ISIC pack activation (closes the ISIC story end-to-end) — D3.
export { TENANT_COLLECTION, registerTenant, getTenant, listTenants } from "./tenant.js";
export type { TenantRecord, TenantView, RegisterTenantInput, RegisterTenantOutput } from "./tenant.js";

// Chart-of-accounts seeding (base IFRS + ISIC-pack-aware industry accounts) — D2+D3.
export { BASE_CHART_OF_ACCOUNTS, seedChartOfAccounts } from "./seed.js";
export type { SeedChartInput, SeedChartOutput } from "./seed.js";

// Invoice → journal-entry posting (AP/AR ties to the GL) — D2.
export { postInvoice } from "./posting.js";
export type { PostInvoiceInput, PostInvoiceOutput } from "./posting.js";

// Order-to-cash: sales order → AR invoice (→ postInvoice → GL) — D2.
export { invoiceSalesOrder } from "./order-to-cash.js";
export type { InvoiceSalesOrderInput, InvoiceSalesOrderOutput } from "./order-to-cash.js";

// Purchase-to-pay: PO → receipt → AP invoice (→ postInvoice → GL) — D2.
export { receivePurchaseOrder, billPurchaseOrder } from "./purchase-to-pay.js";
export type { ReceivePurchaseOrderOutput, BillPurchaseOrderInput, BillPurchaseOrderOutput } from "./purchase-to-pay.js";

// Period close: closing entries (P&L → retained earnings) — D2.
export { closePeriod } from "./close.js";
export type { ClosePeriodInput, ClosePeriodOutput } from "./close.js";

// Financial statements (Balance Sheet + Income Statement) from CoA + trial balance — D2.
export { balanceSheet, incomeStatement } from "./statements.js";
export type { StatementLine, BalanceSheetOutput, IncomeStatementOutput } from "./statements.js";

// Cash-flow statement (3rd financial statement; direct method) — D2.
export { cashFlowStatement, cashFlowCategory } from "./cashflow.js";
export type { CashFlowCategory, CashFlowLine, CashFlowStatementOutput } from "./cashflow.js";

// Budget vs actual (per-account/period budget Datoms + variance report) — D2.
export { BUDGET_COLLECTION, setBudget, listBudgets, budgetVarianceReport } from "./budget.js";
export type { BudgetLineRecord, BudgetVarianceRow, BudgetVarianceOutput } from "./budget.js";

// Inventory movement ledger with moving-average cost (perpetual stock) — D2.
export {
  STOCK_MOVE_COLLECTION,
  receiveStock, issueStock, stockLedger, stockValuation,
} from "./inventory-ledger.js";
export type { StockMoveKind, StockMoveRecord, StockMoveView, StockMoveResult } from "./inventory-ledger.js";

// Multi-currency FX (rate table + conversion + base-currency consolidation) — D2.
export { FX_RATE_COLLECTION, setFxRate, getFxRate, convert, listFxRates, invoiceTotalsInBase } from "./fx.js";
export type { FxRateRecord, ConvertOutput, InvoiceTotalsInBaseOutput } from "./fx.js";

// Payment application: settle invoices vs cash, post to GL (partial/overpay aware) — D2.
export { PAYMENT_COLLECTION, recordPayment, listPayments } from "./payment.js";
export type { PaymentRecord, PaymentView, RecordPaymentInput, RecordPaymentOutput } from "./payment.js";

// Sheets formula engine (exact-decimal SUM/AVG/MIN/MAX + refs/ranges) + ERP binding — D5.
export { evaluateGrid } from "./sheets-eval.js";
export type { Cell, Grid, EvalResult } from "./sheets-eval.js";
export { buildTrialBalanceGrid } from "./sheets-erp.js";
export type { TrialBalanceGridOutput } from "./sheets-erp.js";

// Party master (customers/suppliers + credit limits) — D2.
export { PARTY_COLLECTION, registerParty, setCreditLimit, getParty, listParties } from "./party.js";
export type { PartyKind, PartyRecord, PartyView, RegisterPartyInput } from "./party.js";

// AR/AP aging report + credit-limit checking — D2.
export { arAging, apAging, creditCheck } from "./aging.js";
export type { AgingBucket, AgingInvoiceLine, AgingReport, CreditCheckOutput } from "./aging.js";

// Tax codes + consumption-tax / VAT report (output vs input tax) — D2.
export { TAX_CODE_COLLECTION, setTaxCode, listTaxCodes, taxReport } from "./tax.js";
export type { TaxCodeRecord, TaxReportRow, TaxReportOutput } from "./tax.js";

// Calendar RRULE expansion (suite recurring events) — D5.
export { parseRRule, expandRRule, expandCalendarEvent } from "./recurrence.js";
export type { Freq, ParsedRRule, ExpandInput } from "./recurrence.js";

// Docs Markdown structuring (outline / tree / links / word count) — D5.
export { parseMarkdown, buildTree, tableOfContents } from "./docs-md.js";
export type { Heading, MdLink, OutlineNode, MarkdownDoc } from "./docs-md.js";

// Drive file-tree core (path helpers / nested tree + size roll-up / content-addressed dedup
// / usage roll-up / read-only invariant audit) + SDK-bound tree view — D5.
export {
  normalizePath, parentPath, breadcrumb,
  buildDriveTree, resolvePath,
  dedupByCid, driveUsage, auditDriveTree,
  driveTreeFromStore,
} from "./drive-tree.js";
export type {
  DriveTreeNode, DedupGroup, DriveUsage, DriveAuditCheck, DriveAuditOutput, DriveTreeView,
} from "./drive-tree.js";

// Fixed-asset register / book-value roll-forward — D2.
export { assetRegister } from "./asset-register.js";
export type { AssetRegisterRow, AssetRegisterOutput } from "./asset-register.js";

// Ledger integrity audit (read-only invariant sweep) — D2.
export { ledgerAudit } from "./audit.js";
export type { AuditCheck, LedgerAuditOutput } from "./audit.js";

// All-module coverage rollup (kqe replacement for the RisingWave getApqcCoverage MV) — D1.
export { erpCoverage } from "./coverage-all.js";
export type { ErpCoverageOutput } from "./coverage-all.js";

// XrpcClient → Etzhayyim bridge (R2 worker-wiring keystone; lets the ERP Worker drop Kysely) — D1.
export { createXrpcBridge } from "./xrpc-bridge.js";
export type { XrpcRepoClient, EncryptedDelegates, BridgeOptions } from "./xrpc-bridge.js";
