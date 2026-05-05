-- Migration: Phase 1 — Scope & Quotas
-- 目標：為從 user_id scope 轉向 group_id / profile_id scope 做資料庫準備。
-- 只新增欄位與表，不修改現有資料，不改查詢邏輯。
-- 可重跑：全部使用 IF NOT EXISTS / IF EXISTS 保護。

-- ============================================================
-- 1. users 補欄位
-- ============================================================
alter table public.users
  add column if not exists picture_url text,
  add column if not exists email text;

-- ============================================================
-- 2. family_groups 補欄位
-- ============================================================
alter table public.family_groups
  add column if not exists owner_user_id bigint references public.users(id) on delete set null;

-- ============================================================
-- 3. care_profiles 補欄位
-- ============================================================
alter table public.care_profiles
  add column if not exists birth_date date,
  add column if not exists gender text;

-- ============================================================
-- 4. care_documents（新表）
-- 所有上傳文件的主表，OCR 任務與解析結果從這裡出發。
-- ============================================================
create table if not exists public.care_documents (
  id bigserial primary key,
  group_id bigint not null references public.family_groups(id) on delete cascade,
  profile_id bigint references public.care_profiles(id) on delete set null,
  uploaded_by_user_id bigint references public.users(id) on delete set null,
  document_type text not null default 'other',
  -- appointment_slip / prescription / lab_order / imaging_order / medication_bag / other
  source_file_url text,
  ocr_text text,
  ai_summary jsonb,
  status text not null default 'uploaded',
  -- uploaded / processing / draft / confirmed / failed
  captured_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.care_documents enable row level security;

create index if not exists care_documents_group_profile_idx
  on public.care_documents (group_id, profile_id, created_at desc);

create index if not exists care_documents_status_idx
  on public.care_documents (status, created_at desc);

-- ============================================================
-- 5. appointments 補欄位
-- ============================================================
alter table public.appointments
  add column if not exists source_document_id bigint references public.care_documents(id) on delete set null,
  add column if not exists created_by_user_id bigint references public.users(id) on delete set null;

create index if not exists appointments_source_document_idx
  on public.appointments (source_document_id);

create index if not exists appointments_created_by_idx
  on public.appointments (created_by_user_id);

-- ============================================================
-- 6. medications 補欄位
-- ============================================================
alter table public.medications
  add column if not exists source_document_id bigint references public.care_documents(id) on delete set null,
  add column if not exists created_by_user_id bigint references public.users(id) on delete set null;

create index if not exists medications_source_document_idx
  on public.medications (source_document_id);

create index if not exists medications_created_by_idx
  on public.medications (created_by_user_id);

-- ============================================================
-- 7. usage_quotas（新表）
-- 額度以 group_id + period + feature 為單位計算。
-- Phase 1 只建表，Phase 2 才切換查詢邏輯。
-- ============================================================
create table if not exists public.usage_quotas (
  id bigserial primary key,
  group_id bigint not null references public.family_groups(id) on delete cascade,
  period text not null,         -- 'YYYY-MM' 格式，例如 '2026-05'
  feature text not null default 'ocr_upload',
  used_count integer not null default 0,
  limit_count integer not null default 10,
  plan_snapshot text not null default 'free',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(group_id, period, feature)
);

alter table public.usage_quotas enable row level security;

create index if not exists usage_quotas_group_period_feature_idx
  on public.usage_quotas (group_id, period, feature);

-- ============================================================
-- 驗證查詢（執行後確認欄位存在）
-- ============================================================
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name in ('users','family_groups','care_profiles','appointments','medications','care_documents','usage_quotas')
-- order by table_name, ordinal_position;

-- ============================================================
-- Rollback（只在尚未寫入新欄位資料前使用）
-- ============================================================
-- alter table public.appointments
--   drop column if exists source_document_id,
--   drop column if exists created_by_user_id;
--
-- alter table public.medications
--   drop column if exists source_document_id,
--   drop column if exists created_by_user_id;
--
-- alter table public.care_profiles
--   drop column if exists birth_date,
--   drop column if exists gender;
--
-- alter table public.family_groups
--   drop column if exists owner_user_id;
--
-- alter table public.users
--   drop column if exists picture_url,
--   drop column if exists email;
--
-- drop table if exists public.usage_quotas;
-- drop table if exists public.care_documents;
