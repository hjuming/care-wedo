# Care WEDO 後台系統重構技術設計文件 v1.0

> **建立日期**：2026-05-05  
> **狀態**：Phase 0 盤點完成，待 Phase 1 執行  
> **重構目標**：穩定帳號、家庭空間、照護對象、資料歸屬、使用額度的系統邏輯  

---

## 一、現有 Schema 對照表

### 1.1 現有資料表（實際）

| 資料表 | 對應新概念 | 缺少什麼 |
|---|---|---|
| `users` | → `accounts` | 缺 `picture_url`, `email`, `provider` |
| `family_groups` | → `workspaces` | 缺 `owner_user_id`, `plan` 欄位 |
| `user_family_groups` | → `workspace_members` | role 只有 `member`，缺 `owner/admin/caregiver/viewer` 區分 |
| `care_profiles` | → `care_recipients` | 缺 `birth_date`, `gender`；`primary_user_id` 語意不清 |
| `appointments` | 保留 | 有 `user_id` + `group_id` + `profile_id`，但三個不一定同時填 |
| `medications` | 保留 | 同上 |
| ❌ 無 | `care_documents` | 完全缺少，OCR 結果直接存入 appointments/medications |
| ❌ 無 | `ocr_jobs` | 完全缺少，無法追蹤 OCR 處理狀態 |
| ❌ 無 | `usage_quotas` | 完全缺少，目前用 query count 取代 |
| ❌ 無 | `tasks` | 完全缺少 |

### 1.2 現有 RLS 狀態

所有資料表已 `enable row level security`，但**後端統一使用 `SUPABASE_SERVICE_ROLE_KEY`（特權模式）繞過 RLS**。

實際授權邏輯由 Cloudflare Functions 的查詢條件負責，不依賴 RLS。

```
supabase/schema.sql:126-131 — RLS enabled on all tables
functions/_shared/supabase.ts:95-120 — supabaseFetch 帶 service_role_key
```

---

## 二、Bug 根因診斷

### Bug 1：登入日月MING，畫面顯示洪爸爸資料

**根本原因**：`DEFAULT_USER` 機制

```typescript
// functions/_shared/supabase.ts:12-15
const DEFAULT_USER = {
  line_user_id: "web-mvp",
  name: "Care WEDO MVP",
};

// functions/_shared/supabase.ts:152-154
export async function getOrCreateDefaultUser(env: Env, lineUserId?: string): Promise<number> {
  const targetLineId = lineUserId || DEFAULT_USER.line_user_id;  // ← 問題核心
```

**觸發路徑**：
1. `GET /api/dashboard` 在 `isPublicPath` 中設為公開路由（不需 JWT）
2. 無有效 JWT 時，`token = null` → `identity = null`
3. 呼叫 `getOrCreateDefaultUser(env, undefined)` → 使用 `"web-mvp"` 這個共用帳號
4. 回傳 `web-mvp` 帳號的所有 `care_profiles`、`appointments`、`medications`
5. 洪爸爸的資料是在 `web-mvp` 帳號下建立的測試資料，任何人的 demo 請求都會看到

**後果**：任何尚未登入或 token 過期的用戶，都會看到 `web-mvp` 帳號的洪爸爸資料。

---

### Bug 2：正式部署出現「現在是測試畫面」

**根本原因**：Demo mode 判斷來自 API 回傳的 `mode: "demo"`，而非環境變數

```typescript
// functions/api/dashboard.ts
mode: identity ? "personal" : "demo",
```

**觸發路徑**：
1. LINE LIFF 初始化比 React 渲染慢（非同步）
2. `boot()` 尚未完成 → identity 還是 null → dashboard 請求無 JWT
3. API 回傳 `mode: "demo"` → 前端顯示「現在是測試畫面」
4. 即使後來 identity 取得成功，若快取沒更新，仍顯示舊畫面

**前端觸發路徑（另一條）**：
```typescript
// care-wedo-app/src/App.jsx
} catch (err) {
  if (import.meta.env.PROD) { ... return; }
  setIdentity({ status: "demo", ... });  // ← 非 PROD 環境 boot 例外 → demo 模式
```
正式環境若 LIFF_ID 設定有問題 → LIFF init 拋出例外 → PROD 判斷外的分支 → demo 模式

---

### Bug 3：重登後照護資料消失，但家庭群組與頭像還在

**根本原因**：資料表之間 scope 不一致

```typescript
// 家庭群組：從 user_family_groups 查，有 userId
// 照護對象：從 care_profiles 查，透過 group_id 篩選 ✓
// 醫療紀錄：appointments/medications 帶 user_id + group_id + profile_id
```

**問題**：`appointments` 和 `medications` 的 `user_id` 欄位存的是**上傳者**的 user id。

若「日月MING（上傳者）」與「web-mvp（預設帳號）」是不同的 userId，重登後帶新 userId 查詢，就找不到舊紀錄。

```sql
-- 查詢邏輯（從 supabase.ts getMonthlyOcrUsage）
appointments?user_id=eq.${userId}  ← 只用 user_id 篩選，無 group_id 保護
```

`care_profiles` 查詢用 `group_id` → 正確，有群組就有照護對象。  
`appointments` 查詢用 `user_id` → 危險，換帳號就失去資料。

---

### Bug 4：上傳顯示未登入 / 額度已滿

**根本原因 A**：LIFF token 過期後無自動 refresh 機制

`idToken expired` 這個錯誤（你在家人設定頁看到的）來自 LINE LIFF。LIFF 的 ID Token 效期約 1 小時，但前端目前沒有 token 過期偵測與重新取得的流程。

**根本原因 B**：額度計算用 `appointments + medications` 筆數，但不精準

```typescript
// functions/_shared/supabase.ts:467-481
export async function getMonthlyOcrUsage(env: Env, userId: number): Promise<number> {
  const apts = await supabaseFetch(env, `appointments?user_id=eq.${userId}&created_at=gte.${startOfMonth}&select=id`);
  const meds = await supabaseFetch(env, `medications?user_id=eq.${userId}&created_at=gte.${startOfMonth}&select=id`);
  return apts.length + meds.length;  // 每筆藥品 = 1 次，不是每次 OCR = 1 次
}
```

一次 OCR 可能建立 5 筆 medications → 顯示已用 5 次（實際只上傳 1 張）。  
如果 `web-mvp` 帳號的測試資料累積了很多筆，新用戶看到的 demo 額度就是已滿狀態。

**根本原因 C**：額度綁 `userId`（個人），不是 `group_id`（家庭）

一個家庭有 3 個照護者，每人各自計 10 次 → 家庭實際可用 30 次，但設計意圖是 10 次。

---

## 三、新資料模型設計

以現有表為基礎，最小化 migration 幅度。

### 3.1 命名對照

| 現有 | 重構後 | 說明 |
|---|---|---|
| `users` | `users`（保留，補欄位） | 加 `picture_url`, `email` |
| `family_groups` | `family_groups`（保留，補欄位） | 加 `owner_user_id` |
| `user_family_groups` | `user_family_groups`（保留，補欄位） | `role` 值擴充 |
| `care_profiles` | `care_profiles`（保留，補欄位） | 加 `birth_date`, `gender` |
| 無 | `care_documents`（新增） | OCR 原始文件 |
| 無 | `ocr_jobs`（新增） | OCR 處理追蹤 |
| 無 | `usage_quotas`（新增） | 額度，改綁 group_id |
| `appointments` | `appointments`（補欄位） | 加 `document_id` |
| `medications` | `medications`（補欄位） | 加 `document_id` |

---

### 3.2 Migration SQL

#### Phase 1-A：補現有表欄位

```sql
-- users 補欄位
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS picture_url text,
  ADD COLUMN IF NOT EXISTS email text;

-- family_groups 補 owner（辨識誰建立群組）
ALTER TABLE public.family_groups
  ADD COLUMN IF NOT EXISTS owner_user_id bigint REFERENCES public.users(id) ON DELETE SET NULL;

-- 補目前 owner：用 care_profiles.primary_user_id 反查
UPDATE public.family_groups fg
SET owner_user_id = (
  SELECT cp.primary_user_id
  FROM care_profiles cp
  WHERE cp.group_id = fg.id AND cp.primary_user_id IS NOT NULL
  LIMIT 1
)
WHERE fg.owner_user_id IS NULL;

-- care_profiles 補欄位
ALTER TABLE public.care_profiles
  ADD COLUMN IF NOT EXISTS birth_date date,
  ADD COLUMN IF NOT EXISTS gender text;

-- user_family_groups 補 status
ALTER TABLE public.user_family_groups
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
```

#### Phase 1-B：新增 care_documents 表

```sql
CREATE TABLE IF NOT EXISTS public.care_documents (
  id bigserial PRIMARY KEY,
  group_id bigint NOT NULL REFERENCES public.family_groups(id) ON DELETE CASCADE,
  profile_id bigint REFERENCES public.care_profiles(id) ON DELETE SET NULL,
  uploaded_by_user_id bigint REFERENCES public.users(id) ON DELETE SET NULL,
  document_type text NOT NULL DEFAULT 'other',
  -- appointment_slip / prescription / lab_order / imaging_order / medication_bag / other
  source_file_url text,
  ocr_text text,
  ai_summary jsonb,
  status text NOT NULL DEFAULT 'uploaded',
  -- uploaded / processing / draft / confirmed / failed
  captured_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.care_documents ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS care_documents_group_profile_idx
  ON public.care_documents (group_id, profile_id, created_at DESC);
```

#### Phase 1-C：新增 ocr_jobs 表

```sql
CREATE TABLE IF NOT EXISTS public.ocr_jobs (
  id bigserial PRIMARY KEY,
  group_id bigint NOT NULL REFERENCES public.family_groups(id) ON DELETE CASCADE,
  document_id bigint REFERENCES public.care_documents(id) ON DELETE SET NULL,
  uploaded_by_user_id bigint REFERENCES public.users(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'gemini',
  status text NOT NULL DEFAULT 'queued',
  -- queued / processing / completed / failed
  raw_result jsonb,
  extracted_result jsonb,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ocr_jobs ENABLE ROW LEVEL SECURITY;
```

#### Phase 1-D：新增 usage_quotas 表（改綁 group_id）

```sql
CREATE TABLE IF NOT EXISTS public.usage_quotas (
  id bigserial PRIMARY KEY,
  group_id bigint NOT NULL REFERENCES public.family_groups(id) ON DELETE CASCADE,
  period text NOT NULL,  -- 'YYYY-MM' 格式，例如 '2026-05'
  feature text NOT NULL DEFAULT 'ocr_upload',
  used_count integer NOT NULL DEFAULT 0,
  limit_count integer NOT NULL DEFAULT 10,
  plan_snapshot text NOT NULL DEFAULT 'free',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(group_id, period, feature)
);

ALTER TABLE public.usage_quotas ENABLE ROW LEVEL SECURITY;
```

#### Phase 1-E：appointments / medications 加 document_id

```sql
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS document_id bigint REFERENCES public.care_documents(id) ON DELETE SET NULL;

ALTER TABLE public.medications
  ADD COLUMN IF NOT EXISTS document_id bigint REFERENCES public.care_documents(id) ON DELETE SET NULL;
```

---

## 四、Bug 修復方案

### Fix 1：移除 DEFAULT_USER 污染

**原則**：`GET /api/dashboard` 無有效 JWT 時，直接回傳空的 demo shell，不查任何真實資料。

```typescript
// functions/api/dashboard.ts 修改後邏輯
if (!identity) {
  return Response.json({
    mode: "demo",
    plan: "free",
    ocr_used: 0,
    ocr_limit: 10,
    active_profile_id: null,
    care_profiles: [],
    // demo_data 只給靜態假資料，不從 DB 查
    appointments: DEMO_APPOINTMENTS,
    medications: DEMO_MEDICATIONS,
  });
}
// identity 存在才查真實資料
const userId = await getOrCreateUser(env, identity.lineUserId);
```

**同步移除**：`getOrCreateDefaultUser` 不再接受 `undefined` lineUserId，改成直接 throw：

```typescript
export async function getOrCreateUser(env: Env, lineUserId: string): Promise<number> {
  // 不再有 DEFAULT_USER fallback
  if (!lineUserId) throw new Error("lineUserId is required");
  // ...
}
```

---

### Fix 2：Demo mode 只從環境變數決定，不從 API mode 決定

```typescript
// care-wedo-app/src/App.jsx
// 前端不再用 dashboard.mode === "demo" 決定是否顯示測試畫面
// 只用 identity.status === "demo" 決定
const isDemoMode = identity.status === "demo";
```

**同時**，在 LIFF init 失敗時，正式環境一律導向 `/login`，不進入 demo 模式：

```typescript
// services/liff.js — PROD 環境 boot 失敗
if (import.meta.env.PROD) {
  window.location.replace("/login");
  return;
}
// 只有 DEV 環境才允許 demo 模式
```

---

### Fix 3：醫療資料改用 group_id 為主要 scope

**原則**：`appointments` 和 `medications` 查詢時，**以 `group_id` 為主要篩選條件**，而非 `user_id`。

```typescript
// 修改前（有問題）
`appointments?user_id=eq.${userId}&...`

// 修改後（以 group 為 scope）
`appointments?group_id=in.(${groupIds.join(",")})&profile_id=eq.${profileId}&...`
```

**`user_id` 保留但降格**：改為 `uploaded_by_user_id` 語意（誰上傳的），不作為資料 scope 的決定因素。

---

### Fix 4：額度改綁 group_id + 改以 ocr_jobs 計次

**原則**：每次成功的 OCR 任務 = 1 次；以 `group_id` 為單位計算；付費方案不受限。

```typescript
// 新的額度檢查邏輯
export async function checkOcrQuota(env: Env, groupId: number, plan: string): Promise<void> {
  if (plan === "paid") return;

  const period = new Date().toISOString().slice(0, 7); // '2026-05'
  const quota = await getOrCreateQuota(env, groupId, period);

  if (quota.used_count >= quota.limit_count) {
    throw new Error(`本月免費次數已用完（${quota.limit_count} 次），升級付費方案可無限使用。`);
  }
}

export async function incrementOcrQuota(env: Env, groupId: number): Promise<void> {
  const period = new Date().toISOString().slice(0, 7);
  await supabaseFetch(env, `usage_quotas?group_id=eq.${groupId}&period=eq.${period}&feature=eq.ocr_upload`, {
    method: "PATCH",
    body: JSON.stringify({ used_count: "used_count + 1", updated_at: new Date().toISOString() }),
    headers: { Prefer: "return=minimal" },
  });
}
```

**internal / test plan bypass**：

```typescript
// users.plan 加入 'internal' 選項
if (plan === "paid" || plan === "internal") return; // 不檢查額度
```

---

### Fix 5：LIFF Token 過期處理

在所有 API 呼叫的 error handler 加入 401 自動重新取得 token：

```typescript
// services/api.js 新增 refreshTokenAndRetry
async function fetchWithAuth(url, options) {
  const response = await fetch(url, options);
  if (response.status === 401) {
    // 嘗試重新取得 LIFF idToken
    const newToken = await refreshLiffToken();
    if (newToken) {
      return fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${newToken}` } });
    }
    // 無法重新取得 → 導向登入
    window.location.replace("/login");
  }
  return response;
}
```

---

## 五、新的登入後初始化流程

### 5.1 正確的 boot() 順序

```
LINE LIFF init()
  ↓
取得 idToken + profile（lineUserId, displayName, pictureUrl）
  ↓
POST /api/auth/initialize  （或 GET /api/me）
  ├── getOrCreateUser(lineUserId)  → 取得 userId
  ├── getUserGroups(userId)        → 取得 groupIds
  │     ├── 有群組 → 繼續
  │     └── 無群組 → 建立預設群組 + 回傳 is_first_time: true
  ├── getCareProfiles(groupIds)    → 排序：is_default desc, created_at asc
  └── 回傳 { userId, groups, care_profiles, is_first_time }
  ↓
前端設定：
  setActiveGroupId(groups[0].id)
  setActiveProfileId(profiles.find(is_default) || profiles[0])
  ↓
帶 groupId + profileId 拉 dashboard 資料
```

### 5.2 不允許的初始化行為

- ❌ 無 JWT 時呼叫 `getOrCreateDefaultUser(undefined)` → 改為直接回空 demo 資料
- ❌ `activeProfile` 用 localStorage cached 值，不驗證是否在 accessible profiles 內
- ❌ 登入者 = 被照護者（日月MING ≠ 洪爸爸）

---

## 六、測試資料清除策略

### Phase A：備份（在 Supabase SQL Editor 執行）

```sql
-- 備份目前所有測試資料（加上 _backup suffix）
CREATE TABLE IF NOT EXISTS _backup_users AS SELECT * FROM users;
CREATE TABLE IF NOT EXISTS _backup_family_groups AS SELECT * FROM family_groups;
CREATE TABLE IF NOT EXISTS _backup_user_family_groups AS SELECT * FROM user_family_groups;
CREATE TABLE IF NOT EXISTS _backup_care_profiles AS SELECT * FROM care_profiles;
CREATE TABLE IF NOT EXISTS _backup_appointments AS SELECT * FROM appointments;
CREATE TABLE IF NOT EXISTS _backup_medications AS SELECT * FROM medications;
```

### Phase B：識別測試資料

```sql
-- 找出哪些是 web-mvp / 測試帳號的資料
SELECT u.id, u.line_user_id, u.name,
  (SELECT COUNT(*) FROM appointments WHERE user_id = u.id) AS apts_count,
  (SELECT COUNT(*) FROM medications WHERE user_id = u.id) AS meds_count
FROM users u
ORDER BY u.created_at;
```

### Phase C：清除測試帳號資料（保留真實帳號）

```sql
-- 清除 web-mvp 這個帳號的所有照護資料（不刪 account 本身）
DELETE FROM medications WHERE user_id = (SELECT id FROM users WHERE line_user_id = 'web-mvp');
DELETE FROM appointments WHERE user_id = (SELECT id FROM users WHERE line_user_id = 'web-mvp');

-- 清除 web-mvp 所在的 care_profiles / family_groups
-- 先確認 group_ids
SELECT fg.id, fg.name FROM family_groups fg
JOIN user_family_groups ufg ON ufg.group_id = fg.id
JOIN users u ON u.id = ufg.user_id
WHERE u.line_user_id = 'web-mvp';

-- 若確認是測試群組，刪除（cascade 會帶走 care_profiles + user_family_groups）
-- DELETE FROM family_groups WHERE id IN (...);
```

### Phase D：全新用戶流程驗證

1. 日月MING 從 LINE 打開 LIFF → 正確進入空狀態 Dashboard
2. 建立「洪家照護空間」→ 加入自己為 owner
3. 建立照護對象「洪爸爸」→ relationship = "爸爸", is_default = true
4. 上傳第一張掛號單 → 檢查 OCR 流程、quota 扣減、資料歸屬

---

## 七、洪爸爸第一批資料 Seed 策略

以下資料來自實際門診單，可作為第一批導入驗證：

| 資料類型 | 內容 | 對應資料表 |
|---|---|---|
| 腫瘤科回診 | 2026/05/14 廖斌志醫師，五東一樓 08 診 | `appointments` |
| 耳鼻喉科回診 | 2026/06/02 10:00 二樓 05 診 | `appointments` |
| 泌尿科回診 | 2026/07/07 13:30 二樓 01 診 | `appointments` |
| 內科心臟科回診 | 2026/07/29 09:00 三西一樓 17 診 | `appointments` |
| MRI 頭頸部 | 2026/09/14 西址一樓磁振造影室 | `appointments` |
| 抽血（回診前 7 天） | 西址成人第一抽血站，本次無需空腹 | `appointments` |
| 胸部 X 光 | 2026/05/14 西址一樓二東 C | `appointments` |
| UFUR/cap | 1 cap BID 早晚飯後（頭頸癌藥） | `medications` |
| Concor 5mg | 0.5 tab QD（淡黃色心型錠） | `medications` |
| Diovan 40mg | 0.5 tab BID | `medications` |
| Imovane | 1 tab HS 睡前（管制藥品注意防跌） | `medications` |
| Megest Oral Susp | 4 mL BID 需搖勻 | `medications` |
| Urief | 1 tab HS 睡前（泌尿用藥） | `medications` |
| 慢箋第 2 次領藥 | 2026/05/27–06/02 | `appointments` type = refill_reminder |

---

## 八、驗收標準

### 8.1 身份與資料隔離

- [ ] 日月MING 登入後，`/api/me` 回傳的 `userId` 唯一對應日月MING 的 LINE sub
- [ ] 日月MING 的 dashboard 不會出現其他帳號的 care_profiles 或醫療紀錄
- [ ] `web-mvp` 預設用戶不再作為 anonymous request 的 fallback
- [ ] Demo 畫面只顯示靜態假資料，不包含任何真實用戶資料

### 8.2 家庭群組 scope

- [ ] 所有 appointments、medications 都有有效的 `group_id`
- [ ] 以 `group_id` 為主 scope 查詢，確保家庭成員共享同一份資料
- [ ] 換 care_profile 時，appointments / medications 根據 `profile_id` 正確篩選

### 8.3 使用額度

- [ ] `usage_quotas` 以 `group_id + period + feature` 為單位記錄
- [ ] 一次 OCR 上傳 = 1 次扣減，不論解析出幾筆藥品
- [ ] `plan = 'internal'` 的帳號不受 10 次限制
- [ ] 清除測試資料後，洪家照護空間的額度歸零

### 8.4 Demo / Production 隔離

- [ ] `care.wedopr.com` 不出現「現在是測試畫面」
- [ ] Demo 模式只在 DEV 環境（無 LIFF_ID）觸發
- [ ] LIFF token 過期時，畫面提示重新登入而非顯示錯誤資料

### 8.5 Token 過期

- [ ] `idToken expired` 時，系統提示「請重新登入」並導向 `/login`
- [ ] 不因 token 過期造成資料錯位（看到其他人的資料）

---

## 九、重構路線圖

### Phase 0：盤點 ✅ 完成

- [x] 匯出 Supabase schema
- [x] 列出 RLS policies 現況
- [x] 識別缺少 group_id / profile_id 的查詢
- [x] 登入後初始化流程分析
- [x] activeProfile / activeWorkspace 決定邏輯
- [x] usage quota 綁定 id 確認
- [x] demo / production 判斷邏輯確認
- [x] DEFAULT_USER 污染根因確認

### Phase 1：資料模型補欄位 ⬜ 待執行

目標：不刪現有資料，只新增欄位與資料表

1. `ALTER TABLE users ADD COLUMN picture_url, email`
2. `ALTER TABLE family_groups ADD COLUMN owner_user_id`
3. `CREATE TABLE care_documents`
4. `CREATE TABLE ocr_jobs`
5. `CREATE TABLE usage_quotas`
6. `ALTER TABLE appointments ADD COLUMN document_id`
7. `ALTER TABLE medications ADD COLUMN document_id`

驗證：`SELECT * FROM information_schema.columns WHERE table_name IN (...)` 確認欄位存在

### Phase 2：後端邏輯修正 ⬜ 待執行

目標：修 Bug 1、2、3、4

1. **移除 DEFAULT_USER fallback**：`getOrCreateDefaultUser(undefined)` → throw
2. **dashboard 無 JWT → 靜態 demo 資料**，不查 DB
3. **appointments/medications 查詢改用 group_id**
4. **usage quota 改寫**：新增 `getGroupPlan()`, `checkGroupOcrQuota()`, `incrementGroupOcrQuota()`
5. **ocr_jobs 記錄**：每次 OCR 建立一筆 `ocr_jobs`

驗證：`npm run test` 跑 regression test；手動驗證 dashboard API 回傳

### Phase 3：前端身份初始化修正 ⬜ 待執行

目標：修 Bug 2、5

1. **demo mode 判斷改為 `identity.status === "demo"`**，移除 `dashboard.mode === "demo"` 條件
2. **PROD 環境 boot 例外 → 導向 `/login`**
3. **401 response → refreshToken → 失敗則導向 `/login`**

驗證：模擬 token 過期場景，確認不顯示錯誤資料

### Phase 4：清除測試資料 ⬜ 待執行（Phase 1-3 驗證後才執行）

1. 備份 `_backup_*` 資料表
2. 清除 `web-mvp` 帳號的 appointments, medications, care_profiles
3. 確認 `family_groups` 中哪些是純測試群組
4. 日月MING 全新登入驗證空狀態 Dashboard

### Phase 5：洪爸爸第一批資料導入 ⬜ 待執行

1. 建立洪家照護空間（`family_groups`）
2. 日月MING 加入為 owner（`user_family_groups.role = 'owner'`）
3. 建立洪爸爸（`care_profiles.is_default = true`）
4. 上傳腫瘤科掛號單 → 驗證 OCR → 確認 appointments 歸屬
5. 手動補齊完整就診計畫（依 Section 七的 Seed 策略）

---

## 十、不做的事（本次重構邊界）

- ❌ 不改 UI 元件（Header, TabNav, MobileBottomNav）
- ❌ 不改 LINE Bot cron job 流程（reminders, evening）
- ❌ 不改 LINE Login Channel 設定（LIFF Endpoint URL 問題已在 Sprint 4 記錄）
- ❌ 不建立 RLS policies（目前 service_role_key 架構可繼續，等穩定後再補）
- ❌ 不拆分 workspace_members 的 role 系統（先用現有 role/can_manage 欄位）
- ❌ 不建立 tasks 資料表（目前用 appointments 呈現今日重點即可）
