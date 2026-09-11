# open-kyber — Open Source ERP (APQC-aligned, kotoba-Datomic)

Apache-2.0 ERP whose canonical state is the **kotoba Datom log** (content-addressed EAVT,
Datomic-isomorphic) — no RisingWave / Postgres / Kysely. Built on AT Protocol + APQC PCF +
BPMN 2.0, with exact-decimal accounting and non-終末論 (corrections are new asserted facts,
never edits). Aligned to ISIC Rev.4 so every industry gets a tailored chart of accounts.

Extracted from `etzhayyim/root`'s `60-apps/etzhayyim-project-open-kyber`. **The appview
migrated from TypeScript/Svelte to ClojureScript on 2026-08-19** (`docs/adr/0001`).
Every number below is re-derived from the tree by `scripts/verify-docs-claims.cljk`.

## Two things live here, and only one of them was migrated

| | What it is | Language | Migrated? |
|---|---|---|---|
| **the appview** | the Cloudflare Worker at `kyb3rerp.etzhayyim.com` — a page and an XRPC relay | **ClojureScript** | **yes** |
| **the ERP library** (`kotoba/`) | the double-entry GL, AP/AR, inventory, assets, tax, close, audit, ISIC packs | TypeScript | **no — deliberately** |

**They are not connected.** The Worker implements no ERP command: `/xrpc/:nsid` forwards
whatever nsid it is given to the MCP router. `kotoba/` reads and writes the kotoba Datom
log and does not go through this Worker. The file that used to join them
(`etzhayyim-wasm-kyber-erp-kyb3rerp/src/app.ts`, 896 lines) was in no bundle and could not
be built here — see below.

Migrating `kotoba/` is a separate decision that needs a ClojureScript face for
`@etzhayyim/sdk`. It is **not** dead code, and the measurements say so:

- its dependencies **are real and fetchable** — `@etzhayyim/sdk` and `@etzhayyim/sdk-mock`
  are git URLs pinned to commits that exist (checked with `git fetch <url> <sha>` →
  `type=commit`, **not** with the GitHub API, which returns intermittent 404s for commits
  that do exist), and `pnpm install` fetches the first one and reads it as
  `@etzhayyim/sdk@0.1.0-alpha`
- it has its own `package.json`, `tsconfig.json`, `vitest.config.ts`, and **24 test files**
- it is referenced by nothing the migration replaced

**Its test suite was NOT run in this migration, and the numbers in its README are not
verified here.** `pnpm install` under pnpm 10 stops before finishing:
`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED — the git-hosted package "@etzhayyim/sdk@0.1.0-alpha"
needs to execute build scripts but is not in the "onlyBuiltDependencies" allowlist`, which
wants a `pnpm-workspace.yaml` this repository does not have. Adding one would be a change
to the component this migration deliberately did not touch, so it was not made. What is
pinned in the verifier is the **file count**, which is a fact about the tree and needs no
install.

Its file count is pinned in the verifier (`kotoba-library-files 62`), so it cannot grow
silently and it cannot be quietly deleted either.

## deploy されるものは、いま読んでいるソースである

```
src/openkyber/route.cljk    判断（どの handler が答えるか）  ← 純 .cljc、テスト対象
src/openkyber/view.cljk     ページ（jp-go-dds の hiccup）    ← 純 .cljc、テスト対象
src/openkyber/worker.cljk   Request/Response に触る唯一の層
        ↓ shadow-cljs :target :esm
dist/worker.js              ← wrangler.jsonc の "main" が指すもの
```

Before the migration `main` pointed at `svelte/.svelte-kit/cloudflare/_worker.js`, a
SvelteKit build output that is **not in the tree** — and, unlike the usual version of this
defect, **could not be produced from the tree either**: `svelte/package.json` declares
`@etzhayyim/design-system` and `@etzhayyim/kyber-calendar-frontend` as `workspace:*`, and
this repository has no workspace (measured: `npm install` → `EUNSUPPORTEDPROTOCOL
Unsupported URL Type "workspace:"`).

`scripts/verify-docs-claims.cljk` checks that shadow's output dir, wrangler's `main`, and
the exported namespace still agree, and fails when they stop agreeing.

## 公開ルート

| METHOD | PATH | 何をするか |
|---|---|---|
| GET | `/` | この appview の説明ページ |
| GET | `/health` | 生存確認。deploy された面が答えることを外から確かめられる |
| POST | `/xrpc/:nsid` | XRPC を MCP router へ中継する |
| OPTIONS | `/xrpc/*` | CORS preflight |

**この表の出所は `openkyber.route/routes` で、ページもそこから描く。** 移行前の
`svelte/src/routes/+page.svelte` は `routeCount: 0` / `routes: []` / `vars: []` を literal で
持っており、隣の `wrangler.jsonc` が route 2 本・var 11 個を宣言していることに気づけ
なかった。いまは route 表を渡す側が持ち、ページは描くだけなので、両者がずれる余地が無い。

`/health` は移行前の SvelteKit app に**無かった** — これは移植ではなく**追加**である
（migrated sibling repos と揃えた）。それ以外の 3 本は移行前の挙動そのままである。

## 移行前の面との差分（黙って変えていない）

| | 移行前（SvelteKit） | 移行後（cljs） | なぜ |
|---|---|---|---|
| `/xrpc/a/b` | 転送する（rest parameter `[...path]`） | **同じ** | 1 セグメントに絞るのは移行ではなく方針変更 |
| 呼び手のヘッダ | `host` だけ落として上流へ引き継ぐ | **同じ** | 落とすと `authorization` が届かなくなる |
| `x-etzhayyim-bff` | `sveltekit-edge-bff` | `cljs-worker` | このヘッダは BFF の実装を名乗る。SvelteKit でなくなった後も名乗り続けるのは嘘 |
| 中継先が到達不能 | fetch を try で囲っておらず SvelteKit の未処理例外 → 500 | **502 + 試した URL** | 成功と同じ形に潰さない |
| `/health` | 無い | 200 JSON | 追加（上記） |

## いま在るもの

| 面 | ファイル |
|---|---|
| 判断・描画・edge | `src/openkyber/{route.cljc, view.cljc, worker.cljs}` |
| テスト | `test/openkyber/route_test.cljk`（6 tests / 28 assertions） |
| ビルド | `deps.edn` / `shadow-cljs.edn` |
| Worker 設定 | `etzhayyim-wasm-kyber-erp-kyb3rerp/wrangler.jsonc` |
| actor 記述子 | `etzhayyim-wasm-kyber-erp-kyb3rerp/{kotodama.jsonld, etzhayyim.json}` |
| ERP ライブラリ | `kotoba/`（TypeScript、**移行対象外**。上記） |
| ISIC packs | `industry-packs/isic-packs.kotoba.edn` |
| WASM actor | `wasm/kyber-erp-core/`（Rust、kotoba host 経路。Worker とは無関係） |
| 設計 | `CLAUDE.md` / `R2-WORKER-WIRING.md` / `SUITE-PY-WASM-MIGRATION.md` / `WORKER-AS-WASM-ACTOR-MIGRATION.md` |
| 文書 | `README.md` / `docs/operator-quickstart.md` / `docs/adr/*.edn` |

**appview の TypeScript は 0 本、正本言語（`.cljs`/`.cljc`）が 4 本。** 移行前は appview に
TypeScript が 11 本（`src/app.ts` 1 + `svelte/` 7 + `e2e/` 3）と `.svelte` が 8 本あった。
`kotoba/` の 59 本は別勘定で、いまも在る。この数はすべて検証器の claim である。

## 撤去したもの（45 ファイル）と、その測定

| パス | 何 | なぜ撤去できたか（測定） |
|---|---|---|
| `…/svelte/` (21) | SvelteKit app + 7-app SPA | 下記 2 点 |
| `…/src/app.ts` (1) | 896 行の「ERP Worker」 | `wrangler.jsonc` の `main` が指していない。依存 `@etzhayyim/kotodama-host-sdk` / `@etzhayyim/open-kyber-kotoba` が `workspace:*` で解決しない |
| `…/package.json`, `…/package-lock.json` (2) | 上の宣言 | `main: src/app.ts` を宣言するだけ。`scripts` が無いので `pnpm build` も走らない |
| `…/e2e/` (15) | Playwright smoke + visual + 11 PNG | SPA を検査していた（`Kyber Command Center`、7 apps）。その SPA はどの bundle にも入らない。宛先 `kyber.etzhayyim.com` は NXDOMAIN |
| `…/Dockerfile`, `…/.dockerignore` (2) | node コンテナ packaging | 撤去する `package.json` を `COPY` し、存在しない `pnpm build` を実行し、誰も作らない `dist/index.js` を起動する。`.svelte-kit` を ignore する SvelteKit 時代の生成物 |
| `…/wrangler.jsonc` の `assets` | SvelteKit client の配信 | 指す先 `./svelte/.svelte-kit/cloudflare/client` が撤去された |
| `…/wrangler.jsonc` の `compatibility_flags` | `nodejs_compat` / `nodejs_als` | adapter-cloudflare 由来。**憶測で消さず** workerd (`wrangler dev --local`) で全 route を叩いて確かめてから撤去した |

### svelte/ の中には app が 2 つあり、どちらも deploy されていなかった

これは brief が予告していなかった形なので、測って書く。

1. **SvelteKit**（`src/routes/+page.svelte` + `src/routes/xrpc/[...path]/+server.ts` +
   `src/app.html` + `svelte.config.js`）—— `wrangler.jsonc` の `main` が指していたのは
   これのビルド出力。**deploy 対象ではあったが、この repo からはビルドできない**
   （`workspace:*`）。移植したのはこの面の挙動である。
2. **7-app の Vite SPA**（`index.html` → `src/main.ts` → `App.svelte` →
   `src/apps/{Appview,Drive,Mailer,Organizer,Overview,Projector}.svelte` + `src/lib/`）
   —— `CLAUDE.md` が "Hono + Svelte read/write SPA" と呼んでいたもの。**どの bundle にも
   入っていない**: `vite.config.ts` は `sveltekit()` プラグインを読み込んでおり、
   SvelteKit は entry を `src/app.html` + `src/routes/` から取ってルートの `index.html` を
   読まない。そして `src/routes/` 配下から `App.svelte` への import は **0 件**である。

`e2e/` が検査していたのは 2 の方（`Kyber Command Center`、7 つの app タブ）であって、
deploy されていた 1 の方ではない —— 1 のページは `Kyber Erp Kyb3rerp` と `Routes 0` を
表示する。**検査していた対象と deploy されていた対象が別だった。**

## ページが出す値・出さない値

env の**キー名**は出すが、値は出さない —— **中継先を除いて**。
`AGENTGATEWAY_MCP_ROUTER_URL` の値だけは、どこへ中継するかを運用者が見る必要があるので
意図的に表示する。

smoke はこれを**2 つの独立した印**で見る: 表示されない var に置いた sentinel が出て
いないこと、そして中継先の値が出ていること。片方だけだと「全部隠す」実装も「全部出す」
実装も通ってしまう。

## UI

基盤は `kotoba-lang/jp-go-digital-design-system`（デジタル庁デザインシステム）。
色・寸法は `--hig-*` トークン契約だけで書き、raw hex も px フォントサイズも置かない。
app 固有 CSS は 3 行。CSS は外部リクエストゼロの方針どおり `shadow.resource/inline` で
bundle に焼く。

決定論的 audit（`kotoba-lang/design-quality`）で **100.00 / 100（gate 95）**、
`--extra-axes` を付けた 12 軸でも 100.00。

### デザインシステムの検査は 2 本ある

`dads-table` が在ることを 1 本で見る形は**落ちない検査**だった —— それは view が出力する
markup であって、CSS が 1 バイトも入っていないページにも現れる。実測（このページ、
2026-08-19、`(rc/inline "jp_go_dds/dds.css")` を `""` に置き換えて再ビルド）:

| 探す文字列 | CSS 込み | CSS 無し |
|---|---|---|
| `class="dads-table"` | 1 | **1**（0 にならない） |
| `--color-primitive-blue` | 45 | **0** |

だから 2 本に割った。**component を使ったか**（`class="dads-table"`）と、
**stylesheet が実際に入ったか**（`--color-primitive-blue`）は別の主張である。

design-quality のスコアはこの区別をしない（測定済み: デザインシステムを完全に外しても
96.63 で `--min 95` を PASS する）。「在る」と言えるのはこの smoke の 2 本目だけ。
CLI は自分が 12 軸中 10 軸しか当てていないことを出力に書くので、その行を読むこと。

## 呼び先が 1 つも解決しない（移行では直らない）

| ホスト | 役割 | DNS（`dig +short`、2026-08-19） |
|---|---|---|
| `kyb3rerp.etzhayyim.com` | 公開ホスト（wrangler の route） | **NXDOMAIN** |
| `kyber.etzhayyim.com` | 同 | **NXDOMAIN** |
| `mcp.etzhayyim.com` | `/xrpc/:nsid` の中継先 | **NXDOMAIN** |
| `murakumo.etzhayyim.com` | `MURAKUMO_URL`（この Worker は呼ばない） | **NXDOMAIN** |

deploy 先も中継先も、いま存在しない。`/xrpc/` は到達できなければ **502 を返す**
——成功と同じ形で隠さない。`etzhayyim.com` の apex だけは解決する。

## 残っている欠陥（移行では直っていない）

1. **Worker と ERP ライブラリが繋がっていない。** `kotoba/` の 34 モジュールを公開する
   XRPC コマンドは 1 つも実装されていない。移行前も同じで、繋ぐはずだった `src/app.ts`
   はビルドできなかった。繋ぐには `@etzhayyim/sdk` の cljs 面が要る。
2. **上流の README の数値が古い。** `kotoba/README.md` は "19 files, 88 tests"、
   ルート README は移行前 "23 files, 100 tests" と書いていたが、実測の test ファイル数は
   **24** である。ファイル数は検証器に固定した。テスト**本数**はこの移行では検証していない。
3. **`kotoba/` の documented quickstart が pnpm 10 で走らない。** `kotoba/README.md` は
   `pnpm install && pnpm test` と書いているが、pnpm 10 は git-hosted な `@etzhayyim/sdk` の
   build script を `onlyBuiltDependencies` allowlist 無しでは実行しない
   （`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`）。この repo に `pnpm-workspace.yaml` は無い。
   **移行対象外の component なので直していない**（測って記録するだけにした）。
4. **ホストは相変わらず NXDOMAIN。** 移行はそれを直さない。deploy するか retire するかは
   別の決定。

## 検証

```bash
kbb --backend sci scripts/verify-docs-claims.cljk .          # <dir> は先頭に置く
```

exit 0 = 全一致 / 1 = 食い違い / **2 = 判定できなかった**（0 と区別する）。
テストとビルドは `docs/operator-quickstart.md`。

## License

Apache-2.0 + etzhayyim Charter Compliance Rider. Instances publish records as `isBot: true`
per the AT Protocol AI-Agent profile convention.
