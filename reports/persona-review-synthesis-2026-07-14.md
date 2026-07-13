# Care WEDO 外部審查發現綜整

日期：2026-07-14  
範圍：`care-wedo-staging.pages.dev` 虛構測試家庭、主要照護者／家屬協作者／長輩三角色，以及 staging fresh-context 驗收。  
用途：作為下一階段開發優化計劃的證據基線；不等同 production-ready 核准。

## 1. 來源與證據邊界

本綜整只採用下列已讀回報告與其附帶的 live evidence：

1. [主要照護者實測報告](./persona-review-primary-caregiver-live-staging-2026-07-14.md)：登入、既有行程／用藥、UI 新增 2026/08/20 回診、邀請與費用資訊。
2. [家屬協作者實測報告](./persona-review-family-collaborator-live-staging-2026-07-14.md)：跨帳號可見、服藥紀錄、家庭提醒儲存嘗試、412 × 915 手機檢視。
3. [長輩實測報告](./persona-review-elder-viewer-live-staging-2026-07-14.md)：唯讀介面、兩次實際 mutation、403 與錯誤回饋、長輩資訊負擔。
4. [staging 最終驗收](./staging-deployment-final-2026-07-14.md)：環境隔離、三角色 RBAC、回滾與未驗整合項目。
5. `reports/persona-live-evidence/`：各頁 PNG、DOM inventory、mutation JSON 與 API 狀態。

證據邊界：三角色核心 staging flow 已被實際操作；LINE、外站掛號、付款、推播、OCR/Gemini、真實通知、螢幕閱讀器、離線／弱網與 Android 130%／150% 字級尚未驗證。重複回診已知可能由 live gate 重跑測試資料造成，需用乾淨 fixture 再驗，不能直接宣稱為唯一的 production 資料庫缺陷。

## 2. 綜合判斷

目前可交付「受控 staging 研究」，不可交付家庭正式使用。三角色的登入、同家庭共享與後端角色拒寫已成立；阻擋正式開放的是前端對角色能力的錯誤投影、失敗後的錯誤成功感、姓名編碼與同步可信度。

下一階段順序應是：

1. 先封住照護安全與身分信任風險（P0）。
2. 再修正資料一致性、儲存回饋與費用規則（P1）。
3. 最後簡化長輩資訊架構、補整合驗證與視覺細節（P2）。

不能以「後端已 403」取代前端安全體驗；對長輩來說，按得到管理按鈕或看到假成功，已足以造成誤判。

## 3. 發現分級與建議處置

| ID | 發現與證據 | 使用者／業務影響 | 分級 | 建議處置 |
| --- | --- | --- | --- | --- |
| P0-01 | 長輩畫面仍渲染「編輯、拍照新增、邀請、新增照護對象、刪除／儲存、付款」；見 elder 報告、`elder-care-circle.png`、`elder-ui-permission-check.json`。 | 長輩害怕誤改；角色邊界不可信。後端雖拒絕，前端仍引導錯誤操作。 | P0 | 由同一個 capability response 同時控制 API 與 UI；長輩只渲染今天、行程、用藥與必要的完成白名單。 |
| P0-02 | 長輩按「我已吃完」時 `/api/medications/taken` 回 403，但 DOM 仍顯示「已記錄」且無錯誤；見 `elder-medication-403.png`、`elder-ui-permission-check.json`。 | 形成無聲失敗／錯誤成功感，可能讓家人誤判服藥已完成。 | P0 | 禁止 optimistic success；403／逾時需回復原狀態、顯示可理解訊息、保留重試，並加 E2E。 |
| P0-03 | 中文姓名在首頁、排程、用藥、照護圈呈 mojibake；照護對象退回「親愛的家人」；見三份報告與各頁截圖。 | 無法確認目前帳號／正在照護誰，直接傷害醫療資料身分信任。 | P0 | 稽核 DB、API headers、JSON、瀏覽器與 build 的 UTF-8 鏈路；以實際 care profile display name 作為唯一顯示來源。 |
| P0-04 | 家庭提醒按儲存後停在「儲存中...」，無成功／失敗／重試；`collaborator-family-reminder-saved.json` 為 `familyReminderVisible: false`。 | 交代事項可能未送達，使用者卻會離開頁面；若可重現，屬照護同步風險。 | P0（重現後） | 先補 timeout、錯誤、成功（時間／操作者）三態，再確認 API 落庫與跨帳號可見；未確認落庫前不得顯示完成。 |
| P0-05 | 8/18 09:30 完全相同回診卡出現兩次；主審查標 P0，協作者標 P1；來源可能含 live gate 重跑。 | 長輩可能以為要去兩次，或重複加入行事曆／重複編輯。 | P1，若乾淨 fixture 仍重現則升 P0 | 先重建單一乾淨 fixture，追查建立來源；以 appointment ID 去重、建立前做相似資料提示與 idempotency，避免直接刪歷史資料。 |
| P1-01 | 測試 Email/Password 登入後帳號區寫「Google 帳號」，成員卡又寫 Email。 | 帳號復原、資安認知與支援判斷混亂。 | P1 | 依實際 auth provider 顯示 Email、Google、LINE 或「測試帳號」；加 provider smoke test。 |
| P1-02 | 費用／額度同頁同時出現 $0/$10、99/98 與 4/5；見 primary、collaborator 報告。 | 家庭不敢邀請成員，也無法預估扣款；billing 決策失去可信度。 | P1（商業阻擋） | 單一後端計價 SSOT；staging 只顯示「測試資料、不會扣款」與 Internal/Test badge，正式版不出現內部額度。 |
| P1-03 | 協作者服藥記錄成功但只顯示「已記錄」，沒有操作者／同步時間；跨帳號即時同步未完整驗證。 | 多人可能重複確認或無法追責，家庭交接缺少可見狀態。 | P1 | 建立 audit trail（誰、何時、動作、結果），成功後顯示同步時間；重登入／另一帳號驗證。 |
| P1-04 | 主要照護者新增神經內科回診後，卡片標題只剩「回診」。 | 需要重新開卡確認科別，增加看錯／漏看風險。 | P1 | 標題固定為「科別＋類型」，儲存後顯示可核對摘要。 |
| P1-05 | 照護圈把邀請、成員、通知、照護資料、提醒、費用與帳號排成長頁；長輩也看得到管理中心。 | 找不到重要設定；長輩資訊負擔過高。 | P1 | 分成「家庭與成員／提醒與通知／照護資料／費用與帳號」可收合區；長輩只保留家人聯絡卡與唯讀說明。 |
| P1-06 | 412 × 915 登入長 Email 越界，與密碼 label 重疊；底部固定導覽可能覆蓋內容。 | 測試帳號與小螢幕使用者難以登入／閱讀，誤觸機率提高。 | P1 | `min-width: 0; width: 100%`、欄位分列、safe-area 與底部 padding；加入 412px 視覺回歸。 |
| P1-07 | 首頁／長輩模式把「拍照新增」作為大 CTA；「今天要做什麼」與回診資訊其實是核心。 | 長輩會優先進入不該使用的新增流程。 | P1 | 長輩首頁重排為「今天用藥 → 今天行程 → 下一次回診」；新增功能移出或降為協作者。 |
| P2-01 | 「我已吃完」語意不明；可能代表單次、當日或療程結束。 | 家人對狀態定義不同，後續報表與提醒可能誤讀。 | P2（P0-02 修復後） | 改為「標記本次已服用」，顯示日期、時段、操作者，允許可控復原。 |
| P2-02 | 頂端重複顯示家庭／照護摘要；空時段有多張大型卡片。 | 長頁垂直空間被摘要與空狀態消耗。 | P2 | 摘要改一行可展開；空時段合併為簡短句。 |
| P2-03 | 未驗 OCR、LINE、billing、外站掛號、推播、弱網／離線、輔助科技與大字體。 | 不能把 reviewer flow 結果外推為完整產品可用性。 | P2／另案 | 建立整合 sandbox 與獨立測試資料，再安排受控 E2E；不使用真實醫療／付款資料。 |

## 4. 必須先釐清的疑點（不要直接當成已證實 bug）

1. **重複回診來源**：目前可能是測試 gate 重跑所建立的兩筆 fixture，也可能缺少資料庫／API 去重。先用新建的單一家庭、單一 appointment fixture 重跑「建立一次、重新登入、兩角色讀取」；依結果決定是否升為 P0。
2. **家庭提醒是否落庫**：目前已確認前端卡在 loading 且沒有回顯，尚未證明 API 寫入失敗。需用 network response、資料庫 read-back、協作者／長輩重新登入三點確認。
3. **首頁 401**：三份報告各記錄一次資源 401，但未定位 endpoint；需在不暴露 token 的前提下追查是否為可選資源、session refresh 或真正資料失敗。
4. **完成確認權限**：產品需決定長輩是否可寫入唯一的「服藥／完成確認」。若保留，建立明確白名單、二次確認、失敗回復與 audit；若不保留，前端移除按鈕並維持完整唯讀。
5. **費用規則**：確認 Internal/Test 是否只屬 staging badge、正式群組上限與計價規則的唯一數字，以及「目前已涵蓋／下期預估」的計算時間點。
6. **照護對象正式稱呼**：確認 care profile 的 canonical `display_name`、隱私遮罩規則與「親愛的家人」fallback 何時可使用。
7. **提醒／異動即時性**：確認是否承諾 realtime；若不是，介面應顯示最後同步時間，不應暗示已即時送達。

## 5. 建議優先序與階段出口

### Phase 0｜資料與驗證基線（1 個工作日）

- 固定單一乾淨 staging fixture 與三角色帳號；記錄 appointment／profile／group 的測試 ID，禁止 gate 重跑產生重複資料。
- 為 API response、前端 mutation、auth provider 與 UTF-8 加上可查但不含個資／secret 的結構化診斷欄位。
- 產出基線：三角色登入、家庭／長輩姓名、單一行程、單一藥單、提醒空白狀態與 412 × 915 截圖。

**出口**：同一 fixture 可重跑且結果可比；所有後續缺陷能區分「資料問題」與「UI／API 問題」。

### Phase 1｜P0 安全與身分信任（2–4 個工作日）

- `capabilities`／角色能力單一來源，長輩不渲染管理 mutation；API 仍維持 server-side deny。
- 所有 mutation 統一處理 401/403/4xx/逾時；禁止 optimistic success，特別覆蓋 `/api/medications/taken`。
- 完成 UTF-8 稽核與姓名顯示修復；首頁明示「正在查看：林清河｜僅可查看」或實際 canonical 稱呼。
- 家庭提醒加入 loading／success／error／timeout／retry，完成跨帳號 read-back。

**出口**：elder mutation control 可見數量為 0（若保留完成確認，僅 1 個白名單控制）；403 不改變畫面狀態；三個繁中姓名可在四頁正確顯示；提醒可證明落庫或明確失敗。

### Phase 2｜資料一致性與協作回饋（3–5 個工作日）

- 乾淨 fixture 追查並修正重複 appointment；加入 appointment ID 去重、相似資料提示與建立 idempotency key。
- 行程卡標題改為「科別＋類型」，新增後顯示摘要；服藥與提醒顯示操作者、時間、同步狀態。
- 建立 audit trail read-only 檢視，至少涵蓋行程、服藥、藥單、家庭提醒。

**出口**：重跑建立流程不產生重複；跨帳號重新登入仍看到同一筆狀態；每次重要異動可追到操作者與結果。

### Phase 3｜資訊架構、費用與手機可靠性（3–5 個工作日）

- 照護圈分區收合；長輩版只留下家人聯絡、協助者與唯讀說明。
- 首頁依「今天用藥 → 今天行程 → 下一次回診」重排，移除長輩新增 CTA。
- 計價由單一 SSOT 輸出；staging／production 文案與額度分流，關閉矛盾數字。
- 修正長 Email、safe-area、固定底導覽遮擋；加入 412px、字級 130%／150% 的回歸案例。

**出口**：手機主要流程無溢出／遮擋；長輩第一屏沒有管理噪音；費用頁每個環境只呈現一套可計算規則。

### Phase 4｜尚未驗證的整合（另案，完成前不宣稱完整可用）

- OCR/Gemini 使用獨立 staging key 與虛構文件；LINE 邀請／webhook 使用 sandbox；billing 只做測試交易；外站掛號與推播需明確 mock 或合約測試。
- 補弱網、離線、session refresh、螢幕閱讀器與真實 Android 大字體測試。

**出口**：每項整合都有成功、失敗、逾時與撤銷路徑；沒有把 production secret 或真實醫療／付款資料帶入測試。

## 6. 建議拆成的開發工作單

1. `P0` Role capability contract + elder read-only UI gate（依賴 Phase 0）。
2. `P0` Mutation error state／403 rollback／medication taken E2E。
3. `P0` UTF-8、canonical care profile display name 與三姓名 smoke test。
4. `P0` Family reminder persistence、timeout、retry、跨帳號 read-back。
5. `P1` Appointment idempotency、dedupe、clean-fixture migration／audit。
6. `P1` Provider label、內部測試模式與費用 SSOT。
7. `P1` Care Circle 分區與 elder today view。
8. `P1` Mobile login／safe-area／bottom-nav visual regression。
9. `P2` 操作者／同步時間／完成確認語意與可控復原。
10. `P2` OCR、LINE、billing、掛號、推播 sandbox E2E。

## 7. Definition of Done（下一階段共同驗收）

- 三角色在 fresh context 以 staging 安全入口登入；production hostname 上 reviewer flag 仍 fail closed。
- 長輩看不到管理 mutation；任何未授權寫入皆 403，UI 顯示失敗且不呈現假成功。
- 姓名、照護對象、家庭名稱完整以 UTF-8 顯示；四頁均可讀且無泛稱誤導。
- 單一乾淨 fixture 建立一次只出現一筆行程；提醒／服藥／行程的儲存狀態、操作者、時間可查。
- 主要／協作者／長輩各自完成至少一次 read/write／deny／reload 驗證；截圖與 JSON evidence 可回讀。
- 412 × 915、桌面、130%／150% 字級無文字溢出、底部遮擋或不可點擊控制。
- `/api/health` 未配置的可選整合仍明確 degraded，不得被誤報為完整 production readiness。
- 任何 rollback 只作用於 `care-wedo-staging`；不修改 production、`main` 或 production secrets。

## 8. 風險與回退

- UI role gate 若誤判，可先以 `elder_readonly_ui` feature flag 回退；後端 RBAC 不得回退。
- 去重不可直接刪歷史資料；先折疊／標記並保留 audit，再由產品決定合併策略。
- UTF-8 修復若涉及既有資料，先 read-only migration／備份與少量虛構資料驗證，避免批次改壞正式資料。
- 計價改動需讓 staging 只顯示測試模式，production 仍使用既有明確規則；未完成 billing 合約前不開啟扣款。
- 任一 P0 修復後必須重跑三角色 fresh-context 與 live evidence；不能只依單元測試宣稱完成。

## 9. 暫不納入本階段

不在本計劃直接部署 production、不重用 staging secret、不引入真實醫療個資／LINE／付款資料、不在角色／失敗回饋／編碼／資料一致性通過前擴充新功能。staging 目前可供受控審查，但最終報告的「不可視為 production-ready」判定維持有效。
