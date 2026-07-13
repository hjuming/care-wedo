# Care WEDO staging 最終 fresh-context 驗收

日期：2026-07-14（Asia/Taipei）  
總判定：**可交付三位外部審查員作受控 staging 測試；不可視為 production-ready。**

## 驗收結論

- 環境隔離成立：Supabase 控制面可見獨立 `care-wedo-staging`（ref `minnckpmjwdfvltagbru`、東京區、`ACTIVE_HEALTHY`），live UI 位於獨立 `care-wedo-staging.pages.dev`；證據未指向 Care production 或 Signal staging。
- 三角色能力成立：primary 實際由 UI 建立行程；collaborator 實際記錄服藥；elder 對服藥确认 POST 與行程 PATCH 均收到 403。這組 live 行為與既定 fixture 對應 `primary: admin/can_manage=true`、`collaborator: member/can_manage=true`、`elder: member/can_manage=false`。本輪未另讀 secret，也未以 SQL 回讀 membership row。
- 核心協作成立：主要照護者新增的 2026/08/20 虛構回診可在共同家庭中呈現；協作者服藥紀錄成功；長輩可讀共同資料但後端拒絕共享資料寫入。
- 測試入口採正常 Supabase Email/Password session，須 build flag 與精確 staging hostname 同時成立；程式與測試證據顯示 production hostname fail closed。限時本輪未取得 live production curl 回應，故 production「實站不顯示」仍以靜態 gate／測試證據驗收，不宣稱新增一次瀏覽器實測。
- `/api/health` 為 degraded；OCR／Gemini、LINE、billing 等非本次 reviewer flow 的外部配置未齊或未驗，不阻斷三角色核心 staging 測試，但不得據此宣稱完整整合可用。

## 產品 P0（不是部署失敗）

- 長輩畫面仍渲染編輯／管理控制；用藥 POST 被 403 後 UI 無錯誤且一度顯示已記錄，可能造成照護誤判。
- 中文姓名 mojibake、重複回診卡、家庭提醒停在「儲存中」、費用／人數上限矛盾，均應在對外正式開放前修正。
- 上述缺陷不否定 staging target、登入、共用家庭與後端 RBAC 已可供受控研究；它們阻擋的是 production-ready 判定。

## Rollback

1. 將 reviewer login flag 關閉並只重建／重部署 `care-wedo-staging`，使入口 fail closed。
2. 將 Pages alias 切回上一個綠色 deployment，再刪除本次 staging deployment；不得操作 `care-wedo` 或 `main`。
3. 依保存的 staging Auth UUID／family group id 精確撤銷三帳號與虛構 fixture；刪除前再次確認 ref 為 `minnckpmjwdfvltagbru`。
4. 刪除整個雲端 project 屬高風險破壞操作，需另次明確確認。

## 完成回報

- **已完成**：指定報告與 live JSON read-back、Supabase staging target 唯讀控制面確認、三角色 live UI/API 證據與隔離／rollback 判定。
- **未完成／未處理**：未以 SQL 另行回讀 membership rows；未完成 live production curl／Pages list 輸出複驗；未驗 OCR、LINE、billing、外站掛號與真實通知。
- **自行追加**：把 P0 體驗缺陷與部署可用性拆開判定，避免把「可受控測試」誤寫成 production-ready。
- **驗證結果與證據**：Supabase staging 為 `ACTIVE_HEALTHY`；primary `created=true`；collaborator `medicationRecorded=true`；elder 兩個 mutation 分別回 403；三份 2026-07-14 live persona 報告均有同一 staging 家庭與手機 UI 證據。
- **剩餘風險**：elder 用藥拒絕後錯誤成功感、姓名亂碼、重複排程與提醒無完成回饋具有照護安全風險；正式上線前必須修正並重跑 E2E。
