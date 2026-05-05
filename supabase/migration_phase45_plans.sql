-- Migration: Phase 4.5 — Plans & Permissions
-- Creates the plans table, seeds all plan tiers, and extends family_groups with plan_id.
-- Idempotent: safe to re-run multiple times.

-- ── 1. plans 主表 ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.plans (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  monthly_ocr_limit    INTEGER NOT NULL,
  max_members          INTEGER NOT NULL,
  max_recipients       INTEGER NOT NULL,
  family_group_enabled BOOLEAN NOT NULL DEFAULT false,
  price_monthly_usd    NUMERIC(8, 2) NOT NULL DEFAULT 0,
  is_active            BOOLEAN NOT NULL DEFAULT true,
  sort_order           INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. Seed 方案資料（ON CONFLICT 保持冪等）────────────────────────────────────

INSERT INTO public.plans (
  id, name, monthly_ocr_limit, max_members, max_recipients,
  family_group_enabled, price_monthly_usd, sort_order
) VALUES
  ('free',     'Free',            10,    1,  1,  false,  0,   10),
  ('basic',    'Family Basic',    30,    2,  1,  true,   1,   20),
  ('plus',     'Family Plus',     50,    5,  2,  true,   3,   30),
  ('pro',      'Family Pro',     100,    8,  4,  true,   5,   40),
  ('team',     'Care Team',      200,   15,  8,  true,  10,   50),
  ('internal', 'Internal / Test', 99999, 99, 99, true,   0,  999)
ON CONFLICT (id) DO UPDATE SET
  name                 = EXCLUDED.name,
  monthly_ocr_limit    = EXCLUDED.monthly_ocr_limit,
  max_members          = EXCLUDED.max_members,
  max_recipients       = EXCLUDED.max_recipients,
  family_group_enabled = EXCLUDED.family_group_enabled,
  price_monthly_usd    = EXCLUDED.price_monthly_usd,
  sort_order           = EXCLUDED.sort_order;

-- ── 3. family_groups 補方案欄位 ───────────────────────────────────────────────

ALTER TABLE public.family_groups
  ADD COLUMN IF NOT EXISTS plan_id        TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS plan_started_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ;

-- ── 4. 補 FK plan_id → plans.id（idempotent，透過 information_schema 判斷）───

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   information_schema.key_column_usage  kcu
    JOIN   information_schema.table_constraints tc
      ON   kcu.constraint_name = tc.constraint_name
      AND  kcu.table_schema    = tc.table_schema
    WHERE  tc.constraint_type = 'FOREIGN KEY'
      AND  kcu.table_schema   = 'public'
      AND  kcu.table_name     = 'family_groups'
      AND  kcu.column_name    = 'plan_id'
  ) THEN
    ALTER TABLE public.family_groups
      ADD CONSTRAINT family_groups_plan_id_fk
        FOREIGN KEY (plan_id) REFERENCES public.plans(id);
  END IF;
END $$;

-- ── 5. Rollback 備忘（不自動執行）──────────────────────────────────────────────
-- ALTER TABLE public.family_groups
--   DROP COLUMN IF EXISTS plan_id,
--   DROP COLUMN IF EXISTS plan_started_at,
--   DROP COLUMN IF EXISTS plan_expires_at;
-- DROP TABLE IF EXISTS public.plans;
