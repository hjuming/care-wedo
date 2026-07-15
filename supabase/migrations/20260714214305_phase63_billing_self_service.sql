-- Phase 63: customer self-service subscription controls and auditable history.
-- Provider cancellation must be confirmed before the local state is changed.

alter table public.billing_subscriptions
  add column if not exists provider text,
  add column if not exists provider_merchant_trade_no text,
  add column if not exists provider_trade_no text,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists canceled_at timestamptz,
  add column if not exists cancel_reason text;

create index if not exists billing_subscriptions_provider_trade_idx
  on public.billing_subscriptions (provider, provider_merchant_trade_no)
  where provider is not null and provider_merchant_trade_no is not null;

create index if not exists billing_events_family_provider_created_idx
  on public.billing_events (family_group_id, provider, created_at desc)
  where provider is not null;
