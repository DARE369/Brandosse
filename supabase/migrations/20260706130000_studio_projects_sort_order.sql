-- Lets users manually reorder their studio_projects (campaign folders) in the
-- Studio session-history drawer, instead of being stuck with recency order.
-- "General" (ungrouped sessions, project_id IS NULL) is a client-side virtual
-- bucket, not a row in this table, and is always pinned first regardless of
-- sort_order — nothing to migrate for it.

ALTER TABLE public.studio_projects
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- Backfill existing rows so current recency order is preserved on first load
-- (otherwise every existing project would tie at sort_order=0 and re-sort by
-- whatever the DB happens to return them in).
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) - 1 AS rn
  FROM public.studio_projects
)
UPDATE public.studio_projects p
SET sort_order = ranked.rn
FROM ranked
WHERE p.id = ranked.id;

CREATE INDEX IF NOT EXISTS studio_projects_user_sort_idx
  ON public.studio_projects (user_id, sort_order);
