-- Phase 59: defensive read-only RLS policies for Care WEDO protected data.
--
-- Cloudflare Functions still use service_role and therefore bypass RLS.
-- These policies are the database-level fallback for authenticated direct reads;
-- direct writes remain service-role-only and are still enforced by Functions.

alter table public.users enable row level security;
alter table public.user_feature_flags enable row level security;
alter table public.family_groups enable row level security;
alter table public.care_profiles enable row level security;
alter table public.user_family_groups enable row level security;
alter table public.appointments enable row level security;
alter table public.medications enable row level security;
alter table public.medication_logs enable row level security;
alter table public.care_documents enable row level security;
alter table public.usage_quotas enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.billing_events enable row level security;
alter table public.invoices enable row level security;
alter table public.line_push_logs enable row level security;
alter table storage.objects enable row level security;

create or replace function public.care_wedo_current_user_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from public.users u
  where u.auth_user_id = (select auth.uid())
  limit 1
$$;

create or replace function public.care_wedo_has_group_access(target_group_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    target_group_id is not null
    and exists (
      select 1
      from public.user_family_groups ufg
      join public.users u on u.id = ufg.user_id
      where u.auth_user_id = (select auth.uid())
        and ufg.group_id = target_group_id
    ),
    false
  )
$$;

create or replace function public.care_wedo_can_access_storage_object(target_bucket_id text, object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    target_bucket_id = 'care-documents'
    and object_name ~ '^group-[0-9]+/profile-[0-9]+/[0-9]{4}-[0-9]{2}/[0-9a-f-]+\.(pdf|jpg|png|webp)$'
    and public.care_wedo_has_group_access(substring(object_name from '^group-([0-9]+)/')::bigint),
    false
  )
$$;

revoke all on function public.care_wedo_current_user_id() from public;
revoke all on function public.care_wedo_has_group_access(bigint) from public;
revoke all on function public.care_wedo_can_access_storage_object(text, text) from public;
grant execute on function public.care_wedo_current_user_id() to authenticated, service_role;
grant execute on function public.care_wedo_has_group_access(bigint) to authenticated, service_role;
grant execute on function public.care_wedo_can_access_storage_object(text, text) to authenticated, service_role;

revoke insert, update, delete on public.users from anon, authenticated;
revoke insert, update, delete on public.user_feature_flags from anon, authenticated;
revoke insert, update, delete on public.family_groups from anon, authenticated;
revoke insert, update, delete on public.care_profiles from anon, authenticated;
revoke insert, update, delete on public.user_family_groups from anon, authenticated;
revoke insert, update, delete on public.appointments from anon, authenticated;
revoke insert, update, delete on public.medications from anon, authenticated;
revoke insert, update, delete on public.medication_logs from anon, authenticated;
revoke insert, update, delete on public.care_documents from anon, authenticated;
revoke insert, update, delete on public.usage_quotas from anon, authenticated;
revoke insert, update, delete on public.billing_subscriptions from anon, authenticated;
revoke insert, update, delete on public.billing_events from anon, authenticated;
revoke insert, update, delete on public.invoices from anon, authenticated;
revoke insert, update, delete on public.line_push_logs from anon, authenticated;
revoke insert, update, delete on storage.objects from anon, authenticated;

drop policy if exists care_wedo_users_self_select on public.users;
create policy care_wedo_users_self_select
on public.users
for select
to authenticated
using (id = (select public.care_wedo_current_user_id()));

drop policy if exists care_wedo_user_feature_flags_self_select on public.user_feature_flags;
create policy care_wedo_user_feature_flags_self_select
on public.user_feature_flags
for select
to authenticated
using (user_id = (select public.care_wedo_current_user_id()));

drop policy if exists care_wedo_family_groups_member_select on public.family_groups;
create policy care_wedo_family_groups_member_select
on public.family_groups
for select
to authenticated
using (
  owner_user_id = (select public.care_wedo_current_user_id())
  or (select public.care_wedo_has_group_access(id))
);

drop policy if exists care_wedo_user_family_groups_member_select on public.user_family_groups;
create policy care_wedo_user_family_groups_member_select
on public.user_family_groups
for select
to authenticated
using ((select public.care_wedo_has_group_access(group_id)));

drop policy if exists care_wedo_care_profiles_group_select on public.care_profiles;
create policy care_wedo_care_profiles_group_select
on public.care_profiles
for select
to authenticated
using ((select public.care_wedo_has_group_access(group_id)));

drop policy if exists care_wedo_appointments_group_select on public.appointments;
create policy care_wedo_appointments_group_select
on public.appointments
for select
to authenticated
using ((select public.care_wedo_has_group_access(group_id)));

drop policy if exists care_wedo_medications_group_select on public.medications;
create policy care_wedo_medications_group_select
on public.medications
for select
to authenticated
using ((select public.care_wedo_has_group_access(group_id)));

drop policy if exists care_wedo_medication_logs_group_select on public.medication_logs;
create policy care_wedo_medication_logs_group_select
on public.medication_logs
for select
to authenticated
using ((select public.care_wedo_has_group_access(group_id)));

drop policy if exists care_wedo_care_documents_group_select on public.care_documents;
create policy care_wedo_care_documents_group_select
on public.care_documents
for select
to authenticated
using ((select public.care_wedo_has_group_access(group_id)));

drop policy if exists care_wedo_usage_quotas_group_select on public.usage_quotas;
create policy care_wedo_usage_quotas_group_select
on public.usage_quotas
for select
to authenticated
using ((select public.care_wedo_has_group_access(group_id)));

drop policy if exists care_wedo_billing_subscriptions_group_select on public.billing_subscriptions;
create policy care_wedo_billing_subscriptions_group_select
on public.billing_subscriptions
for select
to authenticated
using ((select public.care_wedo_has_group_access(family_group_id)));

drop policy if exists care_wedo_billing_events_group_select on public.billing_events;
create policy care_wedo_billing_events_group_select
on public.billing_events
for select
to authenticated
using ((select public.care_wedo_has_group_access(family_group_id)));

drop policy if exists care_wedo_invoices_group_select on public.invoices;
create policy care_wedo_invoices_group_select
on public.invoices
for select
to authenticated
using ((select public.care_wedo_has_group_access(family_group_id)));

drop policy if exists care_wedo_line_push_logs_group_or_recipient_select on public.line_push_logs;
create policy care_wedo_line_push_logs_group_or_recipient_select
on public.line_push_logs
for select
to authenticated
using (
  recipient_user_id = (select public.care_wedo_current_user_id())
  or (select public.care_wedo_has_group_access(group_id))
);

drop policy if exists care_wedo_storage_objects_read_care_documents on storage.objects;
create policy care_wedo_storage_objects_read_care_documents
on storage.objects
for select
to authenticated
using ((select public.care_wedo_can_access_storage_object(bucket_id, name)));
