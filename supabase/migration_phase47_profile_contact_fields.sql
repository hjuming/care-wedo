alter table public.care_profiles
  add column if not exists emergency_phone text,
  add column if not exists email text;
