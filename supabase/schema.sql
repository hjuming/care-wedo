create table if not exists public.users (
  id bigserial primary key,
  line_user_id text unique,
  name text,
  created_at timestamptz not null default now()
);

create table if not exists public.family_groups (
  id bigserial primary key,
  name text,
  invite_code text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.user_family_groups (
  user_id bigint not null references public.users(id) on delete cascade,
  group_id bigint not null references public.family_groups(id) on delete cascade,
  role text not null default 'member',
  primary key (user_id, group_id)
);

create table if not exists public.appointments (
  id bigserial primary key,
  user_id bigint references public.users(id) on delete cascade,
  type text,
  date text,
  time text,
  hospital text,
  department text,
  doctor text,
  number text,
  location text,
  fasting_required boolean not null default false,
  fasting_hours integer,
  notes text,
  reminder_text text,
  status text not null default 'upcoming',
  created_at timestamptz not null default now()
);

create table if not exists public.medications (
  id bigserial primary key,
  user_id bigint references public.users(id) on delete cascade,
  name text,
  dosage text,
  frequency text,
  purpose text,
  warnings text,
  reminder_text text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists appointments_status_date_idx
  on public.appointments (status, date, created_at desc);

create index if not exists medications_active_created_at_idx
  on public.medications (active, created_at desc);

alter table public.users enable row level security;
alter table public.family_groups enable row level security;
alter table public.user_family_groups enable row level security;
alter table public.appointments enable row level security;
alter table public.medications enable row level security;
