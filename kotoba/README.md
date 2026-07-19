# @etzhayyim/open-kyber-kotoba

The kotoba-Datomic reference implementation of the **open-kyber ERP** (ADR-2606037200).
Every function reads/writes the kotoba Datom log via the `@etzhayyim/sdk` `Etzhayyim`
surface — **no RisingWave / Kysely / Hyperdrive** (ADR-2605262130). Money is exact decimal
(BigInt fixed-point, no float); accounting is non-終末論 (corrections are new asserted facts,
never edits). The ERP Worker reaches these through `createXrpcBridge` (see
`../R2-WORKER-WIRING.md`).

```
pnpm install      # workspace deps (@etzhayyim/sdk, @etzhayyim/sdk-mock)
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest — 19 files, 88 tests
```

## Module surface

### Core ERP modules (8, APQC-aligned)
| Module | File | What |
|---|---|---|
| Accounting | `accounting.ts` | double-entry GL, trial balance, `reverseJournalEntry` (contra, non-終末論) |
| Chart-of-accounts | `registry.ts` · `seed.ts` | `createAccount`; `seedChartOfAccounts` (IFRS base + ISIC-pack accounts) |
| AP/AR | `erp-modules.ts` | `createInvoice` / `listInvoices` (+ `taxCode`) |
| HR | `registry.ts` | `registerEmployee` — Tier-3 PII E2E-sealed (envelope pointer only) |
| Procurement | `erp-modules.ts` | `createPurchaseOrder` |
| Inventory | `erp-modules.ts` · `inventory-ledger.ts` | item register + perpetual **moving-average** stock ledger |
| Sales | `erp-modules.ts` | `createSalesOrder` |
| Asset | `assets.ts` | fixed assets + depreciation (straight-line **and** declining-balance) |
| Governance | `erp-modules.ts` | policy controls + risk issues |

### Business flows
| Flow | File | What |
|---|---|---|
| Order-to-cash | `order-to-cash.ts` | `invoiceSalesOrder`: SO → AR invoice |
| Purchase-to-pay | `purchase-to-pay.ts` | `receivePurchaseOrder` + `billPurchaseOrder`: PO → AP invoice |
| Invoice posting | `posting.ts` | `postInvoice`: AP/AR invoice → balanced JE (ties to GL) |
| Payment | `payment.ts` | `recordPayment`: settle invoice vs cash (partial / overpay aware) |
| Period close | `close.ts` | `closePeriod`: P&L → Retained Earnings closing entry |

### Reporting
| Report | File | What |
|---|---|---|
| Statements | `statements.ts` | `balanceSheet` + `incomeStatement` (asserts the accounting identity) |
| Cash flow | `cashflow.ts` | `cashFlowStatement` (direct method; operating/investing/financing) |
| Aging | `aging.ts` | `arAging` / `apAging` (current/1-30/31-60/61-90/90+) + `creditCheck` |
| Tax | `tax.ts` | `taxReport` (output vs input 消費税/VAT, by code + currency) + code registry |
| Budget | `budget.ts` | `setBudget` + `budgetVarianceReport` (budget vs actual) |
| Coverage | `coverage-all.ts` | `erpCoverage` (all-module rollup; kqe getApqcCoverage replacement) |
| FX | `fx.ts` | rate table + `convert` + `invoiceTotalsInBase` (multi-currency consolidation) |

### Masters & tenancy
| | File | What |
|---|---|---|
| Party master | `party.ts` | customers/suppliers + credit limits |
| Tenant + ISIC | `tenant.ts` · `isic-packs.ts` | `registerTenant` resolves ISIC codes → active industry packs |

### Productivity suite (D5)
| | File | What |
|---|---|---|
| mailer / drive / docs / sheets / calendar | `suite.ts` | kotoba-native suite objects (mail over Postage, drive on IPFS, …) |
| Sheets engine | `sheets-eval.ts` · `sheets-erp.ts` | exact-decimal formula engine + live trial-balance worksheet |
| Docs structuring | `docs-md.ts` | Markdown → outline / nested tree / links / word count / TOC |
| Calendar recurrence | `recurrence.ts` | RRULE expansion (FREQ/INTERVAL/COUNT/UNTIL) |

### Substrate plumbing
| | File | What |
|---|---|---|
| Money | `money.ts` | exact decimal: sum/sub/mul/div, `mulMoney`/`divMoneyBy` |
| Worker bridge | `xrpc-bridge.ts` | adapt kotodama-host-sdk `XrpcClient` → `Etzhayyim` (R2 keystone) |
| Shared helpers | `_shared.ts` | idempotent create + full-scan list |

## Industry packs (ISIC, D3)

The base ERP + one composable overlay per ISIC Rev.4 section (21, A–U) + division packs.
Definitions (CoA extensions / units / compliance / KPIs / actor links) are the documentation
SSoT in `../industry-packs/isic-packs.kotoba.edn`; `isic-packs.ts` carries the runtime
resolver (`resolvePacks`, `SECTION_COA_EXT`). A tenant declares its ISIC activity and the
matching packs activate — so a manufacturer's ledger ships with Raw Materials / WIP /
Finished Goods, a bank's with Loans & Reserves, etc.

## References
- `90-docs/adr/2606037200-open-kyber-kotoba-datomic-erp-isic-industry-packs-productivity-suite.md`
- `00-contracts/schemas/erp-ontology.kotoba.edn` (EAVT vocabulary)
- `../R2-WORKER-WIRING.md` (wiring the ERP Worker to these functions)
