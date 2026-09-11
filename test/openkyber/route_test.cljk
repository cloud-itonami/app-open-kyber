(ns openkyber.route-test
  (:require [clojure.test :refer [deftest is testing]]
            [kotoba.lang.text :as str]
            [openkyber.route :as route]
            [openkyber.view :as view]))

(deftest dispatch-page-and-health
  (is (= :page (:action (route/dispatch "GET" "/"))))
  (is (= :health (:action (route/dispatch "GET" "/health"))))
  (is (= :method-not-allowed (:action (route/dispatch "POST" "/health"))))
  (is (= :method-not-allowed (:action (route/dispatch "POST" "/"))))
  (is (= :not-found (:action (route/dispatch "GET" "/nope"))))
  (testing "method は大文字小文字を問わない"
    (is (= :page (:action (route/dispatch "get" "/"))))))

(deftest dispatch-xrpc
  (testing "nsid はそのまま渡る"
    (is (= {:action :xrpc :nsid "com.etzhayyim.apps.kyber.listInvoices"}
           (route/dispatch "POST" "/xrpc/com.etzhayyim.apps.kyber.listInvoices"))))
  (testing "空だけが 400。多段は移行前と同じく転送する（絞るのは方針変更）"
    (is (= :bad-request (:action (route/dispatch "POST" "/xrpc/"))))
    (is (= "Missing XRPC method" (:reason (route/dispatch "POST" "/xrpc/"))))
    (is (= {:action :xrpc :nsid "a/b"} (route/dispatch "POST" "/xrpc/a/b"))))
  (testing "preflight と method"
    (is (= :cors-preflight (:action (route/dispatch "OPTIONS" "/xrpc/x"))))
    (is (= :method-not-allowed (:action (route/dispatch "GET" "/xrpc/x"))))))

(deftest mcp-url-resolution
  (testing "既定値は移行前の +server.ts の DEFAULT_MCP_ROUTER_URL と同じ"
    (is (= "https://mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message"
           (route/mcp-router-url {}))))
  (is (= "https://a.example/x"
         (route/mcp-router-url {:AGENTGATEWAY_MCP_ROUTER_URL "https://a.example/x/"})))
  (testing "空白だけの設定は未設定として扱う（TS 側の .trim() と同じ）"
    (is (= "https://b.example"
           (route/mcp-router-url {:AGENTGATEWAY_MCP_ROUTER_URL "   "
                                  :MCP_ROUTER_URL "https://b.example"})))))

(deftest unwrap
  (is (= {:ok? true :value {:a 1}} (route/unwrap-mcp {:result {:structuredContent {:a 1}}})))
  (is (= {:ok? true :value {:a 1}} (route/unwrap-mcp {:result {:a 1}})))
  (is (false? (:ok? (route/unwrap-mcp {:error {:message "boom"}}))))
  (is (= "boom" (:error (route/unwrap-mcp {:error {:message "boom"}})))))

(deftest page-shows-the-real-routes
  (testing "ページは route 表から描く。0 を焼かない（docs/adr/0001 の欠陥）"
    (let [html (view/render {:css "/*x*/" :routes route/routes
                             :vars [:APP_NANOID :APP_UI_TYPE]
                             :mcp-url "https://mcp.example/x"})]
      (doseq [r route/routes]
        (is (str/includes? html (:route/path r))
            (str (:route/path r) " がページに出ていない")))
      (is (str/includes? html "APP_NANOID"))
      (is (str/includes? html "https://mcp.example/x"))
      (testing "移行前のページが焼いていた文言は出ない"
        (is (not (str/includes? html "No public route is declared")))
        (is (not (str/includes? html "No public vars are declared")))))))

(deftest page-renders-what-it-is-handed
  (testing "route 表を差し替えると、ページの内容も変わる（固定表を描いていない）"
    (let [html (view/render {:css "" :routes [{:route/path "/only-this"
                                               :route/method :get
                                               :route/kind :page
                                               :route/doc "ひとつだけ"}]
                             :vars [] :mcp-url "https://x.invalid"})]
      (is (str/includes? html "/only-this"))
      (is (not (str/includes? html "/health"))))))

(deftest relay-headers-forwards-what-it-received
  (testing "移行前から authorization は届いていた。落ちていたのは長さの方"
    (let [h (route/relay-headers [["Host" "x.example"]
                                  ["Authorization" "Bearer t"]
                                  ["Content-Length" "9"]
                                  ["Content-Encoding" "gzip"]
                                  ["X-Trace" "abc"]]
                                 "com.a.b")]
      (is (= "Bearer t" (get h "authorization"))
          "authorization が落ちている —— preflight はこれを許可すると言っている")
      (is (= "abc" (get h "x-trace"))
          "呼び手が付けた header が落ちている")
      (is (nil? (get h "host")) "host は宛先が変わるので渡さない")
      (is (nil? (get h "content-length"))
          "呼び手の長さを載せると上流への fetch が失敗し、502 になる（実測）")
      (is (nil? (get h "content-encoding"))
          "body を詰め直すので元の encoding も嘘になる")
      (is (= "application/json" (get h "content-type")))
      (is (= "com.a.b" (get h "x-etzhayyim-xrpc-method")))
      (is (= "cljs-worker" (get h "x-etzhayyim-bff"))))))
