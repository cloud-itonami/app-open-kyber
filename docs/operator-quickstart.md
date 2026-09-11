# operator-quickstart

**この repo で今日実際にできることを、踏める形で上から書く。** 所要 5 分。
Cloudflare のアカウントは要らない（deploy だけが要る。§5）。

出力はすべて実際に walk した結果である（2026-08-19）。

## 0. 前提

| 要るもの | 確認 | この walk で使った版 |
|---|---|---|
| git | `git --version` | 2.51.0 |
| nbb | `npx --yes nbb --version` | v1.4.208 |
| clojure | `clojure --version` | ビルド時のみ |

## 1. 取得して、書いてあることが本当か検査する

```bash
git clone git@github.com:cloud-itonami/app-open-kyber.git
cd app-open-kyber
REPO=$PWD
npx --yes nbb scripts/verify-docs-claims.cljk .
```

末尾が `OK` なら README の数値・存在・不在は tree と一致している。
**exit 2（UNDETERMINED）は 0 ではない** —— tree を読み切れなかったという別の
答えで、「検査して問題なし」と混ぜない。先頭に `SCANNED<TAB>n` が出る（n=0 は
clean ではなく UNDETERMINED になる）。

実際の出力（末尾）:

```
SCANNED	92
PASS	tracked-files	expected=92	actual=92
...
PASS	adr-is-readable-edn	expected=true	actual=true
OK	every claim in README.md and docs/operator-quickstart.md holds
```

この検査には移行の不変条件が入っている: appview に TypeScript が戻っていない
こと（撤去した 18 パスの不在 + appview 配下の `.ts` 総数）、**`kotoba/` が
消えても増えてもいないこと**（62 ファイル / 59 `.ts`）、`wrangler.jsonc` の
`main` が shadow の出力先を指していること、`:warnings-as-errors` が
`:compiler-options` の下に在ること（**grep ではなく EDN を読んで**判定する ——
grep 版はそれを説明するコメントに当たるので落ちようがない）、ページが route 表
から描かれていること、ADR が EDN として読めること。

## 2. テストを走らせる（ビルド不要・ブラウザ不要）

判断（`route.cljc`）と描画（`view.cljc`）は純 `.cljc` なので、nbb だけで回る。

```bash
K=~/github/com-junkawasaki/orgs/kotoba-lang
CP="src:test:$K/jp-go-digital-design-system/src:$K/html/src:$K/css/src"
cat > /tmp/run.cljs <<'EOF'
(require '[cljs.test :refer [run-tests]] 'openkyber.route-test)
(run-tests 'openkyber.route-test)
EOF
npx --yes nbb --classpath "$CP" /tmp/run.cljs
```

実際の出力:

```
Testing openkyber.route-test

Ran 6 tests containing 28 assertions.
0 failures, 0 errors.
```

何を固定しているか: `/xrpc/` は**空の nsid だけ** 400 にする（`/xrpc/a/b` は
移行前の rest parameter と同じく転送する。1 セグメントに絞るのは移行ではなく
方針変更）、MCP router の URL 解決（空白だけの設定は未設定として扱う）、
`result` / `structuredContent` の剥がし方、そして**ページが route 表から
描かれること**（固定値を焼いていたら落ちる）。

## 3. ページを描画して採点する

```bash
K=~/github/com-junkawasaki/orgs/kotoba-lang
CP="src:$K/jp-go-digital-design-system/src:$K/html/src:$K/css/src"
cat > /tmp/render.cljs <<'EOF'
(require '["node:fs" :as fs] '[openkyber.view :as view] '[openkyber.route :as route])
(let [css (.readFileSync fs (str (.-DDS js/process.env) "/resources/jp_go_dds/dds.css") "utf8")]
  (.writeFileSync fs "/tmp/ok-page.html"
    (view/render {:css css :routes route/routes
                  :vars [:APP_NANOID :APP_UI_TYPE]
                  :mcp-url "https://mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message"}))
  (println "ok"))
EOF
DDS="$K/jp-go-digital-design-system" npx --yes nbb --classpath "$CP" /tmp/render.cljs

cd $K/design-quality && npx --yes nbb -m design-quality.cli score /tmp/ok-page.html --min 95
```

実際の出力（末尾）:

```
  100.00  /tmp/ok-page.html
aggregate: 100.00

axes scored: 10 (viewport, safe-area, dynamic-viewport, tap-targets, focus-visible,
                 reduced-motion, overflow-guard, color-scheme, responsive, semantics)
NOT scored: input-zoom, contrast — pass --extra-axes to include the optional ones
A pass says nothing about an axis that was not applied.
gate: aggregate 100.00 >= min 95.00 -> PASS
```

`--extra-axes` を付けた 12 軸でも **100.00 / PASS**。

**この数字が何を言っていないか。** design-quality はデザインシステムを完全に
外しても 96.63 で `--min 95` を PASS する（先行 repo の実測）。「DADS が実際に
入っている」ことを言えるのは §4.5 の smoke の 2 本目だけである。

## 4. bundle をビルドする

**高負荷ビルドは同時 1 本に制限されている**（superproject `CLAUDE.md` の
resource governor）。直接叩かず、必ず guard 経由で:

```bash
cd "$REPO"
node ~/github/com-junkawasaki/scripts/resource-guard.mjs run build -- \
  npx shadow-cljs release worker
ls -la dist/worker.js
```

lock を他セッションが持っていると exit 2 で拒否される。**迂回しない** ——
順番待ちであってエラーではない。

実際の出力（末尾）:

```
[:worker] Build completed. (55 files, 12 compiled, 0 warnings, 7.99s)
```

`dist/worker.js` = 246,518 バイト、
sha256 `284e16f2ae545831697a5727c2dc8903cfc2860094ee0190ebb6724e60f11a7b`。

**この sha は cold cache（`rm -rf .shadow-cljs`）からのみ再現する。**
shadow の `:esm` 出力は、同じソースでも増分ビルドだと違うバイトを（安定して）
出す。バックアップから戻した後に汚染を確かめるときは、必ず先に cache を消す。

### 壊れた var はビルドを **落とす**（2026-08-19 実測）

`shadow-cljs.edn` の `:compiler-options` に `:warnings-as-errors true` を入れた。
入れる前は、存在しない var を参照しても shadow は **WARNING** を出して **exit 0**
し、壊れた bundle を書いていた ——「ビルドが通った」は検査ではなかった
（**落ちようがなかった**）。

この repo で実際に落として確かめた。`src/openkyber/worker.cljk:130` の
`route/dispatch` を、存在しない `route/dispatch-nonexistent` に改名して再ビルド:

```
------ ERROR -------------------------------------------------------------------
 File: /private/tmp/app-open-kyber-cljs/src/openkyber/worker.cljk:130:44
```

| | exit | `dist/worker.js` sha256 | bytes |
|---|---|---|---|
| 改名前 | **0** | `284e16f2…4e60f11a7b` | 246518 |
| 改名後 | **1** | `284e16f2…4e60f11a7b`（**不変**） | 246518 |
| 戻して cold 再ビルド | **0** | `284e16f2…4e60f11a7b` | 246518 |

**落ちたビルドは bundle を出荷しない** —— sha256 が 1 バイトも動いていないことが
それを言っている。

キーは `:build-options` ではなく **`:compiler-options`** に置く。shadow が読むのは
`[:compiler-options :warnings-as-errors]` で、置き場所を間違えると**黙って無視される**
—— この option が防ぐはずの失敗（落ちようのない検査）そのものになる。検証器は
これを **EDN として読んで**確かめる（grep はコメントに当たるので落ちない）。

## 4.5 ビルドした成果物を実際に叩く

ここが deploy されるものに触る唯一の検査である。

```bash
cd "$REPO" && npx --yes nbb scripts/smoke-worker.cljk dist/worker.js
```

```
PASS	default export has fetch	expected=true	actual=true
PASS	GET / status	expected=200	actual=200
...
PASS	wrong method	expected=405	actual=405
OK	the built bundle answers as the route table says
```

21 項目、exit 0。**bundle が無ければ exit 2**（「判定できなかった」であって
合格ではない）。

中継先を `.invalid`（RFC 2606 で必ず解決しない TLD）にしてあるので、
`/xrpc/<単段>` と `/xrpc/a/b` が**同じ結末**（到達不能 → 502 + 試した URL）に
なることを、実 DNS に依存せず検査できている。

## 4.6 Workers ランタイム（workerd）で動かす

Node で import する smoke より強い検査。実際の workerd で起こす。

```bash
cd "$REPO/etzhayyim-wasm-kyber-erp-kyb3rerp"
npx --yes wrangler@latest dev --local --port 8831 --ip 127.0.0.1
# 別シェルで
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1:8831/
curl -s http://127.0.0.1:8831/health
```

実際の出力:

```
200 text/html; charset=utf-8
{"ok":true,"app":"open-kyber","runtime":"cljs","routes":["/","/health","/xrpc/:nsid"]}
```

`POST /xrpc/` → 400、`OPTIONS /xrpc/x` → 204、`GET /nope` → 404、
`POST /health` → 405、`GET /` の HTML に `--color-primitive-blue` が 45 箇所。

`compatibility_flags`（`nodejs_compat` / `nodejs_als`）は SvelteKit の
adapter-cloudflare 由来で、この bundle には要らない。**撤去は憶測ではなく
この実測で確かめてから行った。**

## 5. deploy

```bash
cd "$REPO/etzhayyim-wasm-kyber-erp-kyb3rerp"
npx wrangler deploy
```

**この walk では deploy していない。**

**そして route が指すホストは解決しない**（`kyb3rerp.etzhayyim.com` /
`kyber.etzhayyim.com` とも NXDOMAIN）。deploy が成功しても誰も到達できない。
`/xrpc/` の中継先 `mcp.etzhayyim.com` も同様なので、到達できたとしても中継は
**502 を返す**（成功と同じ形で隠さない）。

superproject の deploy guard は `origin/main` を含む checkout からの deploy しか
許さない点も併せて注意。

## 6. 検査が落ちることを確かめる（mutation）

**緑を見ただけでは検査になっていない。** 各 gate を実際に赤にしてから受け入れた。
mutation は **1 つずつ**当てる —— 2 つ同時だと互いを隠すことがある。復元後は毎回
`rm -rf .shadow-cljs` して cold から再ビルドし、sha256 が一致することを確認した。

| # | 壊したもの | 赤くなった検査 | 緑のまま残ったもの（重要） |
|---|---|---|---|
| 1 | `route/dispatch` を存在しない var に改名 | **ビルドが exit 1** | bundle の sha256 は不変 |
| 2 | `(rc/inline "jp_go_dds/dds.css")` → `""` | smoke `page carries the stylesheet itself` | smoke `page uses the design system components` は**緑のまま** |
| 3 | ページが env の値を出す | smoke `page hides other var values` | `page shows a var key` / `page shows the relay target` |
| 4 | 中継先の表示を消す | smoke `page shows the relay target it uses` | `page hides other var values` / `the 502 names the URL` |
| 5 | route 表を固定値で描く | unit test 2 件 + 検証器 `page-renders-route-table` | — |
| 6 | 撤去したパスに `.ts` を戻す | 検証器 `removed-by-migration-absent` + `appview-ts-files` | — |
| 7 | 別名の `.ts` を appview に入れる | 検証器 `appview-ts-files` **のみ** | `removed-by-migration-absent` は緑 —— 別の主張であることの実演 |
| 8 | `kotoba/` からファイルを 1 本消す（`src/fx.ts`） | 検証器 `kotoba-library-files` + `kotoba-library-ts-files` | 柵が**両方向**に効いている |
| 9 | `:warnings-as-errors` を `:build-options` へ移す | 検証器 `warnings-as-errors-in-compiler-options` + `no-build-options-key` | **ビルドは exit 0 に戻った**（下記） |

**#9 で置き場所の話が実測になった。** キーを `:build-options` へ移した状態で
#1 と**同じ**壊し方（`route/dispatch` → 存在しない var）を当てると、ビルドは
**exit 0 で通り、warning を 7 行出して bundle を書いた**。`:compiler-options` に
在るときは exit 1 で止まる。つまり置き場所を間違えると、この option が防ぐはずの
失敗（落ちようのない検査）そのものになる —— 憶測ではなく、この repo で両方を
走らせた差である。検証器がこれを **EDN として読んで**判定するのはそのためで、
grep 版はこの節のコメント自身に当たって落ちない。

**#2 がこの表で一番重要である。** 「`dads-table` が在る」を 1 本で見る形は
**落ちない検査**だった —— それは view が出力する markup で、CSS が 1 バイトも
入っていない bundle にも現れる（実測: mutation 後の bundle でも `dads-table` は
5 箇所、`--color-primitive-blue` は **0**）。だから 2 本に割ってある。

## 7. ここに無いもの

- **ERP のコマンド。** `/xrpc/:nsid` は中継だけで、この Worker は
  `com.etzhayyim.apps.kyber.*` を 1 つも実装していない。実装は `kotoba/` にあり、
  そちらは kotoba Datom log に対して動いてこの Worker を経由しない。
- **`kotoba/` のテスト実行。** pnpm 10 が git-hosted な `@etzhayyim/sdk` の build
  script を `onlyBuiltDependencies` allowlist 無しでは実行しないため
  （`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`）、この walk では走らせていない。
  移行対象外の component なので回避策も入れていない。
- **projector appview**（`…-kyb3proj`）。`CLAUDE.md` の元の Folder Layout に
  在ったが、この repository には抽出されていない。
- **deploy**（§5）。
