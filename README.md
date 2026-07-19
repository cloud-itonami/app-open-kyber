# open-kyber — Open Source ERP (APQC-aligned, kotoba-Datomic)

Apache-2.0 ERP whose canonical state is the **kotoba Datom log** (content-addressed EAVT,
Datomic-isomorphic) — no RisingWave / Postgres / Kysely. Built on AT Protocol + APQC PCF +
BPMN 2.0, with exact-decimal accounting and non-終末論 (corrections are new asserted facts,
never edits). Aligned to ISIC Rev.4 so every industry gets a tailored chart of accounts.

Source-of-truth for the Kyber ERP product. The etzhayyim tenancy runs at
`kyber.etzhayyim.com` (this monorepo). Fork to run your own instance.

## What's inside

- **kotoba-Datomic reference** (`kotoba/`) — the canonical, fully-tested implementation
  (34 modules, 100 tests; see `kotoba/README.md`). The complete accounting cycle
  (double-entry GL → AP/AR → payment application → period close → Balance Sheet / Income
  Statement / Cash Flow), moving-average inventory, multi-currency FX, consumption-tax/VAT
  reporting, budgeting, AR/AP aging + credit limits, the fixed-asset register, and a
  read-only ledger-integrity audit — all on the Datom log, verified end to end.
- **ISIC industry packs** (`industry-packs/isic-packs.kotoba.edn`) — one base ERP + an
  overlay per ISIC Rev.4 section (21, A–U) + division packs (15), with section- and
  division-level chart-of-accounts extensions: a pharma maker gets GMP batch costing, a
  bank an interbank book, etc. A tenant declares its ISIC activity and the packs activate.
- **Productivity suite** (`kotoba/suite.ts` + engines) — mailer (over openmail Postage),
  drive (versioned IPFS files), docs (Markdown outline/TOC), sheets (exact-decimal formula
  engine, bindable to live ERP data), calendar (RRULE expansion). All kotoba-native.
- **ERP Worker** (`etzhayyim-wasm-kyber-erp-kyb3rerp/`) — the deployed XRPC surface
  (`com.etzhayyim.apps.kyber.*`), with an **APQC/BPMN projector** (`…-kyb3proj`) and 7
  department-writer DIDs. Its read path is migrating from the legacy RisingWave projection
  (ADR-0025) to kqe-over-Datom-log per `R2-WORKER-WIRING.md`.

## Architecture (canonical, kotoba-Datomic)

```
Client → XRPC /xrpc/com.etzhayyim.apps.kyber.*
      → ERP Worker  ── createXrpcBridge ──▶  kotoba functions
      → assert Datoms into the kotoba log   (canonical state)
      → kqe arrangements (EAVT/AEVT/AVET/VAET) for reads + erpCoverage (getApqcCoverage)
```

IPFS = block backend · AT-Proto MST = ingress/interop wire · Base L2 = trust anchor over the
commit-DAG root. See `90-docs/adr/2606037200-…` for the full design and ADR-0025 for the
prior (superseded read-path) consolidation rationale.

## Coverage (kotoba reference)

Included: GL, AP/AR, payment, period close, BS/PL/CF, inventory (moving-average), fixed
assets + depreciation (straight-line + declining-balance), multi-currency conversion,
consumption-tax/VAT reporting, budgeting, aging + credit limits, ledger audit, ISIC packs,
the productivity suite. Tier-3 HR PII (salary/contact) is E2E-sealed (envelope pointer only).

Not included: payroll calculation, FX *revaluation* (conversion yes), inter-company
consolidation, country-specific tax *filing* (reporting yes), bank-feed ingestion. Bring
your own PDS, IPFS, auth, and Tier-3 PII store.

## Quickstart (reference)

```bash
cd kotoba && pnpm install && pnpm test     # 23 files, 100 tests
```

The ERP Worker deploy + projector bootstrap are unchanged; see `CLAUDE.md` and
`R2-WORKER-WIRING.md` for wiring the worker to the kotoba-Datomic functions.

## License

Apache-2.0 + etzhayyim Charter Compliance Rider. Instances publish records as `isBot: true`
per the AT Protocol AI-Agent profile convention.
