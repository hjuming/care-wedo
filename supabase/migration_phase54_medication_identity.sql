alter table public.medications
  add column if not exists normalized_name text,
  add column if not exists brand_name text,
  add column if not exists generic_name text,
  add column if not exists drug_code text,
  add column if not exists dosage_text text,
  add column if not exists identity_confidence numeric,
  add column if not exists duplicate_candidate_ids jsonb not null default '[]'::jsonb;

create index if not exists medications_profile_normalized_name_idx
  on public.medications (profile_id, normalized_name)
  where normalized_name is not null;

create index if not exists medications_profile_drug_code_idx
  on public.medications (profile_id, drug_code)
  where drug_code is not null;
