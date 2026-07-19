# open-kyber productivity suite — Python-LangGraph → WASM migration design

> **Status**: design (R0). Companion to `R2-WORKER-WIRING.md`. Anchors:
> ADR-2606037200 D5 (suite), ADR-2606014500/14600/15200/15400 (WASM-actor runtime),
> ADR-2605262130 + 2605312345 (kotoba canonical state), ADR-2605215000 (Murakumo-only),
> ADR-2605231525 (no-server-key).

## 1. Why

The suite's compute today is **TypeScript** in `kotoba/src/` — four pure-function cores
plus their SDK-bound wrappers:

| Suite app | Pure core (this repo) | Output |
|---|---|---|
| sheets | `sheets-eval.ts` `evaluateGrid` | exact-decimal cell values + error cells |
| docs | `docs-md.ts` `parseMarkdown` | outline / tree / links / word count |
| calendar | `recurrence.ts` `expandRRule` | RFC-5545 occurrence list |
| drive | `drive-tree.ts` `buildDriveTree` / `dedupByCid` / `auditDriveTree` | folder tree + size roll-up + dedup + audit |

The substrate target (ADR-2606014500 "one Worker, many WASM actors") is **content-addressed
WASM on IPFS, run browser-local (ameno, T1) or on the donated mesh (e7m, T2)** — not a
per-app server. The directive also names **py/WASM** as the cell runtime. So the cores must
become **Python-LangGraph cells compiled to WASM**, identity-addressed by CID, with the
kotoba Datom log as the only state.

This is a *runtime* migration, not a *logic* rewrite: the TS cores stay as the reference
oracle (their Vitest suites are the conformance spec the Python ports must match).

## 2. Target shape (grounded in the existing watatsuna/watatsumi pattern)

The repo already ships this exact pipeline for the watatsuna actor. We reuse it verbatim.

```
60-apps/etzhayyim-project-open-kyber/suite-cells/
├── sheets_eval/
│   ├── cell.py            # LangGraph StateGraph(dict) — the port of evaluateGrid
│   ├── state_machine.py   # phases + dataclass state (watatsumi pattern)
│   ├── app.py             # class WitWorld: run(ctx_cbor)->bytes  (componentize-py entry)
│   ├── wit/world.wit      # world kotoba-node { import kqe; import llm; export run; }
│   ├── build.sh           # componentize-py + jco transpile + ipfs add
│   └── test_conformance.py# asserts parity vs the TS sheets.test.ts vectors
├── docs_md/ …             # port of parseMarkdown
├── recurrence/ …          # port of expandRRule
└── drive_tree/ …          # port of buildDriveTree / dedupByCid / auditDriveTree
```

### 2.1 Cell module (LangGraph, pure — no inference)

The four cores are **pure functions**, so each is a trivial single-node StateGraph. Mirror
`orgs/etzhayyim/com-etzhayyim-watatsumi/cells/section_assembly/cell.py`:

```python
# suite-cells/drive_tree/cell.py
from langgraph.graph import StateGraph, START, END
from .logic import build_drive_tree, dedup_by_cid, drive_usage, audit_drive_tree

class DriveTreeCell:
    def __init__(self) -> None:
        self.graph = self._build()

    def _build(self):
        g = StateGraph(dict)
        g.add_node("compute", self._compute)
        g.add_edge(START, "compute")
        g.add_edge("compute", END)
        return g.compile()

    def _compute(self, state: dict) -> dict:
        nodes = state["nodes"]
        return {
            "tree": build_drive_tree(nodes),
            "usage": drive_usage(nodes),
            "dedup": dedup_by_cid(nodes),
            "audit": audit_drive_tree(nodes),
        }

    def solve(self, input_state: dict) -> dict:
        return self.graph.invoke(input_state)
```

`logic.py` is a line-for-line port of `drive-tree.ts` (pure; no I/O). Keep `cell.py` and
`logic.py` separate so `logic.py` stays unit-testable without LangGraph and is the conformance
target.

> The pure cores import **nothing** for inference. Murakumo-only (ADR-2605215000) is a
> non-issue for these four — they do no LLM work. The `import llm` in the WIT world below is
> kept only because future suite cells (e.g. a docs "summarize" or a sheets NL→formula) WILL
> need it, and it must route through the host `llm` capability (LiteLLM 127.0.0.1:4000), never
> a bundled model or vendor SDK.

### 2.2 WASM entry (componentize-py)

The host ABI is the **`kotoba-node` world** already used by the migration bakeoff
(`70-tools/scripts/kotoba-migration-bakeoff/runs/watatsumi-section_assembly/gemini/agent.wit`):

```wit
package etzhayyim:open-kyber-suite;

interface kqe {
  record quad { graph: string, subject: string, predicate: string, object-cbor: list<u8> }
  assert-quad: func(q: quad) -> result<_, string>;
  query: func(datalog-src: string) -> result<list<quad>, string>;
  get-objects: func(graph: string, subject: string, predicate: string) -> list<list<u8>>;
}

world kotoba-node {
  import kqe;            // Datom read/write — the ONLY state surface
  import llm;            // host LiteLLM (future summarize/NL-formula cells)
  export run: func(ctx-cbor: list<u8>) -> result<list<u8>, string>;
}
```

`app.py` binds the export and delegates to the compiled graph (watatsumi-gemini pattern):

```python
from kotoba_langgraph import KotobaCheckpointer, handle_invoke
from .cell import DriveTreeCell
import wit_world

_cell = DriveTreeCell()

class WitWorld(wit_world.WitWorld):
    def run(self, ctx_cbor: bytes) -> bytes:
        return handle_invoke(ctx_cbor, _cell.graph)   # CBOR ctx in, CBOR result out
```

Build (verbatim from `orgs/etzhayyim/com-etzhayyim-watatsuna/wasm/build.sh`):

```bash
componentize-py -d wit -w kotoba-node componentize app -o sheets-eval.wasm
npx @bytecodealliance/jco@latest transpile sheets-eval.wasm -o transpiled --name sheetsEval
# then: ipfs add --cid-version=1 sheets-eval.wasm  → record CID in *.meta.json
```

## 3. Tiering — the hard constraint

The four cores differ wildly in how WASM-portable they are, because componentize-py bundles
CPython (~17.6 MB → a **dag-pb multi-block** `bafybei…` CID). The ameno browser loader
(`orgs/etzhayyim/com-etzhayyim-ameno/src/inference/wasm-actor-loader.ts`) **refuses non-raw CIDs** (`isRawCidV1`
check, line ~77) — browser-local T1 is raw single-block ≤500 KB only.

| Path | CID type | Runtime | Verify |
|---|---|---|---|
| **T1 browser-local** | raw `bafkrei…` ≤500 KB | ameno `WebAssembly.instantiate` + `compute()/result_ptr()/memory` ABI | client re-hash == CID |
| **T2 donated mesh** | dag-pb `bafybei…` | e7m-wasm-runner: jco transpile → `run()` | CAR walk, every block re-hashed |

**Consequence**: a componentize-py CPython component is **always T2** (dag-pb). To get a
suite core into the **T1 browser** envelope you cannot ship CPython. Two honest options:

- **Option A — Python core, T2-only (mesh).** Compile each cell with componentize-py → dag-pb
  → runs on e7m mesh via `runBytes()`. Simplest; satisfies "py/WASM" literally. But the
  suite then is **not** browser-local — interactive sheet edits round-trip to a mesh node.
- **Option B — Python authoring, Rust/`logic` core for T1.** Keep the LangGraph cell as the
  orchestration (T2), but the inner pure core (`evaluateGrid` etc.) is also compiled as a
  small **raw-CID WASM** (Rust or AssemblyScript port of `logic.py`/`.ts`) so ameno can run
  the hot interactive path in-browser, ≤500 KB. The Python cell and the raw core share the
  **same conformance vectors**, so they cannot diverge.

Recommendation: **A for docs/calendar/drive** (low interactivity; mesh round-trip fine) and
**B for sheets** (formula recalc must be instant in-browser). This matches the baien
edge-target spirit: the interactive surface stays on-device.

> Note: today's `kotoba` TS already runs in the browser (it's the ameno/Svelte SPA's own
> code). So "browser-local suite" is **already true for the TS path** — the py/WASM migration
> is about making the cores *content-addressed actors* (CID identity, mesh-runnable,
> kotoba-checkpointed), not about first reaching the browser.

## 4. State: kotoba is the only store (no change to the model)

The suite Datom kinds are unchanged from `suite.ts`
(`com.etzhayyim.apps.openKyber.{mail,driveNode,doc,sheet,calendarEvent}`). Migration only
changes **who writes them**:

- **Today**: TS `kotoba` functions write via `@etzhayyim/sdk` → `xrpc-bridge.ts` →
  `com.atproto.repo.createRecord` / `…kg.ingest_batch`.
- **After**: the WASM cell writes via the host **`kqe.assert-quad`** capability; intermediate
  graph state is persisted by **`KotobaCheckpointer`** as CBOR Datoms. The pure cores still
  take "nodes/grid/markdown in, structure out" — only the **wrapper** changes from
  `driveTreeFromStore(e: Etzhayyim)` (reads via SDK) to a cell node that reads via `kqe.query`.

No-server-key (ADR-2605231525) holds: the cell asserts under the **member-signed** ctx passed
in `ctx_cbor`; the host never signs. Confidential bodies stay sealed CIDs (D4/ADR-2605181100)
— the cell sees a CID, never plaintext.

## 5. Migration order & acceptance

Port in increasing difficulty; each port is "done" only when it passes the **same vectors as
the TS test**:

1. **recurrence** — smallest, pure date math; no decimals. Conformance: `recurrence.test.ts`.
2. **docs_md** — string parsing; watch CJK slug regex parity. Conformance: `docs-md.test.ts`.
3. **drive_tree** — tree + dedup + audit; watch BigInt-free size sums. Conformance:
   `drive-tree.test.ts` (this is exact-int, so trivially portable).
4. **sheets_eval** — hardest: exact-decimal arithmetic. **Do not** use Python `float`. Port
   the BigInt fixed-point of `money.ts`/`sheets-eval.ts` to Python `int`/`decimal.Decimal`
   with the same scale, or the parity vectors will fail on rounding. Conformance:
   `sheets.test.ts`. Candidate for the Option-B raw-core.

**Per-cell acceptance checklist**
- [ ] `logic.py` passes a `test_conformance.py` that loads the TS test's input/expected
      vectors (extract them to a shared `fixtures/*.json` so both languages read one source).
- [ ] `build.sh` produces a `.wasm`; CID recorded in `*.meta.json` (raw vs dag-pb noted).
- [ ] e7m-wasm-runner `runBytes()` returns the same JSON as the TS core (T2 smoke).
- [ ] (sheets, Option B) ameno loads the raw-CID core in headless Chromium and recalcs a grid.
- [ ] cell registered as an actor DID (`did:web:etzhayyim.com:actor:<suite>-<core>`) with the
      CID in its did.json `EtzhayyimWasmComponent` service (ADR-2606014600).

## 6. What does NOT migrate

- **The Datom schema** (`erp-ontology.kotoba.edn`) — unchanged.
- **The accounting/ERP modules** (`accounting.ts`, `posting.ts`, … ~25 files) — these are
  XRPC-command logic for the ERP Worker (R2-WORKER-WIRING.md), not edge cells; they stay TS
  behind the worker until/unless a separate ADR moves the ERP itself to WASM cells.
- **The TS cores themselves** — retained as the conformance oracle and as the browser path
  until each Python/raw port is proven at parity. Delete only after parity + a deprecation
  note in the ADR.

## 7. Honest limits

- componentize-py CPython is heavy → docs/calendar/drive are **T2 mesh**, not browser, under
  Option A. True browser-local for those needs the Option-B raw-core too (more work).
- The `kotoba_langgraph` shim (`KotobaCheckpointer`/`handle_invoke`) is exercised in the
  migration bakeoff but is not yet a published, versioned dependency of this app — pin it
  before relying on it.
- No live deploy here: this is the design + build recipe. Actual CID publication, did.json
  service wiring, and mesh enrolment remain operator + Council gated (ADR-2606012100).
