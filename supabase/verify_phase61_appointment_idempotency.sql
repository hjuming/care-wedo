-- Care WEDO Phase 61 read-only verification.
-- Run this in the staging Supabase SQL editor only. It performs no writes.

-- 1) The application column must exist.
select
  table_schema,
  table_name,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'appointments'
  and column_name = 'idempotency_key';

-- 2) The partial unique index must exist and cover group_id + idempotency_key.
select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'appointments'
  and indexname = 'appointments_group_idempotency_key_uidx';

-- 3) This returns one boolean row that is easy to attach to the staging gate.
select exists (
  select 1
  from pg_indexes
  where schemaname = 'public'
    and tablename = 'appointments'
    and indexname = 'appointments_group_idempotency_key_uidx'
    and indexdef ilike '%unique%'
    and indexdef ilike '%group_id%'
    and indexdef ilike '%idempotency_key%'
    and indexdef ilike '%status%<>%''deleted''%'
) as phase61_unique_index_ready;
