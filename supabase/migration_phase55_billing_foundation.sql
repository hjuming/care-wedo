-- Phase 55: billing data foundation for Care WEDO paid care-circle actions.
-- Keep these tables service-role only until the formal payment UI/API is ready.

create table if not exists public.billing_subscriptions (
  id bigserial primary key,
  family_group_id bigint not null references public.family_groups(id) on delete cascade,
  owner_user_id bigint references public.users(id) on delete set null,
  plan_id text not null default 'pro' references public.plans(id),
  status text not null default 'beta',
  currency text not null default 'TWD',
  care_profile_count integer not null default 0 check (care_profile_count >= 0),
  paid_collaborator_count integer not null default 0 check (paid_collaborator_count >= 0),
  estimated_monthly_amount integer not null default 0 check (estimated_monthly_amount >= 0),
  billing_anchor_day integer check (billing_anchor_day between 1 and 31),
  current_period_start date,
  current_period_end date,
  trial_ends_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(family_group_id)
);

create table if not exists public.billing_events (
  id bigserial primary key,
  family_group_id bigint not null references public.family_groups(id) on delete cascade,
  subscription_id bigint references public.billing_subscriptions(id) on delete set null,
  actor_user_id bigint references public.users(id) on delete set null,
  subject_user_id bigint references public.users(id) on delete set null,
  care_profile_id bigint references public.care_profiles(id) on delete set null,
  event_type text not null,
  amount_delta integer not null default 0,
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id bigserial primary key,
  family_group_id bigint not null references public.family_groups(id) on delete cascade,
  subscription_id bigint references public.billing_subscriptions(id) on delete set null,
  owner_user_id bigint references public.users(id) on delete set null,
  period text not null,
  status text not null default 'draft',
  currency text not null default 'TWD',
  care_profile_count integer not null default 0,
  paid_collaborator_count integer not null default 0,
  amount_due integer not null default 0,
  line_items jsonb not null default '[]'::jsonb,
  issued_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique(family_group_id, period)
);

create index if not exists billing_subscriptions_family_group_idx
  on public.billing_subscriptions (family_group_id);

create index if not exists billing_events_family_created_idx
  on public.billing_events (family_group_id, created_at desc);

create index if not exists billing_events_type_created_idx
  on public.billing_events (event_type, created_at desc);

create index if not exists invoices_family_period_idx
  on public.invoices (family_group_id, period);

alter table public.billing_subscriptions enable row level security;
alter table public.billing_events enable row level security;
alter table public.invoices enable row level security;

revoke all on public.billing_subscriptions from anon, authenticated;
revoke all on public.billing_events from anon, authenticated;
revoke all on public.invoices from anon, authenticated;

grant select, insert, update, delete on public.billing_subscriptions to service_role;
grant select, insert, update, delete on public.billing_events to service_role;
grant select, insert, update, delete on public.invoices to service_role;

grant usage, select on sequence public.billing_subscriptions_id_seq to service_role;
grant usage, select on sequence public.billing_events_id_seq to service_role;
grant usage, select on sequence public.invoices_id_seq to service_role;
