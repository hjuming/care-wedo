-- Phase 61: prevent duplicate appointment retries within a family group.
-- Existing rows remain untouched; NULL keys are intentionally not unique.
alter table public.appointments
  add column if not exists idempotency_key text;

create unique index if not exists appointments_group_idempotency_key_uidx
  on public.appointments (group_id, idempotency_key)
  where idempotency_key is not null and status <> 'deleted';
