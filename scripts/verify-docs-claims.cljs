#!/usr/bin/env nbb
;; verify-docs-claims — re-derive every number README.md and docs/operator-quickstart.md
;; state, from the tree itself, and fail when the tree and the prose disagree.
;;
;; Before the cljs migration this file's load-bearing claim was a GAP: the Worker that
;; would be deployed was a SvelteKit build output that was neither in the tree NOR
;; producible from it, while src/app.ts -- the file that read like the application --
;; was in no bundle. That gap is closed, so the claims now assert the CLOSURE, and they
;; are written so it cannot quietly come back: the TypeScript is asserted ABSENT by
;; name, not merely absent from a byte total.
;;
;; It also pins the TypeScript that legitimately STAYS (kotoba/, the ERP domain
;; library). That number is a fence in both directions -- the library cannot grow
;; silently into the appview's job, and it cannot be quietly deleted either.
;;
;; Usage:  nbb scripts/verify-docs-claims.cljs [<dir>]     (<dir> FIRST, default ".")
;; Exit:   0 every claim holds · 1 a claim is false · 2 could not answer

(require '["node:fs" :as fs]
         '["node:child_process" :as cp]
         '["node:crypto" :as crypto]
         '[kotoba.lang.text :as str])

(def root (or (first (remove #(str/starts-with? % "--") *command-line-args*)) "."))
(def APP "etzhayyim-wasm-kyber-erp-kyb3rerp")

(def claims
  {:tracked-files 92
   :svelte-artifacts 0             ; no .svelte / svelte.config / svelte-dir file survives
   :sveltekit-compat-flags 0       ; nodejs_compat / nodejs_als were adapter-cloudflare's
   :appview-ts-files 0             ; the appview holds no TypeScript at all
   :appview-canonical-files 4      ; .cljs/.cljc that replaced it (src 3 + test 1)
   :kotoba-library-files 62        ; the ERP library that was NOT migrated -- pinned both ways
   :kotoba-library-ts-files 59
   :declared-vars 11
   :declared-routes 2
   :wrangler-main "../dist/worker.js"
   :shadow-output-dir "dist"
   :shadow-export "openkyber.worker/handler"})

;; Inherited files this repository still carries BYTE-IDENTICAL.
;; wrangler.jsonc and CLAUDE.md left this set DELIBERATELY -- wrangler.jsonc because the
;; migration repointed main, dropped the assets block and the SvelteKit compat flags;
;; CLAUDE.md because it described the runtime as "TS Native (src/app.ts)" and the UI as
;; "Hono + Svelte CSR", both of which the migration made false. Both are checked by
;; CONTENT below instead of by hash, so a deliberate edit and a stray one stay distinct.
(def preserved
  {"README.edn"                  "2e5a96a447e5b12d636d4a35ea62c45fb04dc45843971febe195d9716c0cbe6e"
   "migration.edn"               "20cce09cc625425d4c44476532491e1a50fbbb001eba6817b02d8a6f0d340711"
   (str APP "/kotodama.jsonld")  "11f02307fe84a8c007c040ce30d59961a68f94ea15b12bdb963505c8f3c187f8"
   (str APP "/etzhayyim.json")   "e4300cad5a662e0c44a3e19c023aa37b43a49c7f5502702ed6b2055e5a62f23f"})

;; What the migration REMOVED, by name. A byte total cannot say "the TypeScript is
;; gone"; this can, and it fails if any of it comes back.
(def removed-by-migration
  [(str APP "/src/app.ts")
   (str APP "/package.json")
   (str APP "/package-lock.json")
   (str APP "/Dockerfile")
   (str APP "/.dockerignore")
   (str APP "/svelte/package.json")
   (str APP "/svelte/index.html")
   (str APP "/svelte/src/app.html")
   (str APP "/svelte/src/main.ts")
   (str APP "/svelte/src/App.svelte")
   (str APP "/svelte/src/routes/+page.svelte")
   (str APP "/svelte/src/routes/xrpc/[...path]/+server.ts")
   (str APP "/svelte/svelte.config.js")
   (str APP "/svelte/vite.config.ts")
   (str APP "/svelte/tsconfig.json")
   (str APP "/e2e/playwright.config.ts")
   (str APP "/e2e/tests/smoke.spec.ts")
   (str APP "/e2e/tests/visual.spec.ts")])

(def undetermined (atom []))
(def failures (atom []))
(defn undet! [m] (swap! undetermined conj m))

(defn tracked-files []
  (try (->> (.execSync cp "git ls-files" #js {:cwd root :encoding "utf8"})
            str/split-lines (remove str/blank?) vec)
       (catch :default e (undet! (str "git ls-files failed: " (.-message e))) nil)))
(defn slurp* [rel] (try (.readFileSync fs (str root "/" rel) "utf8") (catch :default _ nil)))
(defn bytes-of [rel] (try (.-size (.statSync fs (str root "/" rel))) (catch :default _ nil)))
(defn sha256 [rel]
  (try (-> (.createHash crypto "sha256") (.update (.readFileSync fs (str root "/" rel))) (.digest "hex"))
       (catch :default _ nil)))
(defn strip-jsonc [s] (str/replace s #"(?m)^\s*//.*$" ""))

(defn check! [label expected actual]
  (let [ok (= expected actual)]
    (println (str (if ok "PASS" "FAIL") "\t" (name label)
                  "\texpected=" (pr-str expected) "\tactual=" (pr-str actual)))
    (when-not ok (swap! failures conj label))
    ok))

(let [files (tracked-files)]
  (when (nil? files) (println "UNDETERMINED\tcould not list tracked files") (js/process.exit 2))
  ;; evidence floor: an empty scan must never read as "clean"
  (println (str "SCANNED\t" (count files)))
  (when (zero? (count files)) (println "UNDETERMINED\tscanned 0 files") (js/process.exit 2))

  (let [sizes (into {} (map (juxt identity bytes-of)) files)]
    (when-let [bad (seq (keep (fn [[f s]] (when (nil? s) f)) sizes))]
      (undet! (str "tracked but unreadable: " (str/join ", " bad))))

    (check! :tracked-files (:tracked-files claims) (count files))
    (check! :preserved-files-unchanged []
            (vec (keep (fn [[f want]] (let [got (sha256 f)]
                                        (when-not (= want got) (str f " " (or got "MISSING")))))
                       preserved)))

    ;; the TypeScript and Svelte of the APPVIEW are gone, by name
    (check! :removed-by-migration-absent []
            (vec (filter #(some? (bytes-of %)) removed-by-migration)))

    ;; Svelte is gone and must not come back. removed-by-migration names specific files;
    ;; this catches a return under ANY name -- a new .svelte file, a svelte.config, or a
    ;; svelte/ directory.
    (check! :svelte-artifacts (:svelte-artifacts claims)
            (count (filter #(or (str/ends-with? % ".svelte")
                                (str/includes? % "svelte.config")
                                (str/includes? % "/svelte/"))
                           files)))

    ;; CLAUDE.md no longer claims a TypeScript runtime or a Svelte SPA frontend
    (let [c (slurp* "CLAUDE.md")]
      (if (nil? c)
        (undet! "CLAUDE.md unreadable")
        (check! :claude-md-describes-cljs true
                (and (not (str/includes? c "| **UI** | Hono + Svelte CSR"))
                     (not (str/includes? c "TS Native (`src/app.ts`"))
                     (str/includes? c "shadow-cljs")))))

    ;; Language of the production source, split by AREA. The appview must hold no
    ;; TypeScript; the kotoba/ library legitimately holds a lot of it and is pinned so
    ;; it can neither grow silently nor be quietly deleted.
    (let [prod (remove #(str/starts-with? % "scripts/") files)
          appview (filter #(str/starts-with? % (str APP "/")) prod)
          kotoba (filter #(str/starts-with? % "kotoba/") files)]
      (check! :appview-ts-files (:appview-ts-files claims)
              (count (filter #(str/ends-with? % ".ts") appview)))
      (check! :appview-canonical-files (:appview-canonical-files claims)
              (count (filter #(re-find #"\.(cljs|cljc|clj|kotoba)$" %) prod)))
      (check! :kotoba-library-files (:kotoba-library-files claims) (count kotoba))
      (check! :kotoba-library-ts-files (:kotoba-library-ts-files claims)
              (count (filter #(str/ends-with? % ".ts") kotoba))))

    ;; the deployed bundle is built from the source in this tree
    (let [w (some-> (slurp* (str APP "/wrangler.jsonc")) strip-jsonc)
          sh (slurp* "shadow-cljs.edn")]
      (if (or (nil? w) (nil? sh))
        (undet! "wrangler.jsonc or shadow-cljs.edn unreadable")
        (let [j (js->clj (.parse js/JSON w) :keywordize-keys false)]
          (check! :wrangler-main (:wrangler-main claims) (get j "main"))
          (check! :declared-vars (:declared-vars claims) (count (get j "vars")))
          (check! :declared-routes (:declared-routes claims) (count (get j "routes")))
          ;; the old config served a SvelteKit client dir that no longer exists
          (check! :no-stale-assets-binding true (nil? (get j "assets")))
          (check! :sveltekit-compat-flags (:sveltekit-compat-flags claims)
                  (count (filter #{"nodejs_compat" "nodejs_als"}
                                 (or (get j "compatibility_flags") []))))
          (check! :app-framework-not-sveltekit true
                  (not (str/includes? (str (get-in j ["vars" "APP_FRAMEWORK"])) "svelte")))
          (check! :shadow-builds-that-main true
                  (and (str/includes? sh (str ":output-dir \"" (:shadow-output-dir claims) "\""))
                       (str/includes? sh (:shadow-export claims))
                       (str/includes? (get j "main") (str (:shadow-output-dir claims) "/worker.js")))))))

    ;; :warnings-as-errors must sit under :compiler-options. Checked by READING the EDN,
    ;; not by grepping -- a grep matches the comment that explains the trap, so the
    ;; grep version of this check cannot fail.
    (let [sh (slurp* "shadow-cljs.edn")]
      (if (nil? sh)
        (undet! "shadow-cljs.edn unreadable")
        (let [b (try (get-in (cljs.reader/read-string sh) [:builds :worker])
                     (catch :default e (undet! (str "shadow-cljs.edn unreadable as EDN: "
                                                    (.-message e))) nil))]
          (when b
            (check! :warnings-as-errors-in-compiler-options true
                    (true? (get-in b [:compiler-options :warnings-as-errors])))
            (check! :no-build-options-key true (nil? (get b :build-options)))))))

    ;; The page renders the route TABLE rather than a baked count -- the defect ADR-0001
    ;; recorded was a literal `routeCount: 0` beside a config declaring two routes and
    ;; eleven vars. Asserted structurally (the view takes :routes, the worker passes the
    ;; real table) and NOT by forbidding a substring: forbidding "routeCount" anywhere
    ;; would be tripped by the docstring that explains the old defect. A check a comment
    ;; can fail is a check about prose.
    (let [v (slurp* "src/openkyber/view.cljc")
          w (slurp* "src/openkyber/worker.cljs")]
      (if (or (nil? v) (nil? w))
        (undet! "view.cljc or worker.cljs unreadable")
        (check! :page-renders-route-table true
                (and (str/includes? v "[{:keys [routes vars mcp-url built-at]}]")
                     (str/includes? v "(route-rows routes)")
                     (str/includes? w ":routes route/routes")))))

    ;; The ADR is EDN tx-data and actually reads.
    (let [a (slurp* "docs/adr/0001-migrate-the-appview-from-typescript-to-clojurescript.edn")]
      (if (nil? a)
        (undet! "ADR-0001 unreadable")
        (check! :adr-is-readable-edn true
                (try (let [d (cljs.reader/read-string a)]
                       (and (vector? d) (= "accepted" (:adr/status (first d)))))
                     (catch :default e (undet! (str "ADR-0001 does not read as EDN: "
                                                    (.-message e))) false)))))))

(let [u @undetermined f @failures]
  (when (seq u)
    (doseq [m u] (println (str "UNDETERMINED\t" m)))
    (println "Refusing to report a pass: the tree could not be read completely.")
    (js/process.exit 2))
  (if (seq f)
    (do (println (str "FAILED\t" (count f) " claim(s): " (str/join ", " (map name f)))) (js/process.exit 1))
    (do (println "OK\tevery claim in README.md and docs/operator-quickstart.md holds") (js/process.exit 0))))
