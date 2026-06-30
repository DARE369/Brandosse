-- ============================================================================
-- Migration: profiles_contact_and_activity_backfill
-- Date: 2026-03-13
-- Purpose:
--   1) Backfill profiles.email from auth.users for existing accounts
--   2) Backfill profiles.last_active_at from existing generation/post history
--   3) Refresh derived activity_status values after the backfill
-- ============================================================================

UPDATE public.profiles AS p
SET email = u.email
FROM auth.users AS u
WHERE p.id = u.id
  AND (p.email IS NULL OR btrim(p.email) = '')
  AND u.email IS NOT NULL;

WITH activity_candidates AS (
  SELECT
    p.id,
    GREATEST(
      COALESCE(p.last_active_at, p.created_at, to_timestamp(0)),
      COALESCE(g.latest_generation_at, to_timestamp(0)),
      COALESCE(posts.latest_post_at, to_timestamp(0))
    ) AS computed_last_active_at
  FROM public.profiles AS p
  LEFT JOIN (
    SELECT user_id, MAX(created_at) AS latest_generation_at
    FROM public.generations
    WHERE user_id IS NOT NULL
    GROUP BY user_id
  ) AS g
    ON g.user_id = p.id
  LEFT JOIN (
    SELECT user_id, MAX(created_at) AS latest_post_at
    FROM public.posts
    WHERE user_id IS NOT NULL
    GROUP BY user_id
  ) AS posts
    ON posts.user_id = p.id
)
UPDATE public.profiles AS p
SET last_active_at = a.computed_last_active_at
FROM activity_candidates AS a
WHERE p.id = a.id
  AND (
    p.last_active_at IS NULL
    OR p.last_active_at < a.computed_last_active_at
  );

SELECT public.refresh_profile_activity_statuses();
