create table if not exists public.care_profiles (
  id bigserial primary key,
  group_id bigint references public.family_groups(id) on delete cascade,
  primary_user_id bigint references public.users(id) on delete set null,
  display_name text not null default '親愛的家人',
  relationship text not null default 'family',
  avatar_url text,
  birth_year integer,
  main_hospital text,
  main_department text,
  notes text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.appointments
  add column if not exists group_id bigint references public.family_groups(id) on delete cascade,
  add column if not exists profile_id bigint references public.care_profiles(id) on delete set null;

alter table public.medications
  add column if not exists group_id bigint references public.family_groups(id) on delete cascade,
  add column if not exists profile_id bigint references public.care_profiles(id) on delete set null;

alter table public.user_family_groups
  add column if not exists can_manage boolean not null default true,
  add column if not exists can_pay boolean not null default false,
  add column if not exists receive_daily_brief boolean not null default true,
  add column if not exists receive_upload_summary boolean not null default true,
  add column if not exists receive_evening_alert boolean not null default true,
  add column if not exists created_at timestamptz not null default now();

create index if not exists appointments_profile_status_date_idx
  on public.appointments (profile_id, status, date, created_at desc);

create index if not exists appointments_group_id_idx
  on public.appointments (group_id);

create index if not exists medications_profile_active_created_at_idx
  on public.medications (profile_id, active, created_at desc);

create index if not exists medications_group_id_idx
  on public.medications (group_id);

create index if not exists care_profiles_group_id_idx
  on public.care_profiles (group_id, is_default desc, created_at asc);

alter table public.care_profiles enable row level security;
