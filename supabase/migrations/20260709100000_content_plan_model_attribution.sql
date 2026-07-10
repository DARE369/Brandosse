-- ============================================================================
-- Migration: content_plan_model_attribution
-- Purpose:
--   content_plans.groq_model was being written as a hardcoded literal
--   ('llama-3.3-70b-versatile') regardless of which provider/model actually
--   served the request (generate-content-plan prefers Groq but silently
--   falls back to Claude 3.5 Sonnet on failure). This made the column
--   unusable for cost/quality analysis. Going forward:
--     - groq_model holds the ACTUAL model id that generated the plan
--     - plan_provider holds the actual provider ('groq' | 'anthropic')
--     - revision_provider / revision_model record which model performed the
--       quality-gate auto-revision, when one happened (previously untracked)
-- Notes:
--   - Non-destructive: additive columns only, no drops, no backfill required
--     (existing rows keep their — now known to be unreliable — groq_model
--     value; new rows are accurate from the app-code change in the same
--     changeset as this migration).
-- ============================================================================

ALTER TABLE public.content_plans
  ADD COLUMN IF NOT EXISTS plan_provider     text,
  ADD COLUMN IF NOT EXISTS revision_provider text,
  ADD COLUMN IF NOT EXISTS revision_model    text;

COMMENT ON COLUMN public.content_plans.groq_model IS
  'Actual model id that served this content plan (Groq or Anthropic fallback) — not necessarily Groq despite the column name. See plan_provider for which.';
COMMENT ON COLUMN public.content_plans.plan_provider IS
  'Actual provider that served this content plan: ''groq'' or ''anthropic''.';
COMMENT ON COLUMN public.content_plans.revision_provider IS
  'Provider that performed the quality-gate auto-revision, if one occurred.';
COMMENT ON COLUMN public.content_plans.revision_model IS
  'Model that performed the quality-gate auto-revision, if one occurred.';
