-- Phase 62: use the authenticated user's identity for the first care profile.
-- Runtime creation already supplies the name/avatar; this keeps direct inserts aligned.

alter table public.care_profiles
  alter column display_name set default '照護對象';
