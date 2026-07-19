-- ============================================================================
-- Migration: fail_undispatchable_scheduled_posts
-- Purpose:
--   process_scheduled_posts() only ever looks at rows it can successfully
--   JOIN to an active connected_accounts row (by account_id, or by platform
--   when account_id is null). Any scheduled post that can never satisfy that
--   join — no target account was ever selected, or the account it targets
--   has since been revoked/deleted — is silently skipped by every run,
--   forever. Nothing ever marks it failed, so it just sits as status =
--   'scheduled' indefinitely with no error shown anywhere in the UI. This
--   was live-confirmed: ~20 scheduled posts in the live DB have account_id
--   AND platform both null (schedulable via the Studio "Schedule" dialog
--   without ever picking a target platform — a UI gap fixed separately in
--   SessionStore.js/StudioPage.jsx), plus a dozen more scheduled against a
--   revoked connected_accounts row.
--
--   Fix: process_scheduled_posts() now also scans ALL rows with
--   status = 'scheduled' (not just due ones — a revoked account should be
--   caught immediately, not only once scheduled_at arrives) for exactly the
--   "can never match any active account" condition, and fails them with a
--   clear, specific error_message instead of leaving them silently stuck.
--   This runs every minute alongside the existing dispatch loop, at
--   negligible cost given table size.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.process_scheduled_posts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  -- ── Dispatch due posts that resolve to an active connected account ───────
  FOR r IN
    SELECT
      p.id              AS post_id,
      p.user_id,
      p.organization_id,
      p.platform,
      ca.id             AS account_id
    FROM posts p
    INNER JOIN connected_accounts ca
      ON  ca.user_id   = p.user_id
      AND ca.connection_status = 'active'
      AND ca.deleted_at IS NULL
      AND (
        (p.account_id IS NOT NULL AND ca.id = p.account_id)
        OR (
          p.account_id IS NULL
          AND ca.platform = p.platform
          AND (
            (p.organization_id IS NULL AND ca.organization_id IS NULL)
            OR ca.organization_id = p.organization_id
          )
        )
      )
    WHERE
      p.status        = 'scheduled'
      AND p.scheduled_at <= now()
      -- Cap: process at most 50 posts per run to avoid overload
    LIMIT 50
  LOOP
    -- Mark as publishing immediately to prevent duplicate dispatch
    UPDATE posts
    SET
      status     = 'publishing',
      updated_at = now()
    WHERE
      id     = r.post_id
      AND status = 'scheduled';  -- only update if still scheduled (race guard)

    IF FOUND THEN
      PERFORM public.dispatch_scheduled_post(
        r.post_id,
        r.account_id,
        r.user_id,
        r.organization_id
      );
    END IF;
  END LOOP;

  -- ── Fail scheduled posts that can never match any active account ─────────
  -- Same match condition as above, inverted (NOT EXISTS) — catches "no
  -- target account was ever selected" and "the target account was revoked/
  -- deleted after scheduling" regardless of whether scheduled_at has
  -- arrived yet, so these surface as a visible failure instead of silently
  -- rotting as "scheduled" forever.
  UPDATE posts p
  SET
    status        = 'failed',
    error_message = 'No active connected account could be matched for this scheduled post. Reselect a target platform and reschedule.',
    failed_at     = now(),
    updated_at    = now()
  WHERE
    p.status = 'scheduled'
    AND NOT EXISTS (
      SELECT 1
      FROM connected_accounts ca
      WHERE ca.user_id = p.user_id
        AND ca.connection_status = 'active'
        AND ca.deleted_at IS NULL
        AND (
          (p.account_id IS NOT NULL AND ca.id = p.account_id)
          OR (
            p.account_id IS NULL
            AND p.platform IS NOT NULL
            AND ca.platform = p.platform
            AND (
              (p.organization_id IS NULL AND ca.organization_id IS NULL)
              OR ca.organization_id = p.organization_id
            )
          )
        )
    );
END;
$$;

-- ── One-time backfill: fail the posts already stuck in this state ──────────
UPDATE posts p
SET
  status        = 'failed',
  error_message = 'No active connected account could be matched for this scheduled post. Reselect a target platform and reschedule.',
  failed_at     = now(),
  updated_at    = now()
WHERE
  p.status = 'scheduled'
  AND NOT EXISTS (
    SELECT 1
    FROM connected_accounts ca
    WHERE ca.user_id = p.user_id
      AND ca.connection_status = 'active'
      AND ca.deleted_at IS NULL
      AND (
        (p.account_id IS NOT NULL AND ca.id = p.account_id)
        OR (
          p.account_id IS NULL
          AND p.platform IS NOT NULL
          AND ca.platform = p.platform
          AND (
            (p.organization_id IS NULL AND ca.organization_id IS NULL)
            OR ca.organization_id = p.organization_id
          )
        )
      )
  );
