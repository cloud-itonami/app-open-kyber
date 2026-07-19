# open-kyber ERP — Worker → kotoba WASM/IPFS actor migration

> **Status**: design + landed PoC (R3). Companion to `R2-WORKER-WIRING.md` (which moved STATE
> to kotoba) and `SUITE-PY-WASM-MIGRATION.md` (suite cores). Anchors: ADR-2606037200,
> ADR-2606014500/14600/15200/15400 (WASM-actor runtime), ADR-2605262130 + 2605312345 (kotoba),
> ADR-2605215000 (Murakumo-only), ADR-2605231525 (no-server-key).

## 1. Goal & the two layers

The R2 cutover changed **where ERP STATE lives** (RisingWave → kotoba Datom log) but left the
ERP running as a **Cloudflare TS Worker** (`kyb3rerp`, `wrangler deploy`, JS on CF edge). This
migration changes **where the ERP CODE runs**: from a CF Worker into a **content-addressed WASM
actor** the kotoba host / `e7m-wasm-runner` stores on IPFS (by CID) and executes.

```
R2 (done):   [CF Worker JS] ──XRPC──▶ [kotoba Datom log]      ← state moved
R3 (this):   [WASM actor on IPFS] ──kqe host import──▶ [kotoba Datom log]   ← code moved too
             stored by CID + run on the kotoba host / e7m mesh; no CF Worker
```

## 2. The runtime contract (verified against the live WIT)

A kotoba WASM actor is a **WASM component** in the world `kotoba:kais/kotoba-node`
(`40-engine/kotoba/crates/kotoba-runtime/wit/world.wit`):

- exports `run(ctx-cbor: list<u8>) -> result<list<u8>, string>` — called per Invoke.
- imports `kqe` (Datom log: `assert-quad` / `retract-quad` / `query` / `get-objects` /
  `get-head` / `evaluate-rules`), `auth` (`current-did` / `verify-cacao` / `has-capability`),
  and optionally `llm` / `evm` / `btc` / `chain` / `egress`.

State is the kotoba Datom log directly — **no XRPC, no PDS, no RisingWave**. The actor asserts
Datoms with `kqe.assert-quad` (the kotoba record kinds map 1:1 to Datom subjects/predicates).

**Multi-command dispatch** (the new pattern): a stateful ERP has 28 commands, but the ABI is a
single `run`. The PoC defines the envelope as UTF-8 JSON `{ "method", "args" }`; `run` decodes
it and dispatches. The kotoba CBOR `InvokeContext { graph, session_cid, args }` → this JSON
envelope is the host adapter (one shim, host-side).

## 3. Storage & execution on the kotoba host

1. **Build** → `cargo build --target wasm32-wasip2 --release` → a `.wasm` component.
2. **Address** → `ipfs add --cid-version=1` → CID (raw single-block if small, else dag-pb).
3. **Store** → pin the bytes to IPFS / `kotoba block put` (operator, gated).
4. **Advertise** → `wasmCid` in `50-infra/etzhayyim-did-web/src/registry/infra-actors.ts`
   → the apex Worker issues `did.json` with an `EtzhayyimWasmComponent` service
   (`serviceEndpoint: ipfs://<cid>`), and/or the kotoba `kg.entity` `actor/wasm-cid` claim.
5. **Run** → `e7m-wasm-runner`: `didToCid` (kotoba-first `com.etzhayyim.apps.kotobase.kg.entity`
   → did.json fallback) → `fetchVerified` (raw re-hash / dag-pb CAR walk) → `runBytes`
   (component → jco transpile → `run`). The "kotoba host" that stores+runs the wasm = the
   kotoba pod / e7m-wasm-runner node class (ADR-2606012100).

## 4. Tiering — which actors can be browser-local

| Tier | Artifact | CID | Runtime | Fits the ERP? |
|---|---|---|---|---|
| **T1 browser** | Rust core, `compute()` ABI, raw CID ≤~256 KB | `bafkrei…` | ameno (`isRawCidV1`) | partial — only stateless leaf commands (a `dashboard` carve-out) |
| **T2 mesh** | component, `run` ABI (any size) | raw or dag-pb | e7m-wasm-runner / kotoba host (jco) | **yes** — the stateful multi-command ERP |

The ERP is a stateful, read-heavy, multi-command service → **T2 mesh** is the right tier. The
PoC is a component (`run` ABI), so even though its CID is small+raw it runs via the mesh path,
not the ameno raw-`compute()` browser loader. (Browser-local ERP would need the Datom AEVT/AVET
read indexes, ADR-2605262130 D7, plus a `compute()`-ABI carve-out per command.)

## 5. Language choice (decided)

| Option | Verdict |
|---|---|
| **Rust** (chosen) | ✅ compact (PoC 119 KB), fast, first-class `kotoba:kais` WIT bindings (wit-bindgen), exact i128 decimal, no CPython bloat. Matches tsumugi/kanae. |
| componentize-py | CPython ~17 MB dag-pb (T2 only); fine for the suite cores (`SUITE-PY-WASM-MIGRATION.md`) but heavy for the ERP. |
| Javy (TS→QuickJS) | only a PoC adapter exists (`50-infra/sveltejs-adapter-wasm`); no `componentize-js`; not production for actors. Would reuse kotoba TS but adds a JS engine. |

**Rust port of the kotoba logic** is the path. kotoba's pure-decimal accounting
(`money.ts`/`accounting.ts`) ports cleanly to i128; the TS test vectors are the conformance
oracle (same approach as `SUITE-PY-WASM-MIGRATION.md`).

## 6. The landed PoC

`wasm/kyber-erp-core/` — a real, built, CID-bearing `kotoba-node` component:
- exports `run`, imports `kqe`+`auth`; `wasm-tools validate` ✓.
- commands: `createAccount`, `seedChartOfAccounts`, `createJournalEntry` (Σdebit==Σcredit exact,
  i128 micros), `getTrialBalance` + `coverage` (best-effort `kqe.query`), `ping`.
- CID `bafkreigdcmd54zval3z7xwmvmq5tgbsu6rpbxx4gtyhswxhvvfkaltaomi` (119 KB).
- registered as `did:web:etzhayyim.com:actor:kyber` in `infra-actors.ts` (wasmCid).

## 7. Plan to full parity (28 commands)

1. **Port the kotoba pure cores to Rust** (money, accounting GL, AP/AR, inventory
   moving-average, depreciation, statements) behind the `kqe` Datom mapping — conformance vs the
   TS Vitest vectors.
2. **Datom read path**: replace the best-effort `kqe.query` reads with the verified kotoba
   Datalog dialect (or `get-objects` over indexed AEVT/AVET once D7 ships) for `list*` /
   `getTrialBalance` / `erpCoverage`.
3. **HR E2E**: the employee path needs the encrypted-envelope host surface (ADR-2605181100)
   from inside WASM — keep "refuse rather than drop PII" until wired.
4. **Multi-DID writer**: `kqe` writes under the actor's `auth.current-did`; department tagging
   stays a record field (the bridge model). Per-dept signing = no-server-key member sig.
5. **CBOR InvokeContext adapter** host-side (CBOR → `{method,args}` JSON).
6. **Publish + ratify**: pin bytes, set wasmCid, Council + operator gate (ADR-2606012100); the
   CF Worker (`kyb3rerp`) stays the live path until then.

## 8. Honest limits
- PoC proves the WRITE path + actor model; reads + full accounting parity are the port above.
- No live kotoba host in this checkout → the actor is built + validated + CID-computed, but not
  run against a live runtime here (the e7m-runner command is documented).
- Bytes are not pinned and the deploy is operator + Council gated; nothing about the live
  `kyb3rerp` Worker changes until then.
