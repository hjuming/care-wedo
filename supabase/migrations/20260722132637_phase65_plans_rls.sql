-- Phase 65: keep the server-owned plan catalog out of the public API surface.
--
-- Cloudflare Functions read this table with service_role. Browser clients do
-- not need direct access, so no anon/authenticated policy is intentionally
-- defined.

alter table public.plans enable row level security;

revoke all on public.plans from anon, authenticated;
grant select on public.plans to service_role;
