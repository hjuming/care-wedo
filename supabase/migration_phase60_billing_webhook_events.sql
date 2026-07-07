-- Phase 60: central billing webhook event fields.
-- These columns let Care WEDO deduplicate WEDOPR gateway callbacks before
-- applying subscription side effects.

alter table public.billing_events
  add column if not exists provider text,
  add column if not exists provider_event_id text,
  add column if not exists gateway_transaction_id text,
  add column if not exists merchant_trade_no text,
  add column if not exists provider_trade_no text,
  add column if not exists raw_event jsonb not null default '{}'::jsonb,
  add column if not exists transition jsonb not null default '{}'::jsonb;

create unique index if not exists billing_events_provider_event_unique_idx
  on public.billing_events (provider, provider_event_id)
  where provider is not null and provider_event_id is not null;

create index if not exists billing_events_provider_created_idx
  on public.billing_events (provider, created_at desc)
  where provider is not null;
