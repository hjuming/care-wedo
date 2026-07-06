# Care WEDO — 系統優化與技術債開發計劃（盲點檢視版）

> 產出日期：2026-07-06
> 定位：補充 `DEVELOPMENT_PLAN.md`（功能進度）沒有涵蓋的「工程體質 + 長輩友善無障礙」缺口。
> 方法：實際掃描 repo、跑測試、量測 CSS 對比度；事實與推論分開標示。

---

## 一句話結論

功能面與資安面（租戶隔離、CI gate、RLS sync）做得比多數同規模專案扎實，但**「長輩友善」在視覺無障礙上不及格**（多處文字對比低於 WCAG AA），且 **App.jsx 巨石（3,667 行）＋ 全案零型別檢查**讓每次改動的回歸風險持續累積。

---

## 事實（親眼看到的，均可指到證據）

### A. 長輩友善 / 無障礙

| # | 事實 | 證據 |
|---|---|---|
| A1 | `--text-muted: #8A9699` 在背景 `#F7F3EC` 上對比 **2.75:1**、在白底上 **3.04:1**（WCAG AA 需 4.5:1）；index.css 使用 16 次 | `src/index.css:12`，程式計算 |
| A2 | 白字放在 `--primary: #5E8F9A` 上對比 **3.58:1**，低於 AA；17 個 `background: var(--primary)` 區塊中 14 個配白字（主要按鈕樣式） | `src/index.css` grep 統計 |
| A3 | LINE 綠按鈕白字對比 2.26:1（品牌色，屬已知取捨） | 程式計算 |
| A4 | 全檔**無** `prefers-reduced-motion` / `prefers-contrast`；`html { scroll-behavior: smooth }` 恆開 | `src/index.css:44` 起，grep 0 筆 |
| A5 | 11–13px 小字約 16 處（0.78rem 最小） | grep 統計 |
| A6 | 10 處 clickable `<div onClick>`，全案 `role="button"` 0 筆（鍵盤/讀屏不可及） | grep `App.jsx`、`components/*.jsx` |
| A7 | 做得對的部分：base font 18px、`--tap-min: 52px` 且有套用、`aria-` 80 處、`<html lang="zh-TW">`、`:focus` 樣式 17 處 | `src/index.css:32,55`、grep |

補充：專案自己的《長輩友善版開發計劃書》風險欄已寫「莫蘭迪色對比不足」——A1/A2 證實這個風險已成事實，未被處理。

### B. 程式結構與技術債

| # | 事實 | 證據 |
|---|---|---|
| B1 | `App.jsx` **3,667 行**、47 個 `useState`；Landing、Login、AuthCallback、DashboardApp、Modal、Icon 全在同一檔。`DashboardApp` 單一函式約 1,100 行（1272–2371） | `wc -l`、grep 函式定義行號 |
| B2 | `index.css` **7,405 行**單檔（含 12 個 `!important`、12 個 @media） | `wc -l` |
| B3 | `functions/callback.ts` 1,023 行單檔 | `wc -l` |
| B4 | **全 repo 無 tsconfig、無 `tsc` / typecheck**：functions/ 20+ 個 .ts 只被 `tsx` 去型別執行；CI（deploy.yml）只有 lint、test、build | `find tsconfig*` 0 筆、grep workflows |
| B5 | 前端測試 174/174 通過（本機實跑），但全部是 node --test 的邏輯/字串回歸測試，**0 個元件渲染測試**（無 testing-library） | `npm test` 實跑輸出、src 檔案清單 |
| B6 | `care-wedo-bot/` 已從 git 移除（commit 427e195）但磁碟殘留 `.venv`、`__pycache__`、`instance/care_wedo_prod.db`（含 prod 命名的 SQLite） | `git log -- care-wedo-bot`、`ls` |
| B7 | `supabase/` 19 個手動命名 migration（`migration_phaseNN_*.sql`），非 CLI timestamped，靠 runbook 手動套 production | `ls supabase/`、runbook 文件 |

### C. API / 安全

| # | 事實 | 證據 |
|---|---|---|
| C1 | 所有 API 回 `Access-Control-Allow-Origin: *` | `functions/api/_middleware.ts:6` |
| C2 | 公開端點 `/api/feedback`、`/api/telemetry` 無 rate limit（telemetry 有 8KB body 上限與欄位截斷，feedback 沒有等價防護） | 兩檔 grep |
| C3 | 做得對的部分：secrets 未進 git（歷史掃過，只有 example 佔位符）；middleware 統一驗證＋public path 白名單明確；tenant-isolation 測試 908 行覆蓋跨群組寫入 | `git grep` 歷史、`_middleware.ts`、`_tests/` |

---

## 推論（我的判斷，非事實）

1. **A1/A2 對長輩是 active harm**：老花、白內障、黃斑部病變在目標客群極常見，2.75:1 的輔助文字很可能「看不到」而非「不好看」。這直接牴觸產品自己的「長輩可讀」原則。
2. **B1＋B4＋B5 疊加 = 重構安全網很弱**：字串回歸測試抓得到文案改壞，抓不到型別錯與渲染炸掉。推論：拆 App.jsx 之前必須先補 typecheck，否則拆的過程風險最高。
3. B7 的手動 migration 在單人維護時可行，但**協作者加入或需要重建環境時會斷**（無法自動重放到正確狀態）。未驗證：production 實際 schema 與 19 個檔案的累積結果是否一致。
4. C1 在純 Bearer token（無 cookie）架構下不是立即漏洞，但 token 一旦外洩，任何網站都能代打 API；收斂 origin 是低成本保險。
5. B6 的 `care_wedo_prod.db` 若含真實個資/醫療資料，留在本機磁碟違反專案自己的資料圍堵原則（`DATA_CONTAINMENT_CONTRACT.md`）。未驗證 db 內容（sandbox 無 sqlite3）。

---

## 最該改的一件事

**修色彩對比（Phase A-1）。**
理由：改的是 `index.css` 頂部十幾行 CSS 變數，半天內可完成、可回退、不動任何邏輯；受益的是產品的核心承諾（長輩看得清楚）。所有其他技術債都是「未來成本」，這件是「現在每天都在發生的傷害」。

---

## 開發計劃

### Phase A — 長輩友善無障礙快修（P0）✅ 已施作（2026-07-06）

> 施作紀錄：
> - A-1：`--text-muted` → `#5F6D70`；新增 `--action-bg` `#315F68`（16 處白字按鈕底改用）、`--action-bg-hover`、`--accent-dark`（今日曆標記）；`scripts/contrast-check.mjs` 建立並掛進 `deploy.yml`（`npm run a11y:contrast`），11 組 token 全過 AA。
> - A-2：全案最小字級提到 **14px**（原 11–13px 共 16 處；已核對 avatar/tag/nav 盒模型均容納）；`scroll-behavior: smooth` 改為尊重 `prefers-reduced-motion`；檔尾加全域 reduced-motion 關閉動效。
> - A-3：10 處 `<div onClick>` 經查全為 modal 背景關閉的標準模式（皆有實體關閉鈕），不需改 button；補了 4 個 `✕` 鈕的 `aria-label="關閉"` 與 UploadGuide 的 `role="dialog"` 語意；`<img>` alt 盤點通過。
> - 驗證：eslint 0 錯、前端測試 174/174、contrast gate 全過。build 因沙箱平台限制未跑，由 CI 驗證。
> - 未做（移入 Phase C）：modal 的 Esc 鍵關閉與 focus trap——長輩以觸控為主，優先級較低。

**A-1 色彩 token 修正（半天）** ✅ 已拍板（2026-07-06）
- `--text-muted` `#8A9699` → `#5F6D70`（在 `#F7F3EC` 上約 5.4:1）。
- 白字按鈕底色統一改用現有 `--primary-dark: #315F68`（7.08:1，AAA）；不新增色票。`--primary` 保留給邊框/底色等非文字用途。
- 驗證：把本檔的對比計算腳本存成 `scripts/contrast-check.mjs`，列入 CI（低於 4.5 即 fail），從此不再回退。

**A-2 動效與小字（半天）**
- 加 `@media (prefers-reduced-motion: reduce)` 關閉 transition/animation 與 smooth scroll。
- 11–13px 的 16 處小字：內文類提到 15–16px；純裝飾標籤可保留但需通過對比檢查。

**A-3 clickable div 改 button（1 天）**
- 10 處 `<div onClick>` 改 `<button type="button">`（沿用既有 class，補 `background:none;border:none` reset 即可），確保鍵盤 Tab/Enter 可操作。
- 驗證：鍵盤走完「登入 → 看今日 → 標記已吃藥」全流程不碰滑鼠。

### Phase B — 工程安全網（P0/P1，約 2 天）

**B-1 補 typecheck gate（1 天，P0）** ✅ 已施作（2026-07-06）
- 新增根目錄 `tsconfig.json`（strict + noEmit，涵蓋 functions/scripts/workers）；devDeps 加 typescript / @cloudflare/workers-types / @types/node。
- 首輪 165 個型別錯誤全數修復。主要病灶與處置：
  - 136 個來自 `request.json<T>().catch(() => ({}))` 產生 `T | {}` union → 新增共用 `functions/_shared/request_body.ts` 的 `readJsonBody<T>()`（回傳 `Partial<T>`），12 個 API 檔統一改用。
  - **抓到一個真 bug**：`functions/api/documents/upload.ts` 用 `context.userId`（runtime 為 undefined），應為 `documentContext.userId`——上傳文件的 `uploaded_by` 與 log 的 user_id 一直是 undefined。
  - `sendProductionAlert` 的 AlertEnv weak-type 錯誤 11 處 → 三份 local `Env` 型別補上 alert 欄位（也暴露了 Env 重複定義 3 份的技術債，列入 Phase C 收斂）。
  - cron 兩檔：`uniqueNumbers` 補 typeof 收窄、`LineRecipient.groupId` 補 `?? null`；callback.ts reassign 分支補 `replyToken` guard；confirm.ts 補顯式回傳型別。
- CI：deploy.yml 新增 `Typecheck` step；並新增 `npm run verify` 一鍵跑 lint + 前端測試 + typecheck + functions 測試 + contrast + RLS sync + receipt pack。
- 驗證：`tsc --noEmit` 0 錯、前端 174/174、lint 0 錯、contrast/RLS/receipt gate 全過（functions 測試與 build 由 CI 驗證，沙箱平台限制）。

**B-2 清理 bot 殘留（半小時，P1）** ✅ 已驗證（2026-07-06）
- 實際開檔檢查：`care_wedo_prod.db` 與 `care_wedo_dev.db` 五張表（users、family_groups、user_family_groups、appointments、medications）**全部 0 筆**，僅空 schema，無真實資料。可直接刪除整個 `care-wedo-bot/`、`.gitidx.bNAUPF`、根目錄 `.pytest_cache`。

### Phase C — 拆 App.jsx 巨石（P1，約 1–1.5 週，分步可回退）

已有現成模式可循：`src/features/{appointments,medications,ocr}/` 就是先例。依賴 B-1 完成。

建議切法（每步一個 commit、跑完 174 測試再進下一步）：
1. `LandingPage`（669–1019 行）→ `features/landing/`
2. `LoginPage` + `AuthCallbackPage` → `features/auth/`
3. Plan/計費相關（`PlanTierTable`、`PlanDetailsModal`、`estimateCareCirclePrice`…）→ `features/billing/`
4. `ProfileSwitcher` + `ProfileEditModal` + 排序 helpers → `features/profiles/`
5. 頂部 20 個 normalize/format 純函式 → `features/shared/`（與既有 `careFormatters.js` 合流）
6. 最後 `DashboardApp` 的 47 個 useState 依區塊收斂成 3–4 個 `useReducer` 或自訂 hook

驗收：`App.jsx` < 400 行；lint、test、build 全綠；LINE WebView 手動走一次上傳流程。

### Phase D — 制度化與收斂（P2，穿插進行）

- **D-1 migration 制度化**：改用 `supabase db` CLI timestamped migrations；現存 19 檔壓成一個 baseline schema + 之後只允許 CLI 產生的新檔。驗證：從空 DB 重放到與 production schema diff 為零。
- **D-2 CORS 收斂**：`Access-Control-Allow-Origin` 改為白名單（pages.dev 正式域 + localhost dev）。
- **D-3 feedback rate limit**：比照 telemetry 的防護，加 body 上限＋簡單 IP 節流（Cloudflare KV 或 Turnstile）。
- **D-4 index.css 模組化**：拆檔前先加 stylelint 到 CI（devDependencies 已裝但沒進 gate）；再依 Phase C 的 feature 邊界逐步搬移。
- **D-5 元件測試**：至少為「今日清單、吃藥打卡、Profile 切換」三個核心流程補渲染測試（vitest + testing-library），彌補純字串回歸的盲區。

---

## 好的部分（只列影響判斷的）

- 租戶隔離測試（908 行）與 deploy 前 CI gate 是真的在守，Phase C 重構的後端風險因此偏低。
- secrets 管理乾淨（歷史掃描無外洩）；log 去識別化有落實到 telemetry 欄位截斷。
- a11y 基本盤（18px base、52px tap target、aria 80 處）優於一般專案——問題集中在「對比」與「語意化」，不是全面重做。

## 待辦確認事項（2026-07-06 更新）

1. ~~`care_wedo_prod.db` 是否含真實資料~~ → **已驗證為空**（見 B-2），可安全刪除。
2. production Supabase schema 與 19 個 migration 檔是否一致 → **尚不確定**。D-1 施作時先做：`supabase db pull` 拉下 production schema，與本地 `schema.sql` + migrations 重放結果 diff；差異歸零後才建 baseline。
3. `functions` 測試 sandbox 無法跑是 esbuild 平台限制，非專案缺陷；CI 上通過。
4. ~~對比色拍板~~ → **已決定**：白字按鈕用 `--primary-dark`，不新增色票（見 A-1）。
5. `alt` 屬性盤點：併入 Phase A-3 施作時逐一對照 `<img>`。
