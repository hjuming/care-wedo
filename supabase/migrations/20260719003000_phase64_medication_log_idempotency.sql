-- Phase 64: make medication status retries safe after client timeouts.
-- Existing rows keep NULL keys; PostgreSQL UNIQUE indexes allow multiple NULLs.
alter table public.medication_logs
  add column if not exists idempotency_key text;

create unique index if not exists medication_logs_medication_idempotency_key_uidx
  on public.medication_logs (medication_id, idempotency_key);
