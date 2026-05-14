# Care WEDO 正式環境測試腳本

> 測試版本：V1.0 Beta Candidate  
> 測試站台：https://care.wedopr.com  
> 更新日期：2026-05-13  
> 測試原則：不要在測試紀錄中貼上 token、idToken、API key、service role key、醫療單據全文或完整個資。

## 目前已知 P0

- [ ] Cloudflare Pages production environment 需補上 `CRON_SECRET`。2026-05-13 smoke test 顯示 `/api/cron/reminders` 與 `/api/cron/evening` 回傳 `{"error":"CRON_SECRET is not configured."}`，代表 GitHub Actions 即使帶 secret 也無法成功觸發正式推播。
- [ ] 本機 root `.env` 有實際金鑰，已確認被 `.gitignore` 忽略，但正式上線前仍建議把可疑外流的 token/key 旋轉一次，並只保留在 Cloudflare/GitHub/Supabase/LINE 對應 Secrets 管理介面。

## Codex Smoke Test 紀錄（2026-05-13）

| 項目 | 結果 |
|---|---|
| `GET /api/health` | 200，`status: ok` |
| `GET /` | 200 |
| `GET /login` | 200 |
| `GET /app` | 200，SPA route 正常 |
| `GET /privacy` | 200 |
| `GET /terms` | 200 |
| `POST /api/groups` 無 Authorization | 401，`請先登入` |
| `POST /api/ocr/` 無 Authorization | 401，`請先登入` |
| `GET /api/me` invalid Bearer token | 401，`JWS format error` |
| `POST /api/cron/reminders` 無 Authorization | 500，`CRON_SECRET is not configured.` |
| `POST /api/cron/evening` 無 Authorization | 500，`CRON_SECRET is not configured.` |

## 0. 測試前檢查

| 項目 | 預期 | 結果 |
|---|---|---|
| LINE LIFF Endpoint URL | `https://care.wedopr.com/app` | [ ] |
| LINE Messaging API Webhook | `https://care.wedopr.com/callback` 且 Verify 成功 | [ ] |
| Cloudflare Secrets | `GOOGLE_API_KEY`、`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`LINE_CHANNEL_ACCESS_TOKEN`、`LINE_CHANNEL_SECRET`、`LINE_LOGIN_CHANNEL_ID`、`CRON_SECRET` 已存在 | [ ] |
| GitHub Actions Secrets | `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`CRON_SECRET` 已存在 | [ ] |

## 1. 公開頁與路由

| 步驟 | 預期 | 結果 |
|---|---|---|
| 開啟 `/` | 首頁正常顯示 | [ ] |
| 開啟 `/login` | LINE 登入按鈕正常顯示 | [ ] |
| 未登入開啟 `/app` | 導向或顯示登入流程，不可直接進入個人資料 | [ ] |
| 開啟 `/privacy` | 隱私政策正常顯示 | [ ] |
| 開啟 `/terms` | 服務條款與非醫療聲明正常顯示 | [ ] |
| 重新整理 `/app`、`/privacy`、`/terms` | 不出現 Cloudflare 404 或空白頁 | [ ] |

## 2. LINE LIFF 登入

| 裝置 | 步驟 | 預期 | 結果 |
|---|---|---|---|
| 桌機 Chrome | `/login` 點 LINE 登入 | 授權後回到 `/app` | [ ] |
| iOS LINE 內建瀏覽器 | 開啟 `/app` | 可登入並進入今日照護 | [ ] |
| Android LINE 內建瀏覽器 | 開啟 `/app` | 可登入並進入今日照護 | [ ] |
| 任一裝置 | 點登出後重新整理 | 不再看到個人照護資料 | [ ] |

## 3. 家庭群組與照護對象

| 步驟 | 預期 | 結果 |
|---|---|---|
| 使用者 A 建立家庭群組 | 取得邀請碼 | [ ] |
| 使用者 A 新增照護對象 | Dashboard 可切換/顯示該照護對象 | [ ] |
| 使用者 B 用邀請碼加入 | B 可看到同一照護對象 | [ ] |
| admin 移除 member | member 無法再看到該群組資料 | [ ] |
| 重新產生邀請碼 | 舊邀請碼失效 | [ ] |

## 4. LINE Bot OCR 閉環

請至少用 5 張不同樣式的台灣醫療文件測試，避免只測同一家醫院。

| 步驟 | 預期 | 結果 |
|---|---|---|
| 長輩 LINE 帳號加 Bot 好友 | 可傳送圖片 | [ ] |
| 傳送門診單或藥袋照片 | Bot 30 秒內回覆解析摘要 | [ ] |
| 多照護對象情境 | Bot 顯示 Quick Reply 選擇「這筆資料屬於誰」 | [ ] |
| 點選照護對象 | Bot 回覆更新成功，資料歸屬正確 | [ ] |
| 打開 `/app` | 待確認 OCR 結果可查看 | [ ] |
| 點「正確，存起來」 | 資料進入正式看診/吃藥提醒 | [ ] |
| 點「有錯，我要改」 | 可修正後再保存 | [ ] |

## 5. 今日照護與資料持久化

| 步驟 | 預期 | 結果 |
|---|---|---|
| 今日有吃藥項目時點「我吃了」 | 狀態更新 | [ ] |
| 重新整理頁面 | 狀態仍維持已確認 | [ ] |
| 今日有看診項目時點「我已看診」 | 狀態更新 | [ ] |
| 切換照護對象 | 不顯示上一位照護對象的舊資料 | [ ] |
| 點「我忘記有沒有吃」 | 顯示不要重複吃藥的安全提示 | [ ] |

## 6. Cron 推播

| 步驟 | 預期 | 結果 |
|---|---|---|
| 手動執行 Daily Medical Reminders workflow | 目標 LINE 收到早安健康簡報 | [ ] |
| 手動執行 Evening Fasting Reminders workflow | 目標 LINE 收到晚安空腹提醒 | [ ] |
| 連續觀察 7 天 | 08:00 與 20:00 台灣時間排程無漏送 | [ ] |

## 7. 安全 Smoke Test

| 測試 | 預期 | 結果 |
|---|---|---|
| 無 Authorization 呼叫 `POST /api/groups` | 401 | [ ] |
| 無 Authorization 呼叫 `POST /api/ocr/` | 401 | [ ] |
| 錯誤 Bearer token 呼叫 protected API | 401 | [ ] |
| 無 Authorization 呼叫 cron endpoint | 401 或 500 fail-closed，不可執行推播 | [ ] |
| 跨家庭嘗試操作別人的資料 | 403 或 404 | [ ] |

## 8. Beta 放行門檻

- [ ] 流程 1–7 無 P0/P1 阻斷問題。
- [ ] OCR 5 張真實文件中至少 4 張可透過確認/校正流程完成。
- [ ] iOS 與 Android LINE 內建瀏覽器都能登入並完成至少一項照護操作。
- [ ] 沒有跨家庭資料外洩。
- [ ] Cloudflare/GitHub Actions logs 沒有連續性 5xx。

## 9. 問題回報格式

```txt
時間：
裝置/瀏覽器：
帳號角色：長輩 / 家人 admin / 家人 member
操作步驟：
預期結果：
實際結果：
截圖或錄影：
是否包含個資：是 / 否
嚴重度：P0 / P1 / P2 / P3
```
