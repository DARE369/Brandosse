ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS assigned_moderator_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_posts_assigned_moderator_status_created
  ON public.posts(assigned_moderator_id, moderation_status, created_at DESC);
