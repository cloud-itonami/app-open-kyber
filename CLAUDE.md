# etzhayyim-project-open-kyber — Open Source ERP (APQC-aligned)

> **Direction (ADR-2606037200, 2026-06-03)** — open-kyber is being promoted to a
> **kotoba-Datomic ERP**: canonical state = the kotoba Datom log (no RisingWave/Kysely/
> Hyperdrive), accounting as Datomic-accounting (`as-of` history, 非終末論), **ISIC industry
> packs** (one base + 21 section packs A–U + division packs → an ERP tailored to every
> industry), and a **kotoba-native productivity suite** (mailer over openmail Postage / drive
> on IPFS / docs+sheets as content-addressed blocks / calendar Datoms). Artifacts:
> `00-contracts/schemas/erp-ontology.kotoba.edn` (EAVT vocab) +
> `industry-packs/isic-packs.kotoba.edn` (packs). R0 = design landed; kotoba TS loader +
> XRPC wiring + tests are R1+. The APQC/BPMN sections below describe the current (ADR-0025)
> deployment; the read path migrates to kqe-over-Datom-log per ADR-2606037200 D1.

**Status**: Source-of-truth (2026-04-15; etzhayyim DID-swap 2026-05-21). Apache-2.0 OSS mirror originally at `github.com/etzhayyim/etzhayyim-project-open-kyber`; this monorepo (`github.com/etzhayyim/root`) runs the etzhayyim tenancy. Deployed instance: `kyber.etzhayyim.com` (replaces former `kyber.etzhayyim.com`). Legacy etzhayyim tenancy remains a separate proprietary deployment.

**Consolidates** the former `etzhayyim-project-kyber/appview/*`. Product brand = **Kyber**; repo folder = **open-kyber**. NSIDs remain `com.etzhayyim.apps.kyber.*` / `com.etzhayyim.kyber.projector.*` (rename would break deployed records + graph labels + ADR-0025 bootstrap).

## Folder Layout

```
60-apps/etzhayyim-project-open-kyber/
├── CLAUDE.md                                   # this file
├── PROJECT.jsonld                              # schema.org (Apache-2.0)
├── README.md                                   # OSS public readme
├── etzhayyim-wasm-kyber-erp-kyb3rerp/            # ERP Worker (kyber.etzhayyim.com, nanoid kyb3rerp)
│   ├── kotodama.jsonld                         # AI-Agent profile + triggers
│   ├── wrangler.jsonc                          # CF Worker config
│   ├── package.json
│   ├── src/app.ts                              # single-file ERP business logic (24 XRPC commands)
│   ├── svelte/                                 # Hono + Svelte read/write SPA
│   └── e2e/                                    # Playwright visual tests
└── etzhayyim-wasm-kyber-projector-kyb3proj/      # APQC/BPMN/OCEL projector (kyber-projector.etzhayyim.com)
    ├── kotodama.jsonld                         # 13 entities[] for path-based L1 DIDs
    ├── wrangler.jsonc
    ├── package.json
    └── src/app.ts                              # APQC_L1 + BPMN_CATALOG + 6 XRPC commands + onCommit
```

## App Identity

| Key | ERP | Projector |
|---|---|---|
| **nanoid** | `kyb3rerp` | `kyb3proj` |
| **AT bot DID** | `did:web:kyber.etzhayyim.com` | `did:web:kyber-projector.etzhayyim.com` |
| **Runtime** | TS Native (`src/app.ts` + `@etzhayyim/kotodama-host-sdk` → esbuild) | TS Native |
| **Write path** | `sdk.pds.dispatch({ type: "com.atproto.repo.createRecord", ... })` | same + `com.etzhayyim.apps.apqc.apqcEvent` OCEL emit |
| **Read path** | `createKyselyDb(env.HYPERDRIVE)` | Kysely + Hyperdrive |
| **UI** | Hono + Svelte CSR | headless (XRPC only) |

## OSS License Split

| Artifact | License |
|---|---|
| `CLAUDE.md`, `README.md`, `PROJECT.jsonld`, `etzhayyim-wasm-kyber-erp-kyb3rerp/**`, `etzhayyim-wasm-kyber-projector-kyb3proj/**` | Apache-2.0 |
| Deployed `kyber.etzhayyim.com` + `kyber-projector.etzhayyim.com` (and legacy `*.etzhayyim.com`) tenant data, Signal keys, Hyperdrive creds | Proprietary (not in repo) |
| `00-contracts/lexicons/com/etzhayyim/kyber/**`, `00-contracts/lexicons/com/etzhayyim/app/kyber/**` | Apache-2.0 (contract) |
| `90-docs/adr/0025-kyber-apqc-bpmn-projector-consolidation.md` | Apache-2.0 (governance record) |

Integrators running their own instance fork the repo, swap `wrangler.jsonc` bindings, and point `did:web` at their own domain. No code change required for white-labeling.

## ERP Coverage (APQC L1 → Collections)

| APQC L1 | Module | Collection | SQL Label |
|---|---|---|---|
| 9.0 Financial Resources | Accounting | `com.etzhayyim.apps.kyber.journal_entry` | `JournalEntry` |
| 9.0 Financial Resources | Accounting | `com.etzhayyim.apps.kyber.account` | `Account` |
| 9.0 Financial Resources | AP/AR | `com.etzhayyim.apps.kyber.invoice` | `Invoice` |
| 7.0 Human Capital | HR | `com.etzhayyim.apps.kyber.employee` | `Employee` |
| 4.0 Supply Chain | Procurement | `com.etzhayyim.apps.kyber.purchase_order` | `PurchaseOrder` |
| 5.0 Production/Ops | Inventory | `com.etzhayyim.apps.kyber.inventory_item` | `InventoryItem` |
| 3.0 Market & Sell | Sales | `com.etzhayyim.apps.kyber.sales_order` | `SalesOrder` |
| 10.0 Manage Enterprise Assets | Asset | `com.etzhayyim.apps.kyber.fixed_asset` | `FixedAsset` |
| 10.0 Manage Enterprise Assets | Asset | `com.etzhayyim.apps.kyber.depreciation_run` | `DepreciationRun` |
| 11.0 Manage Enterprise Risk/Compliance | Governance | `com.etzhayyim.apps.kyber.policy_control` | `PolicyControl` |
| 11.0 Manage Enterprise Risk/Compliance | Governance | `com.etzhayyim.apps.kyber.risk_issue` | `RiskIssue` |

NSIDs use snake_case kind intentionally (deployed data compat). New records added post-consolidation MUST use camelCase per the 60-apps convention.

## Department DIDs (Multi-DID)

| DID | Role |
|---|---|
| `did:web:kyber.etzhayyim.com:dept:accounting` | Accounting writer |
| `did:web:kyber.etzhayyim.com:dept:hr` | HR writer |
| `did:web:kyber.etzhayyim.com:dept:procurement` | Procurement writer |
| `did:web:kyber.etzhayyim.com:dept:inventory` | Inventory writer |
| `did:web:kyber.etzhayyim.com:dept:sales` | Sales writer |
| `did:web:kyber.etzhayyim.com:dept:asset` | Asset writer |
| `did:web:kyber.etzhayyim.com:dept:governance` | Governance writer |

## ERP XRPC Commands — 24 total

### Accounting (5)
`createJournalEntry` · `listJournalEntries` · `getTrialBalance` · `createAccount` · `seedChartOfAccounts`

### AP/AR (2)
`createInvoice` · `listInvoices`

### HR (2)
`registerEmployee` · `listEmployees`

### Procurement (2)
`createPurchaseOrder` · `listPurchaseOrders`

### Inventory (2)
`registerInventoryItem` · `listInventory`

### Sales (2)
`createSalesOrder` · `listSalesOrders`

### Asset (3)
`registerFixedAsset` · `listFixedAssets` · `runDepreciation`

### Governance (3)
`registerPolicyControl` · `recordRiskIssue` · `listRiskIssues`

### Management (5)
`registerDepartments` · `dashboard` · `listIntegrationCatalog` · `syncIntegrationCatalog` · `initApqcProjector`

## Projector XRPC Commands — 12 total

Under `com.etzhayyim.kyber.projector.*`:
`registerApqcActors` · `listApqcActors` · `listBpmnTasks` · `runBpmnTask` · `getApqcCoverage` · `emitApqcEvent`

Compatibility layer:
`listProcessGroups` · `getProcessGroup` · `listProcesses` · `getProcess` · `listActivities` · `getActivity`

BPMN 2.0 catalog: 28 task bindings (7 reactive `kyberCollection` + 21 explicit `runBpmnTask`). See ADR-0025 for the full table and OCEL 2.0 event shape.

## Bootstrap Flow (ADR-0025)

```
ERP → POST /xrpc/com.etzhayyim.apps.kyber.initApqcProjector
    → follow(kyb3proj) + createRecord(apqcBootstrap)
    → projector.onCommit → registerApqcActors (13 L1 DIDs)

ERP write (createJournalEntry etc.)
    → Repo commit (com.etzhayyim.apps.kyber.journal_entry)
    → projector.onCommit → emit com.etzhayyim.apps.apqc.apqcEvent (OCEL)
    → RisingWave streaming MV → getApqcCoverage
```

## Build & Deploy

```bash
# ERP
cd 60-apps/etzhayyim-project-open-kyber/etzhayyim-wasm-kyber-erp-kyb3rerp
pnpm install
e7m actor deploy .

# Projector
cd 60-apps/etzhayyim-project-open-kyber/etzhayyim-wasm-kyber-projector-kyb3proj
pnpm install
e7m actor deploy .
```

## Svelte SPA

```bash
cd 60-apps/etzhayyim-project-open-kyber/etzhayyim-wasm-kyber-erp-kyb3rerp/svelte
pnpm install
pnpm build
pnpm start
```

Hono server serves `dist/` and fallbacks to `index.html`. Svelte SPA calls `/xrpc/com.etzhayyim.apps.kyber.*` on the same Worker origin.

## Relationship to Other Projects

| Project | Relationship |
|---|---|
| `etzhayyim-project-apqc` | Upstream PCF 13 L1 classification SSoT (183 sub-DIDs). |
| `etzhayyim-project-bpmn` | Upstream BPMN 2.0 registry. |
| `etzhayyim-project-open-jpn-gov` | Sibling Apache-2.0 mirror pattern. |
| ADR-0025 | Consolidation rationale (13-WASM → 1 Worker, η 0.08 → 0.95). |

## Not in Scope (integrator responsibility)

- Payroll calculation, salary fields (Tier 3 PII)
- Multi-currency FX revaluation (needs market feed)
- Consolidation / inter-company elimination
- Country-specific tax filing
- Bank feed ingestion
- Signal E2E encrypted fields (use `etzhayyim-project-vault`)

## Migration Note (2026-04-15)

Former path `60-apps/etzhayyim-project-kyber/appview/*` has been consolidated into `60-apps/etzhayyim-project-open-kyber/*`. Git history preserved via `git mv`. No NSID, DID, or deployed-record rename. Updated:

- `deps.toml [[conventions]]` source paths (ADR-0025 row)
- `90-docs/adr/0025-kyber-apqc-bpmn-projector-consolidation.md` Implementation + References
- `90-docs/rules/silent-catch-baseline.txt`
