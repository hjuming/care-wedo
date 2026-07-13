# Care WEDO 下一階段開發優化計劃書

日期：2026-07-14  
依據：[外部審查綜整](./reports/persona-review-synthesis-2026-07-14.md)、[主要照護者報告](./reports/persona-review-primary-caregiver-live-staging-2026-07-14.md)、[家屬協作者報告](./reports/persona-review-family-collaborator-live-staging-2026-07-14.md)、[長輩報告](./reports/persona-review-elder-viewer-live-staging-2026-07-14.md)、[staging 最終驗收](./reports/staging-deployment-final-2026-07-14.md)。

## 一、決策摘要

目前 staging 已證明三角色可登入同一虛構家庭，主要照護者可建立行程、協作者可記錄用藥，長輩的未授權寫入會被後端以 403 拒絕；但產品尚不能開放正式家庭使用。

下一階段採以下順序：

1. **P0：照護安全與身分信任**——修正長輩仍看得到管理控制、403 後假成功、中文姓名亂碼、家庭提醒無明確結果。
2. **P1：資料一致性與協作回饋**——先用乾淨 fixture 復驗重複行程，再處理去重、操作者／同步時間、費用與登入文案。
3. **P1/P2：資訊架構與手機可靠性**——分離長輩今日視圖與家庭管理中心，修正小螢幕溢出與底部導覽遮擋。
4. **另案：OCR、LINE、掛號、推播與 billing 整合**——完成 sandbox 與失敗路徑前，不宣稱完整可用。

## 二、產品目標與範圍

### 目標

讓主要照護者、家屬協作者、長輩在同一家庭中，能清楚知道「誰能做什麼、哪筆資料已成功、誰在何時做了什麼」，且長輩不會被管理操作或錯誤成功訊息誤導。

### 本階段納入

- 角色能力契約與長輩唯讀介面。
- 401/403/逾時/失敗的統一 mutation 回饋與 rollback。
- UTF-8 與照護對象 canonical `display_name`。
- 家庭提醒落庫、重試、跨帳號 read-back。
- 行程去重／idempotency、協作 audit trail。
- 費用與測試模式文案、登入 provider 文案。
- 長輩今日視圖、照護圈分區、412px 與大字體回歸。

### 本階段不納入

- 不部署 production、不修改 production secrets、不重用 staging secret。
- 不使用真實醫療、LINE、付款或通知資料。
- OCR/Gemini、LINE webhook、外站掛號、推播、billing 只建立另案 sandbox 與測試規格。

## 三、證據轉成開發優先級

| 編號 | 問題 | 等級 | 先做什麼 |
| --- | --- | --- | --- |
| P0-01 | 長輩仍看到編輯、拍照新增、邀請、新增照護對象、刪除、付款等管理控制 | P0 | 由單一 capability response 控制前後端；長輩只保留今日資訊與明確白名單操作 |
| P0-02 | 長輩服藥 mutation 回 403，畫面卻顯示「已記錄」 | P0 | 禁止 optimistic success；403/逾時要回復原狀、顯示可理解錯誤與重試 |
| P0-03 | 中文姓名 mojibake，照護對象退回泛稱 | P0 | 稽核 DB→API→JSON→瀏覽器→build 的 UTF-8 鏈路，統一使用 canonical display name |
| P0-04 | 家庭提醒停在「儲存中...」，沒有成功／失敗／重試 | P0（重現後） | 先補四態與 timeout，再以 network、資料庫、跨帳號 read-back 證明結果 |
| P0-05 | 8/18 回診卡重複；可能是 live gate 重跑造成 | P1，乾淨 fixture 重現則升 P0 | 先重建單一 fixture，再決定是否修 API/DB 去重 |
| P1-01 | Email/Password 登入後卻顯示 Google 帳號 | P1 | 依實際 provider 顯示 Email／Google／LINE／測試帳號 |
| P1-02 | 費用與額度同頁出現互相矛盾的數字 | P1 | 建立計價 SSOT；staging 只顯示測試模式與不扣款說明 |
| P1-03 | 協作者成功操作沒有操作者、時間、同步狀態 | P1 | 建立 read-only audit trail 與最後同步時間 |
| P1-04 | 回診卡只顯示「回診」，科別資訊消失 | P1 | 標題固定為「科別＋類型」，儲存後顯示摘要 |
| P1-05 | 照護圈過長且長輩看到管理中心 | P1 | 拆分家庭管理中心與長輩今日視圖 |
| P1-06 | 412×915 長 email 溢出、底部導覽可能遮擋內容 | P1 | 修正 `min-width`、safe-area、底部 padding，建立視覺回歸 |
| P2-01 | 「我已吃完」語意不明、摘要重複、空時段過度佔高 | P2 | 改成「標記本次已服用」，顯示日期／時段／操作者並簡化空狀態 |

## 四、執行階段與出口

### Phase 0｜資料與驗證基線（1 個工作日）

- 固定一組 staging 虛構家庭與三個測試帳號；記錄 profile/group/appointment ID，禁止測試 gate 重跑建立重複資料。
- 建立不含個資與 secret 的結構化診斷欄位：mutation 結果、auth provider、UTF-8 狀態、request correlation id。
- 產出三角色登入、單一行程、單一藥單、提醒初始狀態及 412×915 截圖基線。

**出口：** 同一 fixture 重跑結果可比較，且能區分資料、API、UI 問題。

### Phase 1｜P0 安全與身分信任（2–4 個工作日）

- 實作 `capabilities` 單一來源；長輩不渲染管理 mutation，後端 RBAC 維持 server-side deny。
- 統一處理 401/403/4xx/逾時，特別覆蓋 `/api/medications/taken`；失敗不得改變成功狀態。
- 完成 UTF-8 稽核與 canonical care profile name；明示「正在查看誰／目前角色／可做範圍」。
- 家庭提醒加入 loading、success、error、timeout、retry，並完成跨帳號重新登入 read-back。

**出口：** 長輩管理控制為 0（若產品決定保留服藥確認，僅保留一個白名單控制）；403 不呈現成功；四頁姓名正確；提醒結果可證明。

### Phase 2｜資料一致性與協作（3–5 個工作日）

- 用乾淨 fixture 追查重複行程；必要時加入 appointment ID 去重、相似資料提示及 idempotency key，不直接刪歷史資料。
- 修正回診標題、儲存摘要；服藥／提醒顯示操作者、時間與同步狀態。
- 建立行程、服藥、藥單、家庭提醒的 read-only audit trail。

**出口：** 建立一次只出現一筆；跨帳號重新登入仍一致；重要異動可追溯操作者與結果。

### Phase 3｜資訊架構、費用與手機可靠性（3–5 個工作日）

- 照護圈拆成家庭與成員、提醒與通知、照護資料、費用與帳號；長輩只保留聯絡卡與唯讀說明。
- 長輩首頁順序改為「今天用藥 → 今天行程 → 下一次回診」，移除新增照護資料 CTA。
- 計價由單一 SSOT 輸出；staging/production 文案與額度分流，關閉矛盾數字。
- 修正長 email、safe-area、固定底導覽；加入 412px 與 130%/150% 字級案例。

**出口：** 手機無溢出／遮擋；長輩第一屏無管理噪音；每個環境只呈現一套計價規則。

### Phase 4｜整合 sandbox（另案）

- OCR/Gemini 使用獨立 staging key 與虛構文件；LINE 使用 sandbox webhook；billing 使用測試交易。
- 補外站掛號、推播、session refresh、弱網／離線、螢幕閱讀器與 Android 大字體測試。

**出口：** 每項整合都有成功、失敗、逾時、撤銷路徑，且沒有 production secret 或真實資料進入測試。

### Phase 5｜Fresh-context 驗證（永遠最後）

- 主要照護者：新增行程、查看藥單、邀請協作者。
- 家屬協作者：查看同一行程、記錄服藥、儲存提醒、重新登入確認。
- 長輩：只讀取 dashboard/行程/用藥；任何未授權寫入均 403，且畫面不得假成功。
- 桌面、412×915、130%/150% 字級、session refresh、production hostname fail-closed 均驗證。
- 保存 PNG、JSON、API status 與測試指令，供下一輪審查回讀。

## 五、建議開發工作單

1. **P0 fix**：建立 Role capability contract 與長輩唯讀 UI gate（依賴 Phase 0）。
2. **P0 fix/test**：統一 mutation 錯誤狀態、403 rollback、服藥 E2E。
3. **P0 fix/test**：UTF-8、canonical care profile name、三姓名 smoke test。
4. **P0 fix/test**：家庭提醒 persistence、timeout、retry、跨帳號 read-back。
5. **P1 fix/test**：appointment idempotency、dedupe、clean-fixture 驗證與 audit。
6. **P1 fix**：provider label、Internal/Test 模式、費用 SSOT。
7. **P1 feat**：Care Circle 分區與 elder today view。
8. **P1 fix/test**：mobile login、safe-area、bottom-nav visual regression。
9. **P2 fix**：服藥完成語意、操作者／同步時間、可控復原。
10. **P2 spike**：OCR、LINE、billing、掛號、推播 sandbox E2E。

每張工作單需附自動或半自動驗收條件，並標示依賴；P0 工作未關閉前不得開新整合功能。

## 六、共同 Definition of Done

- 三角色可在 fresh context 以 staging 安全入口登入；production hostname 上 reviewer flag 仍 fail closed。
- 長輩看不到管理 mutation；未授權寫入皆 403，UI 顯示失敗且不產生假成功。
- 姓名、照護對象、家庭名稱完整以 UTF-8 顯示，無不明泛稱。
- 單一乾淨 fixture 建立一次只出現一筆行程；行程／服藥／提醒可查成功狀態、操作者與時間。
- 412×915、桌面、130%/150% 字級無文字溢出、底部遮擋或不可點擊控制。
- `/api/health` 對未配置的可選整合維持明確 degraded，不得誤報 production-ready。
- 所有回滾只作用於 `care-wedo-staging`，不修改 production、`main` 或 production secrets。

## 七、待確認事項與風險控制

- **重複行程：** 先用乾淨 fixture 重現；確認前不刪除歷史資料，必要時先折疊／標記並保留 audit。
- **家庭提醒：** 以 network response、資料庫 read-back、另一帳號重新登入三點確認是否真正落庫。
- **完成確認權限：** 產品需決定長輩是否保留唯一的服藥／完成白名單；未決前採唯讀較安全。
- **費用規則：** 確認 Internal/Test badge、正式上限、計價時間點的唯一數字來源。
- **照護對象名稱：** 確認 canonical `display_name`、隱私遮罩與泛稱 fallback 規則。
- **整合風險：** OCR、LINE、billing 未驗證前，不得以本輪 reviewer flow 推論完整產品可用性。

**正式開放門檻：** Phase 1–3 出口全部達成、Phase 5 fresh-context evidence 可回讀、P0 無未關閉項目，並由產品與資安共同簽核。 
