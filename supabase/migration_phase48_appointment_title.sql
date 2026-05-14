-- Phase 48: keep reminder title separate from department/category.
alter table public.appointments
  add column if not exists title text;
