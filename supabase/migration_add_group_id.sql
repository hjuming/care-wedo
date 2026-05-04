-- Migration: Add group_id to shared data tables
alter table public.appointments
  add column if not exists group_id bigint references public.family_groups(id) on delete cascade;

alter table public.medications
  add column if not exists group_id bigint references public.family_groups(id) on delete cascade;

-- Indices for group-based queries
create index if not exists appointments_group_id_idx on public.appointments (group_id);
create index if not exists medications_group_id_idx on public.medications (group_id);
