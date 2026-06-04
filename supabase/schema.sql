create table if not exists public.users (
  id bigserial primary key,
  line_user_id text unique,
  name text,
  picture_url text,
  email text,
  plan text not null default 'free',
  plan_expires_at timestamptz,
  active_profile_id bigint,
  created_at timestamptz not null default now()
);

-- Migration: add plan columns if upgrading from earlier schema
alter table public.users
  add column if not exists plan text not null default 'free',
  add column if not exists plan_expires_at timestamptz,
  add column if not exists picture_url text,
  add column if not exists email text,
  add column if not exists active_profile_id bigint;

create table if not exists public.user_feature_flags (
  id          bigserial primary key,
  user_id     bigint not null references public.users(id) on delete cascade,
  feature_key text not null,
  enabled     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

do $$ begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'user_feature_flags'
      and constraint_type = 'UNIQUE'
      and constraint_name = 'user_feature_flags_user_feature_key'
  ) then
    alter table public.user_feature_flags
      add constraint user_feature_flags_user_feature_key
        unique (user_id, feature_key);
  end if;
end $$;

create index if not exists user_feature_flags_user_id_idx
  on public.user_feature_flags (user_id);

-- plans: 方案主表（在 family_groups 之前建立，因為 family_groups 有 FK 依賴）
create table if not exists public.plans (
  id                   text primary key,
  name                 text not null,
  monthly_ocr_limit    integer not null,
  max_members          integer not null,
  max_recipients       integer not null,
  family_group_enabled boolean not null default false,
  price_monthly_usd    numeric(8, 2) not null default 0,
  is_active            boolean not null default true,
  sort_order           integer not null default 0,
  created_at           timestamptz not null default now()
);

insert into public.plans (id, name, monthly_ocr_limit, max_members, max_recipients, family_group_enabled, price_monthly_usd, is_active, sort_order) values
  ('free',     'Free',             10,     1,  1,  false,  0,   true,   10),
  ('pro',      '照護圈升級',       100,     6,  4,  true,  30,   true,   20),
  ('basic',    'Legacy Basic',     30,     2,  1,  true,   1,   false, 910),
  ('plus',     'Legacy Plus',      50,     5,  2,  true,   3,   false, 920),
  ('team',     'Legacy Team',     200,    15,  8,  true,  10,   false, 930),
  ('internal', 'Internal / Test', 99999,  99, 99,  true,   0,   true,  999)
on conflict (id) do update set
  name = excluded.name, monthly_ocr_limit = excluded.monthly_ocr_limit,
  max_members = excluded.max_members, max_recipients = excluded.max_recipients,
  family_group_enabled = excluded.family_group_enabled,
  price_monthly_usd = excluded.price_monthly_usd,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order;

create table if not exists public.family_groups (
  id              bigserial primary key,
  name            text,
  invite_code     text unique,
  owner_user_id   bigint references public.users(id) on delete set null,
  plan_id         text not null default 'free' references public.plans(id),
  plan_started_at timestamptz default now(),
  plan_expires_at timestamptz,
  created_at      timestamptz not null default now()
);

alter table public.family_groups
  add column if not exists owner_user_id bigint references public.users(id) on delete set null,
  add column if not exists plan_id text not null default 'free',
  add column if not exists plan_started_at timestamptz default now(),
  add column if not exists plan_expires_at timestamptz;

do $$ begin
  if not exists (
    select 1
    from information_schema.key_column_usage kcu
    join information_schema.table_constraints tc
      on kcu.constraint_name = tc.constraint_name
      and kcu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and kcu.table_schema = 'public'
      and kcu.table_name = 'family_groups'
      and kcu.column_name = 'plan_id'
  ) then
    alter table public.family_groups
      add constraint family_groups_plan_id_fk
        foreign key (plan_id) references public.plans(id);
  end if;
end $$;

create table if not exists public.care_profiles (
  id bigserial primary key,
  group_id bigint references public.family_groups(id) on delete cascade,
  primary_user_id bigint references public.users(id) on delete set null,
  display_name text not null default '親愛的家人',
  relationship text not null default 'family',
  avatar_url text,
  birth_year integer,
  birth_date date,
  emergency_phone text,
  email text,
  gender text,
  main_hospital text,
  main_department text,
  notes text,
  is_default boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.care_profiles
  add column if not exists birth_date date,
  add column if not exists emergency_phone text,
  add column if not exists email text,
  add column if not exists gender text,
  add column if not exists sort_order integer not null default 0;

create table if not exists public.user_family_groups (
  user_id bigint not null references public.users(id) on delete cascade,
  group_id bigint not null references public.family_groups(id) on delete cascade,
  role text not null default 'member',
  can_manage boolean not null default true,
  can_pay boolean not null default false,
  receive_daily_brief boolean not null default true,
  receive_upload_summary boolean not null default true,
  receive_evening_alert boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (user_id, group_id)
);

create table if not exists public.appointments (
  id bigserial primary key,
  user_id bigint references public.users(id) on delete cascade,
  group_id bigint references public.family_groups(id) on delete cascade,
  profile_id bigint references public.care_profiles(id) on delete set null,
  source_document_id bigint,  -- fk to care_documents added after that table is created
  created_by_user_id bigint references public.users(id) on delete set null,
  type text,
  date text,
  time text,
  title text,
  hospital text,
  department text,
  doctor text,
  number text,
  location text,
  fasting_required boolean not null default false,
  fasting_hours integer,
  notes text,
  reminder_text text,
  status text not null default 'upcoming',
  created_at timestamptz not null default now()
);

create table if not exists public.medications (
  id bigserial primary key,
  user_id bigint references public.users(id) on delete cascade,
  group_id bigint references public.family_groups(id) on delete cascade,
  profile_id bigint references public.care_profiles(id) on delete set null,
  source_document_id bigint,  -- fk to care_documents added after that table is created
  created_by_user_id bigint references public.users(id) on delete set null,
  name text,
  dosage text,
  frequency text,
  time_slot text,
  meal_timing text,
  scheduled_time text,
  taken_status text,
  normalized_name text,
  brand_name text,
  generic_name text,
  drug_code text,
  dosage_text text,
  identity_confidence numeric,
  duplicate_candidate_ids jsonb not null default '[]'::jsonb,
  purpose text,
  warnings text,
  reminder_text text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.appointments
  add column if not exists type text;

alter table public.appointments
  add column if not exists group_id bigint references public.family_groups(id) on delete cascade,
  add column if not exists profile_id bigint references public.care_profiles(id) on delete set null;

alter table public.medications
  add column if not exists group_id bigint references public.family_groups(id) on delete cascade,
  add column if not exists profile_id bigint references public.care_profiles(id) on delete set null,
  add column if not exists time_slot text,
  add column if not exists meal_timing text,
  add column if not exists scheduled_time text,
  add column if not exists taken_status text,
  add column if not exists normalized_name text,
  add column if not exists brand_name text,
  add column if not exists generic_name text,
  add column if not exists drug_code text,
  add column if not exists dosage_text text,
  add column if not exists identity_confidence numeric,
  add column if not exists duplicate_candidate_ids jsonb not null default '[]'::jsonb;

alter table public.user_family_groups
  add column if not exists can_manage boolean not null default true,
  add column if not exists can_pay boolean not null default false,
  add column if not exists receive_daily_brief boolean not null default true,
  add column if not exists receive_upload_summary boolean not null default true,
  add column if not exists receive_evening_alert boolean not null default true,
  add column if not exists created_at timestamptz not null default now();

create index if not exists appointments_status_date_idx
  on public.appointments (status, date, created_at desc);

create index if not exists appointments_profile_status_date_idx
  on public.appointments (profile_id, status, date, created_at desc);

create index if not exists appointments_group_id_idx
  on public.appointments (group_id);

create index if not exists medications_active_created_at_idx
  on public.medications (active, created_at desc);

create index if not exists medications_profile_active_created_at_idx
  on public.medications (profile_id, active, created_at desc);

create index if not exists medications_group_id_idx
  on public.medications (group_id);

create index if not exists medications_profile_normalized_name_idx
  on public.medications (profile_id, normalized_name)
  where normalized_name is not null;

create index if not exists medications_profile_drug_code_idx
  on public.medications (profile_id, drug_code)
  where drug_code is not null;

create table if not exists public.medication_logs (
  id bigserial primary key,
  medication_id bigint not null references public.medications(id) on delete cascade,
  group_id bigint references public.family_groups(id) on delete cascade,
  profile_id bigint references public.care_profiles(id) on delete set null,
  taken_date date not null,
  time_slot text not null,
  status text not null default 'taken',
  confirmed_by_user_id bigint references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists medication_logs_medication_date_idx
  on public.medication_logs (medication_id, taken_date, time_slot);

create index if not exists care_profiles_group_id_idx
  on public.care_profiles (group_id, is_default desc, created_at asc);

create index if not exists care_profiles_group_order_idx
  on public.care_profiles (group_id, sort_order, created_at asc);

-- Migration Phase 1: add source_document_id / created_by_user_id
alter table public.appointments
  add column if not exists source_document_id bigint,
  add column if not exists created_by_user_id bigint references public.users(id) on delete set null;

alter table public.medications
  add column if not exists source_document_id bigint,
  add column if not exists created_by_user_id bigint references public.users(id) on delete set null;

-- care_documents: 所有上傳文件的主表
create table if not exists public.care_documents (
  id bigserial primary key,
  group_id bigint not null references public.family_groups(id) on delete cascade,
  profile_id bigint references public.care_profiles(id) on delete set null,
  uploaded_by_user_id bigint references public.users(id) on delete set null,
  document_type text not null default 'other',
  -- appointment_slip / prescription / lab_order / imaging_order / medication_bag / other
  source_file_url text,
  storage_bucket text,
  storage_path text,
  original_file_name text,
  mime_type text,
  file_size_bytes bigint,
  page_count integer,
  document_title text,
  source_hospital text,
  document_date date,
  summary_status text not null default 'pending',
  preserve_original_file boolean not null default true,
  ocr_text text,
  ai_summary jsonb,
  status text not null default 'uploaded',
  -- uploaded / processing / pending_review / confirmed / failed
  captured_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.care_documents
  add column if not exists storage_bucket text,
  add column if not exists storage_path text,
  add column if not exists original_file_name text,
  add column if not exists mime_type text,
  add column if not exists file_size_bytes bigint,
  add column if not exists page_count integer,
  add column if not exists document_title text,
  add column if not exists source_hospital text,
  add column if not exists document_date date,
  add column if not exists summary_status text not null default 'pending',
  add column if not exists preserve_original_file boolean not null default true,
  add column if not exists deleted_at timestamptz;

-- Add FK for source_document_id now that care_documents exists.
-- Check by column name (not constraint name) to avoid duplicates
-- when migration already added the FK with an auto-generated name.
do $$ begin
  if not exists (
    select 1 from information_schema.key_column_usage kcu
    join information_schema.table_constraints tc
      on kcu.constraint_name = tc.constraint_name
      and kcu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and kcu.table_schema = 'public'
      and kcu.table_name = 'appointments'
      and kcu.column_name = 'source_document_id'
  ) then
    alter table public.appointments
      add constraint appointments_source_document_fk
        foreign key (source_document_id) references public.care_documents(id) on delete set null;
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from information_schema.key_column_usage kcu
    join information_schema.table_constraints tc
      on kcu.constraint_name = tc.constraint_name
      and kcu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and kcu.table_schema = 'public'
      and kcu.table_name = 'medications'
      and kcu.column_name = 'source_document_id'
  ) then
    alter table public.medications
      add constraint medications_source_document_fk
        foreign key (source_document_id) references public.care_documents(id) on delete set null;
  end if;
end $$;

-- usage_quotas: 額度以 group_id + period + feature 為單位
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

-- billing foundation: 正式收費前先建立可稽核的群組帳務資料
create table if not exists public.billing_subscriptions (
  id bigserial primary key,
  family_group_id bigint not null references public.family_groups(id) on delete cascade,
  owner_user_id bigint references public.users(id) on delete set null,
  plan_id text not null default 'pro' references public.plans(id),
  status text not null default 'beta',
  currency text not null default 'TWD',
  care_profile_count integer not null default 0 check (care_profile_count >= 0),
  paid_collaborator_count integer not null default 0 check (paid_collaborator_count >= 0),
  estimated_monthly_amount integer not null default 0 check (estimated_monthly_amount >= 0),
  billing_anchor_day integer check (billing_anchor_day between 1 and 31),
  current_period_start date,
  current_period_end date,
  trial_ends_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(family_group_id)
);

create table if not exists public.billing_events (
  id bigserial primary key,
  family_group_id bigint not null references public.family_groups(id) on delete cascade,
  subscription_id bigint references public.billing_subscriptions(id) on delete set null,
  actor_user_id bigint references public.users(id) on delete set null,
  subject_user_id bigint references public.users(id) on delete set null,
  care_profile_id bigint references public.care_profiles(id) on delete set null,
  event_type text not null,
  amount_delta integer not null default 0,
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id bigserial primary key,
  family_group_id bigint not null references public.family_groups(id) on delete cascade,
  subscription_id bigint references public.billing_subscriptions(id) on delete set null,
  owner_user_id bigint references public.users(id) on delete set null,
  period text not null,
  status text not null default 'draft',
  currency text not null default 'TWD',
  care_profile_count integer not null default 0,
  paid_collaborator_count integer not null default 0,
  amount_due integer not null default 0,
  line_items jsonb not null default '[]'::jsonb,
  issued_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique(family_group_id, period)
);

-- line_push_logs: 去識別化 LINE 推播稽核，不保存完整 LINE user id 或醫療訊息全文
create table if not exists public.line_push_logs (
  id bigserial primary key,
  event_type text not null,
  channel text not null default 'line',
  recipient_user_id bigint references public.users(id) on delete set null,
  group_id bigint references public.family_groups(id) on delete set null,
  profile_id bigint references public.care_profiles(id) on delete set null,
  target_date date,
  source_table text,
  source_ids jsonb not null default '[]'::jsonb,
  line_user_suffix text,
  message_character_count integer not null default 0 check (message_character_count >= 0),
  item_count integer not null default 0 check (item_count >= 0),
  status text not null check (status in ('skipped', 'sent', 'failed')),
  http_status integer,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists care_documents_group_profile_idx
  on public.care_documents (group_id, profile_id, created_at desc);

create index if not exists care_documents_status_idx
  on public.care_documents (status, created_at desc);

create index if not exists care_documents_profile_date_idx
  on public.care_documents (profile_id, document_date desc, created_at desc);

create index if not exists care_documents_type_idx
  on public.care_documents (document_type, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'care-documents',
  'care-documents',
  false,
  26214400,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create index if not exists appointments_source_document_idx
  on public.appointments (source_document_id);

create index if not exists appointments_created_by_idx
  on public.appointments (created_by_user_id);

create index if not exists medications_source_document_idx
  on public.medications (source_document_id);

create index if not exists medications_created_by_idx
  on public.medications (created_by_user_id);

create index if not exists usage_quotas_group_period_feature_idx
  on public.usage_quotas (group_id, period, feature);

create index if not exists billing_subscriptions_family_group_idx
  on public.billing_subscriptions (family_group_id);

create index if not exists billing_events_family_created_idx
  on public.billing_events (family_group_id, created_at desc);

create index if not exists billing_events_type_created_idx
  on public.billing_events (event_type, created_at desc);

create index if not exists invoices_family_period_idx
  on public.invoices (family_group_id, period);

create index if not exists line_push_logs_created_idx
  on public.line_push_logs (created_at desc);

create index if not exists line_push_logs_recipient_created_idx
  on public.line_push_logs (recipient_user_id, created_at desc);

create index if not exists line_push_logs_group_target_idx
  on public.line_push_logs (group_id, target_date, created_at desc);

create index if not exists line_push_logs_status_created_idx
  on public.line_push_logs (status, created_at desc);

alter table public.users enable row level security;
alter table public.user_feature_flags enable row level security;
alter table public.family_groups enable row level security;
alter table public.care_profiles enable row level security;
alter table public.user_family_groups enable row level security;
alter table public.appointments enable row level security;
alter table public.medications enable row level security;
alter table public.care_documents enable row level security;
alter table public.usage_quotas enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.billing_events enable row level security;
alter table public.invoices enable row level security;
alter table public.line_push_logs enable row level security;

revoke all on public.billing_subscriptions from anon, authenticated;
revoke all on public.billing_events from anon, authenticated;
revoke all on public.invoices from anon, authenticated;
revoke all on public.line_push_logs from anon, authenticated;

grant select, insert, update, delete on public.billing_subscriptions to service_role;
grant select, insert, update, delete on public.billing_events to service_role;
grant select, insert, update, delete on public.invoices to service_role;
grant select, insert, update, delete on public.line_push_logs to service_role;
grant usage, select on sequence public.line_push_logs_id_seq to service_role;
