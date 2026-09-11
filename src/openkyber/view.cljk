(ns openkyber.view
  "この appview の説明ページ。純 hiccup。

  基盤は `jp-go-dds`(デジタル庁デザインシステム) —— superproject の skill
  `kotoba-uiux` が定める新規 UI の base。色・寸法は `--hig-*` トークン契約で
  書き、raw hex も px フォントサイズも置かない。

  **表示する事実は引数で受け取る。ページの中に焼かない。**
  これは装飾の都合ではなく、docs/adr/0001 が記録した欠陥そのものへの答えで
  ある —— 移行前のページは `routeCount: 0` と `routes: []` と `vars: []` を
  literal で持っており、隣の wrangler.jsonc が route 2 本・var 11 個を宣言して
  いることに気づけなかった。ここでは route 表と設定を渡す側が持ち、ページは
  描くだけなので、両者がずれる余地が無い。"
  (:require [jp-go-dds.core :as dds]
            [jp-go-dds.page :as page]
            [jp-go-dds.tokens :as tokens]
            [kotoba.lang.text :as str]))

(def app-css
  "app 固有の最小 CSS。`--hig-*` 契約だけを使う(bridge が DADS の上に再定義する)。
  DADS を base にした app の下には `shitsuke.hig` が居ないので、bridge が運んで
  いないトークンは何にも解決しない —— 使うのは運ばれている中だけ。"
  (str/join
   "\n"
   [".ok-lede { color: var(--hig-color-secondary-label); max-width: 44rem; }"
    ".ok-note { color: var(--hig-color-secondary-label); font-size: var(--hig-text-footnote-font-size); }"
    ".ok-mono { font-family: var(--hig-font-mono); }"]))

(defn- route-rows [routes]
  (mapv (fn [r]
          [(str/upper (name (:route/method r)))
           [:span {:class "ok-mono"} (:route/path r)]
           (:route/doc r)])
        routes))

(defn body
  "opts:
   :routes    openkyber.route/routes（この Worker が実際に答えるもの）
   :vars      wrangler が渡した env のキー（**キー名だけ**。値は出さない）
   :mcp-url   XRPC の中継先（route/mcp-router-url の戻り値。**値そのものを出す**）
   :built-at  bundle のビルド時刻（不明なら nil）"
  [{:keys [routes vars mcp-url built-at]}]
  (dds/container
   (dds/section
    {}
    (dds/heading 1 "Kyber ERP — open-kyber appview")
    [:p {:class "ok-lede"}
     "APQC 準拠の企業 ERP（会計・AP/AR・人事・調達・在庫・販売）の公開面。"
     "この Worker が持つのは**公開面だけ**で、ERP の計算そのものはここには無い。"])

   (dds/section
    {:title "この面が答えるもの"}
    (dds/table {:caption "公開ルート"
                :headers ["METHOD" "PATH" "何をするか"]
                :rows (route-rows routes)})
    [:p {:class "ok-note"}
     "この表は Worker の route 表そのものから描いている。ページに焼いた値では"
     "ないので、実際に答えるものと表示がずれない。"])

   (dds/section
    {:title "実行時の設定"}
    (if (seq vars)
      [:div (into [:p] (interpose " "
                                  (map (fn [k] (dds/chip-label (name k))) vars)))
       [:p {:class "ok-note"}
        "キー名のみ。**ただし下の中継先だけは値そのもの**（"
        [:span {:class "ok-mono"} "AGENTGATEWAY_MCP_ROUTER_URL"]
        "）—— どこへ中継するかは運用者が見る必要があるので意図的に出している。"
        "それ以外の値は出さない。"]]
      [:p {:class "ok-note"} "env が渡されていない（ローカル描画）。"])
    [:p {:class "ok-note"} "XRPC の中継先: "
     [:span {:class "ok-mono"} mcp-url]])

   (dds/section
    {:title "この Worker が ERP を計算しないこと"}
    [:p {:class "ok-lede"}
     "`/xrpc/:nsid` は受け取った nsid を MCP router へそのまま中継する。"
     "この Worker は ERP のコマンドを 1 つも実装していない —— 会計・AP/AR・"
     "在庫・資産・監査などの実装は同じ repository の "
     [:span {:class "ok-mono"} "kotoba/"]
     " にある TypeScript ライブラリで、そちらは kotoba Datom log に対して動き、"
     "この Worker を経由しない。"]
    [:p {:class "ok-note"}
     "移行前の README は『ERP Worker — the deployed XRPC surface"
     "（com.etzhayyim.apps.kyber.*）』と書いていたが、deploy されていた"
     "SvelteKit の面が持つ server route は中継 1 本だけだった（docs/adr/0001）。"])

   (dds/section
    {:title "現在地"}
    [:p {:class "ok-lede"}
     "この appview は TypeScript/Svelte から ClojureScript へ移行済み。"
     "deploy される bundle は、いま読んでいるソースからコンパイルされたもので"
     "ある（docs/adr/0001）。"]
    (when built-at
      [:p {:class "ok-note"} "bundle build: " built-at]))))

(defn render
  "完全な HTML 文書。`css` は呼び出し側が渡す(ライブラリは I/O を持たない)。"
  [{:keys [css] :as opts}]
  (page/->page
   {:title "Kyber ERP — open-kyber appview"
    :description "APQC 準拠の企業 ERP（会計・AP/AR・人事・調達・在庫・販売）の公開面。"
    :lang "ja"
    :css css
    :app-css (str tokens/bridge-css "\n" app-css)}
   (body opts)))
