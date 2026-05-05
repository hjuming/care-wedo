-- Migration: Phase 4.6 — User Feature Flags
-- Adds user-level feature flags for development-only capabilities such as
-- creating multiple family groups. Group plans remain group-level.
-- Idempotent: safe to re-run multiple times.

-- ── 1. user_feature_flags 主表 ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_feature_flags (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. unique(user_id, feature_key)（idempotent）──────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   information_schema.table_constraints
    WHERE  table_schema    = 'public'
      AND  table_name      = 'user_feature_flags'
      AND  constraint_type = 'UNIQUE'
      AND  constraint_name = 'user_feature_flags_user_feature_key'
  ) THEN
    ALTER TABLE public.user_feature_flags
      ADD CONSTRAINT user_feature_flags_user_feature_key
        UNIQUE (user_id, feature_key);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS user_feature_flags_user_id_idx
  ON public.user_feature_flags (user_id);

ALTER TABLE public.user_feature_flags ENABLE ROW LEVEL SECURITY;

-- ── 3. 日月MING feature flag 設定範例（請在確認 USER_ID 後手動執行）─────────────
-- SELECT id, name, line_user_id
-- FROM public.users
-- WHERE name ILIKE '%MING%'
--    OR name ILIKE '%日月%'
--    OR line_user_id = 'U4907016919ebe34bd121004ac9cc5829';
--
-- INSERT INTO public.user_feature_flags (user_id, feature_key, enabled)
-- VALUES (<USER_ID>, 'multiple_family_groups', true)
-- ON CONFLICT (user_id, feature_key)
-- DO UPDATE SET
--   enabled = EXCLUDED.enabled,
--   updated_at = NOW();

-- ── 4. Rollback 備忘（不自動執行）──────────────────────────────────────────────
-- DROP TABLE IF EXISTS public.user_feature_flags;
