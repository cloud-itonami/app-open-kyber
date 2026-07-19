---
id: open-kyber-r2-worker-wiring
title: "open-kyber R2 — wire the ERP Worker to the kotoba kotoba-Datomic functions"
status: active
doc_type: how-to
topic: open-kyber-kotoba-datomic-erp
authoritative: true
last_verified: 2026-06-03
related:
  - "90-docs/adr/2606037200-open-kyber-kotoba-datomic-erp-isic-industry-packs-productivity-suite.md"
---

# open-kyber R2 — wire the ERP Worker to kotoba (remove RisingWave/Kysely)

> **Status (2026-06-06): Steps 1–2 + 5-source DONE in `src/app.ts`.** The Worker no longer
> references `createKyselyDb`/`HYPERDRIVE`; all 28 commands route through the kotoba functions
> via `createXrpcBridge`, and `app.ts` type-checks clean against the package sources. What
> remains is the **operator deploy** (`e7m actor build`/`deploy` + smoke) where that toolchain
> exists, and **Step 3** (new suite/tenant/ISIC commands — still pending lexicon authoring +
> codegen). The steps below are retained as the deploy + Step-3 reference.

**Goal**: replace the ERP Worker's `createKyselyDb(env.HYPERDRIVE)` read paths (prohibited
under ADR-2605262130 — no RisingWave) with the tested, kotoba-Datomic kotoba functions,
via the `createXrpcBridge` keystone. This is R2 of ADR-2606037200.

**Why a runbook and not a committed app.ts patch**: the worker package
(`etzhayyim-wasm-kyber-erp-kyb3rerp`) has **no `typecheck`/build script** and is not in the
pnpm workspace, so app.ts edits cannot be type-checked or tested in this repo's harness.
The kotoba layer (functions + bridge) **is** fully tested (8 files, 43 tests green). Apply
the steps below where an `e7m actor build` / esbuild harness exists, then run a deploy smoke.

## Step 0 — add the kotoba dep + an Etzhayyim encrypted client

In `etzhayyim-wasm-kyber-erp-kyb3rerp/package.json`:

```jsonc
"dependencies": {
  "@etzhayyim/kotodama-host-sdk": "workspace:*",
  "@etzhayyim/open-kyber-kotoba": "workspace:*",
  "@etzhayyim/sdk": "workspace:*"        // for the encrypted employee envelope
}
```

## Step 1 — build the bridge once per request (replaces createKyselyDb)

Delete every `const db = createKyselyDb((sdk.env as ...).HYPERDRIVE as never);` line. In its
place, build a bridge from `sdk.pds` (the AT-repo XrpcClient). For the E2E employee path,
pass `@etzhayyim/sdk` encrypted delegates; everything else is plaintext.

```ts
import { createXrpcBridge } from "@etzhayyim/open-kyber-kotoba";
import { Etzhayyim } from "@etzhayyim/sdk";

function bridgeFor(sdk: HostSDK, did: string) {
  const e2e = new Etzhayyim({ did /* + pds/ipfs/l2 config from env */ });
  return createXrpcBridge(sdk.pds as never, {
    did,
    encrypted: { encryptedWrite: e2e.encryptedWrite.bind(e2e), encryptedRead: e2e.encryptedRead.bind(e2e) },
  });
}
```

`createKyselyDb` and `HYPERDRIVE` should have **zero remaining references** when done
(`grep -n 'createKyselyDb\|HYPERDRIVE' src/app.ts` → empty). Remove the `createKyselyDb`
import from the `@etzhayyim/kotodama-host-sdk` import block.

## Step 2 — replace each cmd* handler body with an kotoba call

The XRPC surface and NSIDs stay identical (deployed-record compat). Only the body changes —
from a Kysely query that "returns empty envelopes" to a real kqe-over-Datom-log call.

| XRPC command (`com.etzhayyim.apps.kyber.*`) | kotoba function | notes |
|---|---|---|
| `createAccount` | `createAccount(e, b)` | plaintext |
| `seedChartOfAccounts` | loop `createAccount` over the 25-row IFRS seed | idempotent |
| `createJournalEntry` | `createJournalEntry(e, b)` | enforces debit=credit balance |
| `listJournalEntries` | `listJournalEntries(e, b)` | |
| `getTrialBalance` | `getTrialBalance(e, b)` | nets reversed pairs to zero |
| `createInvoice` | `createInvoice(e, b)` | |
| `listInvoices` | `listInvoices(e, b)` | |
| `registerEmployee` | `registerEmployee(e, b)` | **E2E** — needs `encrypted` delegates |
| `listEmployees` | `listEmployees(e, b)` | **E2E** |
| `createPurchaseOrder` | `createPurchaseOrder(e, b)` | |
| `listPurchaseOrders` | `listPurchaseOrders(e, b)` | |
| `registerInventoryItem` | `registerInventoryItem(e, b)` | |
| `listInventory` | `listInventory(e, b)` | |
| `createSalesOrder` | `createSalesOrder(e, b)` | |
| `listSalesOrders` | `listSalesOrders(e, b)` | |
| `registerFixedAsset` | `registerFixedAsset(e, b)` | |
| `listFixedAssets` | `listFixedAssets(e, b)` | |
| `runDepreciation` | `runDepreciation(e, b)` | straight-line, accumulating |
| `registerPolicyControl` | `registerPolicyControl(e, b)` | |
| `recordRiskIssue` | `recordRiskIssue(e, b)` | |
| `listRiskIssues` | `listRiskIssues(e, b)` | |
| `dashboard` / `getApqcCoverage` | `erpCoverage(e)` | kqe replacement for the RisingWave MV; `apqcL1Active` feeds kyb3proj |

Handler shape (per the kotodama F2 pattern):

```ts
sdk.app.command(nsid("com.etzhayyim.apps.kyber.createInvoice"), async (_c, b) => {
  const e = bridgeFor(sdk, DEPT.accounting);
  const input = parseLexiconInput("com.etzhayyim.apps.kyber.createInvoice", b);
  return JSON.stringify(await createInvoice(e, input));
}, asAgentTool("Create invoice (AP or AR; tax)"));
```

Use the right `DEPT.*` DID per module (accounting / hr / procurement / inventory / sales /
asset / governance) so the writer DID matches the department, as today.

## Step 3 — add the NEW commands (suite + tenant + ISIC packs)

These have no legacy handler. Add lexicons under
`00-contracts/lexicons/com/etzhayyim/apps/kyber/` (procedure/query per the kotodama
"new app command" steps), regenerate `lexicon-nsid-types.ts`, then wire:

| New command | kotoba function |
|---|---|
| `registerTenant` / `getTenant` / `listTenants` | `registerTenant` / `getTenant` / `listTenants` |
| `sendMail` / `listMail` | `sendMail` / `listMail` |
| `putDriveNode` / `listDrive` | `putDriveNode` / `listDrive` |
| `putDoc` / `listDocs` · `putSheet` / `listSheets` | `putDoc`/`listDocs` · `putSheet`/`listSheets` |
| `createCalendarEvent` / `listCalendar` | `createCalendarEvent` / `listCalendar` |
| `resolveIsicPacks` | `resolvePacks(isicCodes)` (pure; no `e` needed) |

## Step 4 — kyb3proj projector

The projector's `getApqcCoverage` moves from the RisingWave streaming MV to a call into the
ERP Worker's `erpCoverage` (or recomputes from the same `:apqc/l1` Datoms). The
`apqcL1Active` array is the populated-category set the projector reports. No OCEL change.

## Step 5 — verify

```bash
cd etzhayyim-wasm-kyber-erp-kyb3rerp
grep -n 'createKyselyDb\|HYPERDRIVE\|RisingWave' src/app.ts   # → expect empty
e7m actor build .                                              # esbuild bundle OK
e7m actor deploy .                                             # deploy
# smoke: createAccount → createJournalEntry → getTrialBalance (balanced) → dashboard
```

Acceptance: list/read paths return real records (not the pre-R2 empty envelopes); trial
balance balances; `dashboard`/coverage reports active APQC L1 categories; no RisingWave /
Kysely / Hyperdrive reference remains in the religious-corp ERP path.

## Honest limits

- The encrypted employee path requires a configured `@etzhayyim/sdk` Etzhayyim instance
  (PDS/IPFS/L2 env). Without it, `bridgeFor` should omit `encrypted` and the HR commands
  return the bridge's "encrypted transport not configured" error rather than dropping PII.
- The bridge's `read` uses AT `listRecords` pagination; for very large collections the kqe
  arrangement (AEVT/AVET) is the Phase-2.5 optimization (ADR-2605262130 D7). Functionally
  correct now; index-optimized later.
