create table if not exists public.users (
  id bigserial primary key,
  line_user_id text unique,
  name text,
  picture_url text,
  email text,
  plan text not null default 'free',
  plan_expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- Migration: add plan columns if upgrading from earlier schema
alter table public.users
  add column if not exists plan text not null default 'free',
  add column if not exists plan_expires_at timestamptz,
  add column if not exists picture_url text,
  add column if not exists email text;

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

insert into public.plans (id, name, monthly_ocr_limit, max_members, max_recipients, family_group_enabled, price_monthly_usd, sort_order) values
  ('free',     'Free',             10,     1,  1,  false,  0,   10),
  ('basic',    'Family Basic',     30,     2,  1,  true,   1,   20),
  ('plus',     'Family Plus',      50,     5,  2,  true,   3,   30),
  ('pro',      'Family Pro',      100,     8,  4,  true,   5,   40),
  ('team',     'Care Team',       200,    15,  8,  true,  10,   50),
  ('internal', 'Internal / Test', 99999,  99, 99,  true,   0,  999)
on conflict (id) do update set
  name = excluded.name, monthly_ocr_limit = excluded.monthly_ocr_limit,
  max_members = excluded.max_members, max_recipients = excluded.max_recipients,
  family_group_enabled = excluded.family_group_enabled,
  price_monthly_usd = excluded.price_monthly_usd, sort_order = excluded.sort_order;

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
  created_at timestamptz not null default now()
);

alter table public.care_profiles
  add column if not exists birth_date date,
  add column if not exists emergency_phone text,
  add column if not exists email text,
  add column if not exists gender text;

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
  add column if not exists taken_status text;

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
  ocr_text text,
  ai_summary jsonb,
  status text not null default 'uploaded',
  -- uploaded / processing / pending_review / confirmed / failed
  captured_at timestamptz,
  created_at timestamptz not null default now()
);

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

create index if not exists care_documents_group_profile_idx
  on public.care_documents (group_id, profile_id, created_at desc);

create index if not exists care_documents_status_idx
  on public.care_documents (status, created_at desc);

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

alter table public.users enable row level security;
alter table public.user_feature_flags enable row level security;
alter table public.family_groups enable row level security;
alter table public.care_profiles enable row level security;
alter table public.user_family_groups enable row level security;
alter table public.appointments enable row level security;
alter table public.medications enable row level security;
alter table public.care_documents enable row level security;
alter table public.usage_quotas enable row level security;
