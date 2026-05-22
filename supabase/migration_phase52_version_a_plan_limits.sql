-- Phase 52: align persisted plan rows with Version A pricing.
-- Keep legacy plan ids for existing references, but remove them from active plan choices.

insert into public.plans (
  id, name, monthly_ocr_limit, max_members, max_recipients,
  family_group_enabled, price_monthly_usd, is_active, sort_order
) values
  ('free', 'Free', 10, 1, 1, false, 0, true, 10),
  ('pro', '照護圈升級', 100, 2, 1, true, 30, true, 20),
  ('internal', 'Internal / Test', 99999, 99, 99, true, 0, true, 999)
on conflict (id) do update set
  name = excluded.name,
  monthly_ocr_limit = excluded.monthly_ocr_limit,
  max_members = excluded.max_members,
  max_recipients = excluded.max_recipients,
  family_group_enabled = excluded.family_group_enabled,
  price_monthly_usd = excluded.price_monthly_usd,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order;

update public.plans
set is_active = false,
    name = case id
      when 'basic' then 'Legacy Basic'
      when 'plus' then 'Legacy Plus'
      when 'team' then 'Legacy Team'
      else name
    end,
    sort_order = case id
      when 'basic' then 910
      when 'plus' then 920
      when 'team' then 930
      else sort_order
    end
where id in ('basic', 'plus', 'team');
