-- Phase 53: align Care WEDO family group caps with Version A product limits.
-- Per family group: 1 owner + 5 paid collaborators, 4 primary care recipients.

update public.plans
set max_members = 6,
    max_recipients = 4,
    monthly_ocr_limit = 100,
    family_group_enabled = true,
    price_monthly_usd = 30,
    is_active = true,
    sort_order = 20
where id = 'pro';
