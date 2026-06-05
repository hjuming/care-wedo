-- Phase 58: Supabase Auth identity bridge for Google OAuth MVP.
-- Keep LINE identity intact; Google/Supabase Auth is an additional dashboard login path.

alter table public.users
  add column if not exists auth_user_id uuid,
  add column if not exists auth_provider text;

create unique index if not exists users_auth_user_id_unique
  on public.users(auth_user_id)
  where auth_user_id is not null;

create index if not exists users_auth_provider_idx
  on public.users(auth_provider)
  where auth_provider is not null;
