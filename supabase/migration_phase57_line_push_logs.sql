-- Phase 57: de-identified LINE push audit logs
-- Records reminder delivery metadata without storing LINE user ids or medical message text.

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

create index if not exists line_push_logs_created_idx
  on public.line_push_logs (created_at desc);

create index if not exists line_push_logs_recipient_created_idx
  on public.line_push_logs (recipient_user_id, created_at desc);

create index if not exists line_push_logs_group_target_idx
  on public.line_push_logs (group_id, target_date, created_at desc);

create index if not exists line_push_logs_status_created_idx
  on public.line_push_logs (status, created_at desc);

alter table public.line_push_logs enable row level security;

revoke all on public.line_push_logs from anon, authenticated;

grant select, insert, update, delete on public.line_push_logs to service_role;
grant usage, select on sequence public.line_push_logs_id_seq to service_role;
