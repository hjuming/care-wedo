# Care WEDO V1.1 開發施作執行計劃

> 建立日期：2026-05-06  
> 版本目標：把 V1.0 Beta 從「醫療資料 Dashboard」改成「長輩看的今日照護提醒，家人看的安心協作系統」。  
> 產品原則：長輩端減法，家人端補協作，管理端收進進階功能。
> 2026-05-06 方針修正：登入後台不是行銷頁。刪除長輩不需要看的資訊與行銷術語，只保留長輩與協作照護者每天會用到的畫面、卡片、按鈕。

## 一句話方向

Care WEDO V1.1 不再把長輩丟進資料管理介面，而是每天回答三件事：

1. 今天要做什麼？
2. 現在要注意什麼？
3. 看不懂時誰會幫我？

## 本版不做什麼

- 不把更多管理功能塞到長輩首頁。
- 不讓 OCR 結果未確認就進正式照護紀錄。
- 不把月曆當長輩主流程；長輩看「下一次看診」，家人看「完整月曆」。
- 不用 `Dashboard`、`OCR`、`profile`、`group` 這類工程語言作為主要介面文案。
- 登入後台不顯示行銷標語、功能介紹、方案賣點、品牌口號。
- 長輩模式底部只留四個入口：`今日照護 / 拍照上傳 / 吃藥 / 家人`。

## 目標使用者切分

| 模式 | 對象 | 主要問題 | V1.1 介面答案 |
|---|---|---|---|
| 長輩模式 | 本人、視力差、怕按錯者 | 我今天要做什麼？ | 今日照護時間軸、一鍵完成、一鍵問家人 |
| 家人模式 | 子女、配偶、主要照護者 | 今天需不需要介入？ | 今日狀態摘要、待確認、紅黃綠警示 |
| 管理模式 | 主要照護者、客服、測試者 | 資料怎麼修？ | 編輯、刪除、日期篩選、OCR 原始資料、照護對象管理 |

## Sprint 1：今日照護首頁重構

**目標**：手機進入 `/app` 第一屏只顯示今天日期、今日任務、下一次吃藥、問家人。

| 任務 | 施作檔案 | 做法 | 驗收 |
|---|---|---|---|
| 1-A 建立今日任務聚合器 | `care-wedo-app/src/App.jsx` 或新增 `care-wedo-app/src/services/todayTasks.js` | 從 `appointments`、`medications`、`checklist` 產生 `todayTasks`，統一欄位：`id,type,title,time,subtitle,detail,status,primaryActionLabel`。 | 單元測試能把看診、領藥、吃藥排序成上午／中午／晚上／睡前。 |
| 1-B 重寫 `OverviewView` | `care-wedo-app/src/App.jsx` | 移除首頁六宮格、過多摘要卡、搜尋欄與登入後 Hero；改為 `照護對象 + 日期星期 + 今日件數 + 今日任務時間軸 + 問家人`。 | 手機 390px 截圖中，第一屏看得到照護對象、日期、今日件數與至少 1 件今日任務。 |
| 1-C 主按鈕改長輩語言 | `care-wedo-app/src/App.jsx` | 看診：`我已看診`；領藥：`我已領藥`；吃藥：`我吃了`；檢查：`我已完成`。 | 主要流程不再出現單獨的「完成」作為長輩主按鈕。 |
| 1-D 空狀態改成安全感文案 | `care-wedo-app/src/App.jsx` | 今天無看診顯示「今天沒有看診，記得按時吃藥」。完全無資料顯示「還沒有照護事項，可以先拍照上傳」。 | 無資料時不留空白，不讓使用者誤以為系統壞掉。 |

## Sprint 2：頭像階層辨識與聯絡

**目標**：不再用「正在照護、我的身分、家人可查看」這類解釋文字；改用頭像大小與位置讓使用者自然理解這是誰的照護頁、可以問誰、以及如何找 Care WEDO 照護小管家。

| 任務 | 施作檔案 | 做法 | 驗收 |
|---|---|---|---|
| 2-A 新增照護關係頭像 | `care-wedo-app/src/App.jsx`、`index.css` | 上方最大頭像只代表照護對象；右側小頭像代表協作照護者；右下或右側固定入口代表照護小管家。不要在首頁顯示「我的身分」等說明文字。 | 第一眼可看出這是誰的照護頁、可以問誰、小管家在哪裡。 |
| 2-B 頭像可聯絡 | `care-wedo-app/src/App.jsx` | 點協同者頭像先出確認 Sheet，再產生 LINE 求助訊息；不要求長輩打字。 | 點小頭像即可問家人，且不會誤觸直接撥打。 |
| 2-C 後端補 group members | `functions/api/dashboard.ts`、`functions/_shared/supabase.ts` | Dashboard API 回傳家庭群組成員頭像、名稱、角色、通知狀態。 | 前端小頭像可以換成真實協同者清單。 |
| 2-D Profile switcher 文案降噪 | `care-wedo-app/src/App.jsx` | 長輩首頁不顯示 profile/group/admin 等術語；管理功能收進照護圈頁。 | 使用者不再分不清「LINE 用戶」和「照護對象」。 |

## Sprint 3：OCR 從自動寫入改成確認式流程

**目標**：避免 OCR 錯誤直接成為醫療提醒，降低醫療風險。

| 任務 | 施作檔案 | 做法 | 驗收 |
|---|---|---|---|
| 3-A 新增 pending document 狀態 | `supabase/schema.sql`、新增 migration | `care_documents.status` 使用 `pending_review / confirmed / discarded`；appointments / medications 先可關聯但不進正式列表，或先只存 parsed payload。 | OCR 完成但未確認時，`/dashboard` 不顯示正式提醒。 |
| 3-B 新增 confirm API | 新增 `functions/api/ocr/confirm.ts` 或整合現有 OCR route | 使用者按「正確，存起來」後才建立或啟用 appointments / medications。 | 未 confirm 不會出現在今日照護、看診、吃藥說明。 |
| 3-C 重寫 `OcrResult` 三選一操作 | `care-wedo-app/src/components/OcrResult.jsx` | 主要按鈕：`正確，存起來`、`有錯，我要修改`、`我看不懂，問家人`。 | OCR 結果頁不再像表單工具，先問「我幫你看出這些內容，對嗎？」。 |
| 3-D 校正後仍可再改 | `OcrResult.jsx`、PATCH API | 儲存後顯示「修改這筆」、「這筆不要了」、「我已完成」。 | 使用者儲存後仍能修正日期、內容、刪除或標記完成。 |

## Sprint 4：吃藥說明與忘記確認

**目標**：每天高頻使用，先於月曆管理完成。長輩要知道現在吃什麼、吃幾顆、飯前飯後，以及忘記是否吃過時不能重複吃。

| 任務 | 施作檔案 | 做法 | 驗收 |
|---|---|---|---|
| 4-A 導覽改名 | `care-wedo-app/src/App.jsx` | `吃藥提醒` 改為 `吃藥說明`，mobile label 用 `吃藥`。 | 導覽與標題不再出現「用藥」或「medication」式距離感。 |
| 4-B medication schema 補排程欄位 | `supabase/schema.sql`、migration、`functions/_shared/supabase.ts` | 新增 `time_slot`、`meal_timing`、`scheduled_time`、`taken_status` 或建立 `medication_schedules`。 | 可表示早餐後、午餐後、晚餐後、睡前。 |
| 4-C `MedicationView` 分時段 | `care-wedo-app/src/App.jsx` | 依早／中／晚／睡前分組，卡片優先顯示「時間、飯前飯後、份量」，藥名第二順位。 | 長輩可直接回答「現在要吃哪幾顆」。 |
| 4-D 吃藥狀態確認 | 新增 API 或沿用 medication schedule API | 按 `我吃了` 後記錄日期、時段、確認者。 | 家人端能看到今天哪一餐藥已確認、哪一餐未確認。 |
| 4-E 忘記有沒有吃 | `OverviewView`、`MedicationView` | 加入 `我忘記有沒有吃`，提示「請先不要重複吃藥，請查看藥盒或問家人」。 | 避免重複用藥風險。 |

## Sprint 5：陪診卡提前

**目標**：每週跑醫院者剛需。看診當天首頁第一屏直接變成陪診卡，而不是先進月曆。

| 任務 | 施作檔案 | 做法 | 驗收 |
|---|---|---|---|
| 5-A 今日看診升級陪診卡 | `OverviewView` | 今天有看診時顯示：醫院、科別、時間、記得帶、導航、打給家人、我已到醫院。 | 看診當天首頁第一屏就是陪診卡。 |
| 5-B 應帶物品解析 | OCR parsing prompt / `medical_ocr.ts` | 從 reminder_text / notes 抽出健保卡、慢箋、抽血單、檢查單等 checklist。 | 看診卡能列出「記得帶」。 |
| 5-C 一鍵聯絡家人 | `OverviewView` | 陪診卡上的家人頭像或按鈕直接產生 LINE 訊息。 | 長輩不用打字即可通知家人。 |
| 5-D 到院狀態 | appointment status 或新 log | `我已到醫院` 與 `我已看診` 分開記錄。 | 家人端能知道是已到院還是已看完。 |

## Sprint 6：家人端今日摘要與照護警示

**目標**：家人不只是看資料，而是知道今天要不要介入。

| 任務 | 施作檔案 | 做法 | 驗收 |
|---|---|---|---|
| 6-A 新增家人摘要區 | `care-wedo-app/src/App.jsx` 的 `SettingsView` 或新增 `FamilySummaryView` | 顯示 `爸爸今天狀態`：已吃、未確認、明日看診、待確認照片。 | 家人不用進每個分頁也知道今天狀態。 |
| 6-B 紅黃綠警示 | 前端聚合器 | 綠：全正常；黃：有未確認；紅：今天看診/空腹/用藥高風險未處理。 | Dashboard 顯示一眼可懂的照護燈號。 |
| 6-C 每日摘要推播草稿 | `functions/callback.ts` 或 cron job | 先產生 LINE 訊息文案與 API 結構，後續接排程。 | 可輸出「爸爸今天照護摘要」訊息。 |
| 6-D 一鍵問家人 | 前端 + LINE share / LIFF | 按鈕產生固定訊息，不要求長輩打字。 | 點擊後可把目前任務內容分享到家庭 LINE 群組或開啟 LINE 分享。 |

## Sprint 7：看診月曆與管理清單

**目標**：給家人和主要照護者管理完整行程，不作為長輩主流程。

| 任務 | 施作檔案 | 做法 | 驗收 |
|---|---|---|---|
| 7-A 日期點擊改為篩選 | `care-wedo-app/src/App.jsx` 的 `CalendarView` | 新增 `selectedDate`，點日期後只顯示該日期資料，提供 `看全部`。 | 點 5/14 只看到 5/14 卡片；點看全部恢復完整列表。 |
| 7-B 加入快捷篩選 | `CalendarView` | 篩選按鈕：`全部`、`看診`、`領藥`、`檢查`、`未排日期`。 | 不靠搜尋框也能找到無日期或領藥資料。 |
| 7-C 卡片折疊資訊 | `CalendarView` | 卡片預設只顯示日期、時間、醫院、科別、主提醒；詳細 notes 收到展開區。 | 長 notes 不會把手機列表撐到難以掃描。 |
| 7-D 卡片操作列 | `CalendarView`、`services/api.js` | 每張卡提供 `我已看診 / 修改 / 這筆不要了 / 問家人`。 | 可完成、可改日期內容、可軟刪除。 |
| 7-E 後端支援軟刪除 | `functions/api/appointments/[id].ts`、`functions/_shared/supabase.ts` | appointment 使用 `status=deleted`；Dashboard 預設排除 deleted。 | 刪除後重整頁面不再出現，但 DB 保留稽核。 |

## Sprint 8：可用性、無障礙與驗證

**目標**：V1.1 必須用真實高齡情境驗收，而不是只通過工程測試。

| 任務 | 施作檔案 | 做法 | 驗收 |
|---|---|---|---|
| 8-A 行動版視覺檢查 | `care-wedo-app/src/index.css` | 390px 寬度下，字體不小於 18px，主要按鈕高度不小於 56px，卡片不互相遮擋。 | Playwright 或 Chrome 截圖檢查手機版。 |
| 8-B 回歸測試 | `care-wedo-app/src/*.test.js` | 新增 today task、calendar filter、profile banner、OCR pending/confirm 測試。 | `npm test` 通過。 |
| 8-C Build / lint | `care-wedo-app` | 跑 `npm run build`、`npm run lint`。 | 無 build error；lint 無新增錯誤。 |
| 8-D 長輩實測腳本 | 專案文件 | 以 78 歲使用者執行：打開首頁、找今天任務、標記吃藥、問家人、看下一次看診、上傳藥袋。 | 5 分鐘內完成，不需開發者旁白。 |
| 8-E 家人實測腳本 | 專案文件 | 子女執行：切照護對象、看今日摘要、修正 OCR、刪除錯資料、確認用藥狀態。 | 家人能判斷今天是否需要介入。 |

## 資料模型建議

### appointments

現有欄位可沿用，新增或規範：

| 欄位 | 用途 |
|---|---|
| `status` | `upcoming / completed / deleted / pending_review` |
| `type` | `clinic_visit / refill_reminder / inspection` |
| `source_document_id` | 追溯 OCR 來源 |

### medications

現有欄位不足以支援「早中晚睡前」，建議新增：

| 欄位 | 用途 |
|---|---|
| `meal_timing` | `before_meal / after_meal / with_meal / bedtime / as_needed` |
| `time_slot` | `morning / noon / evening / bedtime` |
| `scheduled_time` | 預設提醒時間，例如 `09:30` |
| `source_document_id` | 追溯藥袋或處方來源 |

若要更乾淨，建立 `medication_schedules`：

```sql
create table public.medication_schedules (
  id bigserial primary key,
  medication_id bigint references public.medications(id) on delete cascade,
  profile_id bigint references public.care_profiles(id) on delete set null,
  time_slot text not null,
  meal_timing text,
  scheduled_time text,
  dosage text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
```

### medication_logs

用來記錄今天是否吃藥：

```sql
create table public.medication_logs (
  id bigserial primary key,
  medication_id bigint references public.medications(id) on delete cascade,
  profile_id bigint references public.care_profiles(id) on delete set null,
  taken_date date not null,
  time_slot text not null,
  status text not null default 'taken',
  confirmed_by_user_id bigint references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
```

## 介面文案替換表

| 不要用 | 改成 |
|---|---|
| Dashboard | 今日照護 |
| OCR 辨識 | 幫你看照片 |
| profile | 照護對象 |
| group | 照護圈 |
| appointment | 看診 |
| medication | 吃藥 |
| 完成 | 我吃了／我已看診／我已領藥 |
| 儲存成功 | 已經幫你記好了 |
| 修改內容 | 有錯，我要改 |
| 刪除 | 這筆不要了 |

## V1.1 完成定義

- [ ] 長輩首頁第一屏只回答今天要做什麼，不再像 Dashboard。
- [ ] 每個主要任務只有一個主行動，且文案是長輩語言。
- [ ] 登入後台不出現行銷標語、功能賣點或非照護任務資訊。
- [ ] 390px 手機首屏不得出現登入後行銷 Hero。
- [ ] 390px 手機首屏不得出現搜尋欄。
- [ ] 390px 手機首屏必須看到照護對象、日期、今日件數與至少一張今日任務卡。
- [ ] 手機底部只留 `今日照護 / 拍照上傳 / 吃藥 / 家人` 四個入口。
- [ ] 頭像階層可看出照護對象、協作照護者與照護小管家，不依賴「正在照護／我的身分／家人可查看」說明文字。
- [ ] OCR 未確認前不進正式照護提醒。
- [ ] 看診日曆可點日期篩選、可修改、可完成、可軟刪除。
- [ ] 吃藥頁以時段與飯前飯後為主，不以藥名資料卡為主。
- [ ] 家人端能看到今日摘要與紅黃綠警示。
- [ ] 手機 390px 截圖沒有文字遮擋、底部導覽不遮住主要任務。
- [ ] `npm test`、`npm run build` 通過。
- [ ] 至少 1 位 70 歲以上使用者完成實測腳本，不需旁人解釋。

## 建議執行順序

1. Sprint 1 + Sprint 2 先做，因為這直接解決「看不懂首頁」與「不知道在看誰」。
2. Sprint 3 接著做，因為 OCR 自動寫入正式醫療提醒有風險。
3. Sprint 4 先於月曆，因為吃藥是每日高頻、且有重複用藥風險。
4. Sprint 5 陪診卡提前，因為每週跑醫院者比月曆更需要當日陪診指引。
5. Sprint 6 在今日任務資料模型穩定後做，避免摘要邏輯重寫。
6. Sprint 7 才做月曆與進階管理，定位給家人和主要照護者。
7. Sprint 8 永遠最後做，且不能省略真實長輩測試。
