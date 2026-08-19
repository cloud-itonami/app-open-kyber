(ns openkyber.worker
  "Cloudflare Worker の入口。**この repo で唯一 Request/Response に触る層。**

  ここには判断を置かない —— どのハンドラが答えるかは `openkyber.route/dispatch`
  が決め、ページの中身は `openkyber.view` が組む。どちらも `.cljc` なので、
  ブラウザもビルドも無しにテストできる。

  wrangler.jsonc の `main` は `../dist/worker.js` を指し、それはこの名前空間を
  コンパイルしたものである。移行前は `svelte/.svelte-kit/cloudflare/_worker.js`
  （SvelteKit のビルド出力）を指していて、そのビルド出力は tree に無く、
  svelte/package.json の依存が `workspace:*` でこの repo からは解決しないので
  **生成することもできなかった**（docs/adr/0001）。

  `aget` を使うのは `:advanced-optimization` 下で env のキーが潰れないため
  （先例 `listingops.edge.worker` と同じ約束）。"
  (:require [openkyber.route :as route]
            [openkyber.view :as view]
            [shadow.resource :as rc]
            [clojure.string :as str]))

(def ^:private dds-css
  "DADS の CSS はビルド時に bundle へ焼く。外部リクエストゼロが design system
  の方針で、Worker から resource を読む経路も無い。"
  (rc/inline "jp_go_dds/dds.css"))

(defn- ->response [body {:keys [status content-type cache extra]}]
  (js/Response.
   body
   #js {:status status
        :headers (clj->js (merge {"content-type" content-type
                                  "cache-control" (or cache "no-store")}
                                 extra))}))

(defn- json [body status]
  (->response (js/JSON.stringify (clj->js body))
              {:status status :content-type "application/json; charset=utf-8"}))

(defn- env->map
  "env の **キーだけ** を keyword で拾う。値はページにも応答にも出さない
  （中継先 URL だけは route/mcp-router-url を通して意図的に表示する）。"
  [env]
  (if env
    (into {} (map (fn [k] [(keyword k) (aget env k)])) (js/Object.keys env))
    {}))

(defn- cors-headers []
  {"access-control-allow-origin" "*"
   "access-control-allow-methods" "POST,OPTIONS"
   "access-control-allow-headers" "content-type,authorization"
   "access-control-max-age" "86400"})

(defn- upstream-headers
  "呼び手のヘッダをそのまま引き継いで上流へ渡す。何を落とすかの判断は
  `route/relay-headers` にある —— そこは `.cljc` なので、渡るものと落ちるもの
  をビルド無しにテストできる。

  引き継ぎを落とすと `authorization` が上流に届かなくなる —— それは移行では
  なく方針変更なので、ここではしない。ただし `content-length` は落とす:
  引き継いだままだと上流への fetch が失敗し 502 になる（実測、route 側に記録）。"
  [req nsid]
  (clj->js (route/relay-headers
             (map (fn [pair] [(aget pair 0) (aget pair 1)])
                  (es6-iterator-seq (.entries (.-headers req))))
             nsid)))

(defn- proxy-xrpc
  "XRPC を MCP router へ中継する。移行前に deploy されていた SvelteKit の
  route と同じ形（jsonrpc の封筒に包み、result/structuredContent を剥がす）。"
  [req env nsid]
  (let [url (route/mcp-router-url (env->map env))
        headers (upstream-headers req nsid)]
    (-> (.json req)
        (.catch (fn [_] #js {}))
        (.then
         (fn [input]
           (js/fetch url
                     #js {:method "POST"
                          :headers headers
                          :body (js/JSON.stringify
                                 #js {:jsonrpc "2.0"
                                      :id (.randomUUID js/crypto)
                                      :method "tools/call"
                                      :params #js {:name nsid :arguments input}})})))
        (.then (fn [resp]
                 (-> (.text resp)
                     (.then (fn [text]
                              (let [payload (try (when (seq text) (js/JSON.parse text))
                                                 (catch :default _ text))
                                    clj-payload (js->clj payload :keywordize-keys true)]
                                (if-not (.-ok resp)
                                  (json {:error "MCP router request failed"
                                         :upstream clj-payload}
                                        (.-status resp))
                                  (let [{:keys [ok? value error upstream]} (route/unwrap-mcp clj-payload)]
                                    (if ok?
                                      (json (or value {}) 200)
                                      (json {:error error :upstream upstream} 502))))))))))
        (.catch (fn [e]
                  ;; 到達できなかったことを隠さない。移行時点で mcp.etzhayyim.com
                  ;; は A レコードを返さないので、これは想像上の経路ではなく
                  ;; **今日の既定の結末**である。
                  ;;
                  ;; 移行前の +server.ts はこの fetch を try で囲っておらず、
                  ;; SvelteKit の未処理例外 → 500 になっていた。ここを 502 +
                  ;; 試した URL に変えたのは意図的な差分で、docs/adr/0001 に
                  ;; 名指しで書いてある（成功と同じ形に潰さないため）。
                  (json {:error "MCP router unreachable"
                         :detail (str (.-message e))
                         :url url}
                        502))))))

(defn- page-response [env]
  (->response
   (view/render {:css dds-css
                 :routes route/routes
                 :vars (sort (keys (env->map env)))
                 :mcp-url (route/mcp-router-url (env->map env))
                 :built-at nil})
   {:status 200
    :content-type "text/html; charset=utf-8"
    :cache "public, max-age=60"}))

(defn fetch-handler [req env _ctx]
  (let [url (js/URL. (.-url req))
        path (.-pathname url)
        {:keys [action nsid allow reason]} (route/dispatch (.-method req) path)]
    (case action
      :page   (page-response env)
      :health (json {:ok true :app "open-kyber" :runtime "cljs"
                     :routes (mapv :route/path route/routes)}
                    200)
      :xrpc   (proxy-xrpc req env nsid)
      :cors-preflight (->response nil {:status 204 :content-type "text/plain"
                                       :extra (cors-headers)})
      :bad-request (json {:error reason} 400)
      :method-not-allowed (->response (js/JSON.stringify #js {:error "Method Not Allowed"})
                                      {:status 405
                                       :content-type "application/json; charset=utf-8"
                                       :extra {"allow" allow}})
      (json {:error "Not Found"
             :routes (mapv (fn [r] (str (str/upper-case (name (:route/method r)))
                                        " " (:route/path r)))
                           route/routes)}
            404))))

(def handler #js {:fetch fetch-handler})
