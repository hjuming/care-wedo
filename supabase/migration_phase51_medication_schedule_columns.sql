alter table public.medications
  add column if not exists time_slot text,
  add column if not exists meal_timing text,
  add column if not exists scheduled_time text;

