-- 20260901030000_video_cost_ledger.sql
--
-- LOCK L5.14 — the per-provider-call cost ledger.
--
-- ── Why this table is the keystone ──────────────────────────────────────────
-- `FAL_COST_USD` (supabase/functions/_shared/fal.service.ts) is explicitly
-- labelled "Cost estimates (informational)". Estimates cannot:
--
--   * detect a provider price change (the estimate simply goes on being wrong),
--   * measure the retry multiplier, because nothing records that a call WAS a
--     retry,
--   * reconcile against a provider invoice,
--   * support a per-user spend ceiling,
--   * tell you the real COGS of a delivered video.
--
-- Every cost control in the plan depends on this table existing. Without it
-- they are a spreadsheet, not a control system.
--
-- ── The one field that does the most work ───────────────────────────────────
-- `call_class` ('planned' | 'retry'). The retry multiplier R — the variable the
-- whole unit-economics model turns on — is unmeasurable without it, and it
-- cannot be reconstructed later from any other column.
--
-- ── Estimated AND actual, both stored ───────────────────────────────────────
-- Keeping both is what lets the estimator improve. The gap between them is
-- measurable, so a provider reprice shows up as estimate drift within a day
-- instead of as a margin surprise at month end. Static pricing -> calibrated
-- from observed cost -> predictive project quoting, in that order.

BEGIN;

CREATE TABLE IF NOT EXISTS public.video_cost_ledger (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Attribution. user_id is NOT NULL: a cost nobody owns cannot be attributed,
  -- and cost-per-user is this lock's actual title.
  user_id            uuid        NOT NULL,
  -- Free-text rather than an FK: costs come from several job systems
  -- (background_jobs, video_jobs) and an FK to one of them would either block
  -- the others or cascade-delete the financial record when a job is removed.
  -- A ledger that disappears with its job cannot be reconciled against an
  -- invoice that does not.
  job_id             text,
  generation_id      uuid,
  shot_id            uuid,

  -- What was bought.
  provider           text        NOT NULL,
  model_id           text        NOT NULL,
  model_version      text,

  -- planned | retry. See the note above; this is the field R is derived from.
  call_class         text        NOT NULL DEFAULT 'planned',

  -- How much of it. unit_type matters because $/second and $/megapixel are not
  -- comparable, and a bare number would silently mix them.
  units              numeric(12,4),
  unit_type          text,

  estimated_cost_usd numeric(12,6),
  actual_cost_usd    numeric(12,6),

  -- Provider's own id for the call, so a disputed line can be traced back.
  provider_job_id    text,

  status             text        NOT NULL DEFAULT 'recorded',
  error_message      text,

  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT video_cost_ledger_call_class_check
    CHECK (call_class IN ('planned', 'retry')),
  CONSTRAINT video_cost_ledger_status_check
    CHECK (status IN ('recorded', 'failed', 'refunded')),
  CONSTRAINT video_cost_ledger_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Cost-per-user over a window is the most common read; model_id + created_at
-- backs the price-drift check; job_id backs per-job COGS.
CREATE INDEX IF NOT EXISTS video_cost_ledger_user_created_idx
  ON public.video_cost_ledger (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS video_cost_ledger_model_created_idx
  ON public.video_cost_ledger (model_id, created_at DESC);
CREATE INDEX IF NOT EXISTS video_cost_ledger_job_idx
  ON public.video_cost_ledger (job_id);

COMMENT ON TABLE public.video_cost_ledger IS
  'LOCK L5.14. One row per provider call. Written only by service-role edge '
  'functions via _shared/costLedger.ts. call_class is what makes the retry '
  'multiplier measurable; estimated + actual together are what let the '
  'estimator calibrate itself.';

ALTER TABLE public.video_cost_ledger ENABLE ROW LEVEL SECURITY;

-- Owner read-only, matching the background_jobs pattern. There is deliberately
-- NO write policy for `authenticated`: RLS-enabled-with-no-write-policy denies
-- every non-service-role write by construction. A user who could insert here
-- could forge their own spend record.
DROP POLICY IF EXISTS "Users or admins read own cost ledger" ON public.video_cost_ledger;
CREATE POLICY "Users or admins read own cost ledger"
  ON public.video_cost_ledger FOR SELECT
  USING (
    auth.uid() = user_id
    OR public.is_admin_user(auth.uid())
  );

-- ── Post-condition ─────────────────────────────────────────────────────────
-- Assert the end state rather than assuming the DDL above took effect. The
-- write-policy check is the important one: this table is financial evidence,
-- and a permissive INSERT policy appearing here later would let a user forge
-- their own spend record.
DO $$
DECLARE
  col_count   int;
  write_pols  int;
  read_pols   int;
  rls_on      boolean;
BEGIN
  SELECT count(*) INTO col_count
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'video_cost_ledger'
    AND column_name IN ('user_id', 'call_class', 'estimated_cost_usd',
                        'actual_cost_usd', 'model_id', 'provider');
  IF col_count <> 6 THEN
    RAISE EXCEPTION
      'post-condition failed: video_cost_ledger is missing required columns (found % of 6)',
      col_count;
  END IF;

  SELECT relrowsecurity INTO rls_on
  FROM pg_class WHERE oid = 'public.video_cost_ledger'::regclass;
  IF NOT rls_on THEN
    RAISE EXCEPTION 'post-condition failed: RLS is not enabled on video_cost_ledger';
  END IF;

  SELECT count(*) INTO write_pols
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'video_cost_ledger'
    AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL');
  IF write_pols <> 0 THEN
    RAISE EXCEPTION
      'post-condition failed: video_cost_ledger has % write policy/policies. '
      'This table is financial evidence; only the service role may write to it.',
      write_pols;
  END IF;

  SELECT count(*) INTO read_pols
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'video_cost_ledger' AND cmd = 'SELECT';
  IF read_pols < 1 THEN
    RAISE EXCEPTION
      'post-condition failed: video_cost_ledger has no SELECT policy, so owners cannot read their own spend';
  END IF;
END $$;

COMMIT;
