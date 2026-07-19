# kyber-erp-core — open-kyber ERP as a kotoba WASM actor (ADR-2606037200 R3 PoC)

The "**worker itself as WASM/IPFS on the kotoba host**" step. Where the deployed ERP is a
Cloudflare TS Worker that reaches the Datom log over XRPC→PDS (the R2 cutover), this crate
compiles the ERP to a content-addressed **`kotoba-node` WASM component** that the kotoba host /
`e7m-wasm-runner` stores on IPFS (by CID) and runs, writing canonical ERP state **straight into
the kotoba Datom log via the `kqe` host import** — no CF Worker, no XRPC, no PDS hop.

## What it is (verified)
- A WASM **component** (WASI Preview 2), world `kotoba:kais/kotoba-node`: exports
  `run(ctx-cbor) -> result<list<u8>, string>`, imports `kotoba:kais/kqe` + `auth`.
- **Multi-command dispatch** over `run(ctx_cbor)` — the invoke contract is UTF-8 JSON
  `{ "method": "...", "args": {...} }`. (This pattern did not previously exist for a stateful
  multi-command service; existing actors expose a single `compute()`/`run()`.)
- Commands: `createAccount`, `seedChartOfAccounts`, `createJournalEntry` (exact double-entry
  Σdebit==Σcredit, i128 micros — never f64), `getTrialBalance` + `coverage` (best-effort reads
  via `kqe.query`, degrade to `pending-read`), `ping`.
- **CID** `bafkreigdcmd54zval3z7xwmvmq5tgbsu6rpbxx4gtyhswxhvvfkaltaomi` (raw single-block,
  119 KB). `wasm-tools validate` ✓.

## Build
```bash
./build.sh        # cargo build (wasm32-wasip2) + validate + CID
```
Requires the rustup toolchain with `wasm32-wasip2` (the Homebrew rustc lacks the wasm std —
build.sh pins PATH to rustup automatically).

## Run (operator, gated)
```bash
# publish the bytes to IPFS / kotoba block store, then:
node 50-infra/e7m-wasm-runner/runner.mjs --did did:web:etzhayyim.com:actor:kyber
# the runner resolves DID→CID (kotoba kg.entity 'actor/wasm-cid' → did.json EtzhayyimWasmComponent),
# fetches+verifies the CID, jco-transpiles the component, and calls run(ctx_cbor).
```

## Honest scope
- **PoC**: proves the actor model end-to-end for the WRITE path (the verified `kqe.assert-quad`
  pattern). The full 28-command surface + exact kotoba parity is the plan in
  `../../WORKER-AS-WASM-ACTOR-MIGRATION.md`.
- Reads use `kqe.query`; the kotoba Datalog dialect is host-verified, so they degrade honestly
  rather than shipping a guessed query as fact.
- Tier **T2 mesh** (component `run` ABI → executed via `e7m-wasm-runner`/kotoba host + jco), not
  the ameno raw-core `compute()` browser loader — despite the small raw CID.
- The deployed CF Worker (`kyb3rerp`) stays the live path until this actor is published +
  Council-ratified; the CID is recorded but the bytes are not yet pinned (operator step).
