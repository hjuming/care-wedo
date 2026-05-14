-- Phase 49: persist care profile order and active profile across devices.
alter table public.users
  add column if not exists active_profile_id bigint;

alter table public.care_profiles
  add column if not exists sort_order integer not null default 0;

create index if not exists care_profiles_group_order_idx
  on public.care_profiles (group_id, sort_order, created_at asc);
