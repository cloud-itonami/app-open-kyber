(ns openkyber.route
  "どのハンドラが要求に答えるか —— データとして持ち、純関数で決める。

  `.cljs` ではなく `.cljc` なのは意図的である。edge worker の中で検査する価値が
  あるのは経路判断で、ここならブラウザもビルドもネットワークも要らずに検査できる。
  Request/Response に触るのは `openkyber.worker` だけで、そこはこのファイルが
  既に決めたことを実行するだけである。

  ingress capability が qualify した時（今日は `:native-aot`/`:wasm-aot` とも
  pending —— ADR-2606290000）に最初に `.kotoba` へ移るのもここである。route 表は
  スカラと文字列に対する判断であり、それはその移行を生き延びる形そのものである。"
  (:require [kotoba.lang.text :as str]))

(def routes
  "公開面をデータとして持つ。ランディングページは**これ**を描くので、
  実在する route とページが宣伝する route がずれる余地が無い。

  移行前の `svelte/src/routes/+page.svelte` は `routeCount: 0` と `routes: []`
  を literal で焼いており、隣の wrangler.jsonc が route 2 本・var 11 個を
  宣言していることに気づけなかった（docs/adr/0001）。"
  [{:route/path "/"           :route/method :get  :route/kind :page
    :route/doc "この appview の説明ページ"}
   {:route/path "/health"     :route/method :get  :route/kind :json
    :route/doc "生存確認。deploy された面が答えることを外から確かめられる"}
   {:route/path "/xrpc/:nsid" :route/method :post :route/kind :proxy
    :route/doc "XRPC を MCP router へ中継する"}])

(defn- xrpc-nsid
  "`/xrpc/<nsid>` の nsid。**空文字だけが nil**。

  多段パス（`/xrpc/a/b`）も通す。移行前の SvelteKit route は rest parameter
  `[...path]` で受けており（`svelte/src/routes/xrpc/[...path]/+server.ts`)、
  `event.params.path` が `a/b` をそのまま返すのでそれを tool 名として転送して
  いた。空文字だけが `Missing XRPC method` の 400 だった。

  ここで 1 セグメントに絞ると挙動が変わる —— NSID に `/` は現れないので上流で
  失敗するだけだが、**それは移行ではなく方針変更**であり、移行の commit に紛れ
  込ませるべきものではない。絞るなら別の決定として記録する。"
  [path]
  (when (str/starts-with? path "/xrpc/")
    (let [rest' (subs path (count "/xrpc/"))]
      (when (seq rest') rest'))))

(defn dispatch
  "method + path → 何をするか。Request も Response も知らない。

  返すのは `{:action …}` で、`:action` は
  `:page` / `:health` / `:xrpc` / `:cors-preflight` / `:not-found` /
  `:method-not-allowed` / `:bad-request` のいずれか。"
  [method path]
  (let [m (keyword (str/lower (or method "get")))
        p (or path "")]
    (cond
      (and (= m :options) (str/starts-with? p "/xrpc/"))
      {:action :cors-preflight}

      (str/starts-with? p "/xrpc/")
      (if (= m :post)
        (if-let [nsid (xrpc-nsid p)]
          {:action :xrpc :nsid nsid}
          {:action :bad-request :reason "Missing XRPC method"})
        {:action :method-not-allowed :allow "POST, OPTIONS"})

      (= p "/health") (if (= m :get)
                        {:action :health}
                        {:action :method-not-allowed :allow "GET"})
      (= p "/")       (if (= m :get)
                        {:action :page}
                        {:action :method-not-allowed :allow "GET"})
      :else {:action :not-found})))

(defn mcp-router-url
  "env の設定 → MCP router の URL。末尾スラッシュは落とす。

  解決順は移行前の `+server.ts` の `mcpRouterUrl()` と同じ:
  `AGENTGATEWAY_MCP_ROUTER_URL` → `MCP_ROUTER_URL` → 既定値。空白だけの設定は
  未設定として扱う（TS 側も `.trim()` で同じ判定をしていた）。

  既定値をここに焼くのは、**どこへ行くのかを 1 箇所で読めるようにする**ためで
  ある。呼び出し側はこの戻り値をそのまま使い、ページにも表示する。"
  [{:keys [AGENTGATEWAY_MCP_ROUTER_URL MCP_ROUTER_URL]}]
  (let [pick (fn [s] (when (and (string? s) (seq (str/trim s))) (str/trim s)))]
    (-> (or (pick AGENTGATEWAY_MCP_ROUTER_URL)
            (pick MCP_ROUTER_URL)
            "https://mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message")
        (str/replace #"/+$" ""))))

(def ^:private drop-headers
  "上流へ渡さない header。

  `host` —— 移行前の SvelteKit route も削っていた（宛先が変わるので嘘になる）。
  移行はここまでは正しく写していた。

  `content-length` / `content-encoding` —— **これが抜けていた。** body は
  JSON-RPC の封筒に詰め直されるので、呼び手が付けた長さもエンコーディングも
  もう本文を説明していない。それを載せたまま上流へ投げると fetch 自体が失敗し、
  Worker は 502 `MCP router unreachable` を返す —— router には 1 度も届かない。
  実測 2026-08-19、ビルド済み bundle に `content-length` 付きの POST を通して
  確認した（付けなければ同じ bundle が 200 を返す）。POST に `content-length`
  を付けないクライアントは実際にはほぼ無いので、これは稀な経路ではない。

  **それ以外は全部渡す。** `authorization` はこの repo では最初から届いていた。"
  #{"host" "content-length" "content-encoding"})

(defn relay-headers
  "受け取った header を、上流へ渡す形にする。`in` は [[k v] …] の列。

  ここが `.cljc` にあるのは、これがビルドもブラウザも無しに固定できる**判断**
  だからである。`js/Headers` を worker 側で組み立てていたので、何が渡って何が
  落ちるかを述べたテストが書けず、上の欠陥は誰にも気づかれなかった。

  `x-etzhayyim-bff` の値だけは移行で変えてある（SvelteKit 版は
  `sveltekit-edge-bff` を名乗っていた）。名乗りは事実なので、SvelteKit で
  なくなった後もそう名乗り続けるのは嘘になる（APP_FRAMEWORK も同時に変えた）。
  この註は worker 側の組み立てに付いていたもので、値と一緒にここへ移した。"
  [in nsid]
  (into {"content-type" "application/json"
         "x-etzhayyim-bff" "cljs-worker"
         "x-etzhayyim-xrpc-method" nsid}
        (comp (remove (fn [[k _]] (contains? drop-headers (str/lower k))))
              (map (fn [[k v]] [(str/lower k) v])))
        in))

(defn unwrap-mcp
  "MCP router の応答から、呼び手に返す値を取り出す。

  移行前の `+server.ts` と同じ剥がし方:
  `{:result {:structuredContent X}}` → X、`{:result X}` → X、それ以外は素通し。
  `{:error …}` は呼び出し側が 502 にするので、ここでは判定だけ返す。"
  [payload]
  (cond
    (and (map? payload) (contains? payload :error))
    {:ok? false :error (get-in payload [:error :message] "MCP router returned an error")
     :upstream payload}

    (and (map? payload) (contains? payload :result))
    (let [r (:result payload)]
      {:ok? true :value (if (and (map? r) (contains? r :structuredContent))
                          (:structuredContent r)
                          r)})

    :else {:ok? true :value payload}))
