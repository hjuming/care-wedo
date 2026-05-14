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
