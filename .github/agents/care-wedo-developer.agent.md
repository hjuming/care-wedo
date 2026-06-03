---
name: Care WEDO Developer
description: "Use when continuing development of the Care WEDO project: Cloudflare + Supabase + LINE integration, OCR reminder flows, family groups, care profiles, frontend UI, and backend API logic."
applyTo:
  - "care-wedo-app/**"
  - "care-wedo-bot/**"
  - "functions/**"
  - "supabase/**"
  - "README.md"
  - "CLOUDFLARE_SUPABASE_RUNBOOK.md"
  - "DEVELOPMENT_PLAN.md"
---

# Care WEDO Developer Agent

## When to pick this agent

Use this agent for ongoing feature development, bug fixes, refactors, and implementation work inside the Care WEDO repository. Best for:

- Cloudflare Pages / Functions backend logic
- Supabase schema, migrations, and data access patterns
- LINE Webhook, reminders, and notification flows
- Frontend React / LIFF UI work in `care-wedo-app`
- Care profile, family group, and permission-related enhancements
- Sprint 0–5 V1.0 Beta feature implementation

## Current Project State (Phase 3 Complete)

**Version**: Phase 3 complete. V1.0 Beta in progress.  
**Live URL**: `https://care.wedopr.com`

### What is fully working
- LINE LIFF login via `@line/liff` — falls back to demo mode if `VITE_LINE_LIFF_ID` is unset
- Family groups: create, join by invite code, create care profiles
- Care profiles: create, switch, edit, avatar upload
- OCR pipeline: LINE Webhook → Gemini Vision → Supabase upsert → LINE reply
- Cron reminders: 08:00 morning brief + 20:00 evening fasting alert (via GitHub Actions)
- Dashboard API: `/api/dashboard` returns appointments, medications, care profiles
- Frontend: full React Dashboard with calendar, meds, records, settings sections
- Tests: 7/7 passing (routing + API service layer)

### What is NOT yet implemented (P0 before Beta)
1. **Auth gate on `/app`** — unauthenticated users can access the demo dashboard. Fix in `routing.js` + `App.jsx` boot flow.
2. **API auth middleware** — `functions/api/_middleware.ts` only adds CORS headers. No JWT verification.
3. **`handleComplete` persistence** — `App.jsx:485` only updates local state. `PATCH /api/appointments/:id` endpoint does not exist.
4. **No `PATCH /api/appointments/:id` or `PATCH /api/medications/:id`** — needed for Sprint 1.
5. **No plan/quota system** — `users` table has no `plan` column. No OCR usage tracking.
6. **Family group roles incomplete** — Schema has `role` and `can_manage` columns, but API has no `remove_member` or `regenerate_invite` actions.
7. **LINE end-to-end not validated on real devices**.
8. **No privacy policy or terms pages**.

## Architecture

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite, `@line/liff` |
| API | Cloudflare Pages Functions (TypeScript) |
| Database | Supabase PostgreSQL (RLS enabled) |
| AI OCR | Gemini 2.5 Flash Vision API |
| Notifications | LINE Messaging API (Push + Reply) |
| Cron | Cloudflare Cron Worker → `/api/cron/*`; GitHub Actions manual backup only |

## Key File Map

```
care-wedo-app/src/
  App.jsx                    ← Main frontend (routing, dashboard, OCR upload)
  routing.js                 ← Route resolution (landing / login / app)
  services/
    liff.js                  ← LINE LIFF identity init (demo fallback when no LIFF_ID)
    api.js                   ← Frontend API service layer
  components/
    GroupManager.jsx         ← Family group create/join UI
    GroupSettings.jsx        ← Group member settings, notification prefs
    LoginSetup.jsx           ← Initial family setup flow
    OcrResult.jsx            ← OCR result display

functions/
  api/
    _middleware.ts           ← CORS only (no auth gate yet)
    dashboard.ts             ← GET dashboard data (appointments + meds + profiles)
    groups.ts                ← GET/POST groups, join, create_profile
    me.ts                    ← GET/POST current user, init_family
    profiles/[id].ts         ← PATCH care profile info + avatar
    ocr/[[path]].ts          ← POST image OCR → Supabase upsert
    health.ts                ← GET health check
    cron/reminders.ts        ← POST morning brief (cron)
    cron/evening.ts          ← POST evening fasting alert (cron)
  _shared/
    supabase.ts              ← All Supabase data access functions

supabase/
  schema.sql                 ← Full schema (users, family_groups, care_profiles,
                               user_family_groups, appointments, medications)
```

## Database Schema Summary

```
users               — LINE users (line_user_id, name, [plan, plan_expires_at — to add])
family_groups       — Family groups (name, invite_code)
care_profiles       — Care subjects (display_name, relationship, avatar_url, birth_year)
user_family_groups  — M:N users↔groups (role, can_manage, can_pay, notification prefs)
appointments        — Visit records (type, date, hospital, department, status)
medications         — Medication records (name, dosage, frequency, active)
```

## How to Behave

- Always inspect relevant files before making changes.
- Keep naming, database fields, and API behavior consistent with existing code.
- Prefer small, focused improvements over broad rewrites.
- When implementing Sprint 0–5 tasks, reference `DEVELOPMENT_PLAN.md` for exact file targets and acceptance criteria.
- For new API endpoints, follow the pattern in `functions/api/groups.ts` — use `getBearerToken` + `verifyLineIdToken` + `getOrCreateDefaultUser` from `functions/_shared/supabase.ts`.
- For new frontend API calls, add them to `care-wedo-app/src/services/api.js`.
- Do not expose `SUPABASE_SERVICE_ROLE_KEY` to the frontend.
- When adding new database columns, update both `supabase/schema.sql` and add a migration comment.

## Environment Variables

### Cloudflare (backend Functions)
- `GOOGLE_API_KEY` — Gemini Vision API
- `GEMINI_MODEL_NAME` — default `gemini-2.5-flash`
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
- `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_CHANNEL_SECRET`
- `LINE_LOGIN_CHANNEL_ID` — for JWT verification
- `CRON_SECRET` — protects cron endpoints

### Cloudflare (frontend build)
- `VITE_LINE_LIFF_ID` — LIFF App ID. **Required for production.** If unset, app enters demo mode.

## Known Risks and Constraints

- **Demo mode in production**: If `VITE_LINE_LIFF_ID` is not set in the Cloudflare build env, any user can access the demo dashboard. This MUST be fixed before public Beta (Sprint 0).
- **Service Role Key bypasses RLS**: All backend queries run with service role. Never forward user tokens directly to Supabase from the backend without proper identity scoping.
- **Cloudflare `waitUntil()` is used in OCR webhook**: This relies on the execution context remaining open. Verify this works on real devices with the actual LINE Webhook flow.
- **Cron timezone**: GitHub Actions uses UTC. Taiwan time is UTC+8. Morning brief should trigger at UTC 00:00, evening alert at UTC 12:00.

## Example Prompts

- "實作 Sprint 0：在 `/app` 路由加上登入閘門，未登入導向 `/login`。"
- "新增 `PATCH /api/appointments/:id` 端點，讓前端可以標記待辦為已完成。"
- "在 `users` 表新增 `plan` 欄位，並在 OCR API 加入 free 方案 quota 檢查。"
- "在 `groups.ts` 新增 `remove_member` action，只有 admin 可呼叫。"
- "幫我寫 `functions/api/appointments/[id].ts` 的完整 PATCH 邏輯。"
- "更新 `liff.js`，在 PROD 環境關閉 demo fallback，改成導向 `/login`。"
