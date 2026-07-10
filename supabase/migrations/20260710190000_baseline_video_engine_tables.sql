-- ============================================================================
-- Migration: baseline_video_engine_tables
-- Purpose (Phase 7 finding #6): video_jobs, video_clips, and video_transcripts
--   originate from supabase/video-engine-stage-1-schema.sql — a real CREATE
--   TABLE script that lives in the repo but was "run manually in the SQL
--   Editor" per its own header, never through supabase/migrations/. Same
--   untracked-schema drift risk that user_credits/credit_transactions had
--   (see the Phase 6 baseline migration) — this closes it for the
--   remaining three video-engine tables.
--
--   CREATE TABLE IF NOT EXISTS — no-op on the live database where these
--   tables already exist; this is documentation, not a schema change.
--   Column list transcribed verbatim from video-engine-stage-1-schema.sql,
--   cross-referenced against src/lib/video-engine/types.ts.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.video_jobs (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_url            text NOT NULL,
  source_platform       text NOT NULL CHECK (source_platform IN ('youtube', 'twitter', 'upload')),
  status                text NOT NULL DEFAULT 'queued' CHECK (status IN (
                          'queued', 'downloading', 'transcribing',
                          'analyzing', 'rendering', 'complete', 'failed'
                        )),
  error_message         text,
  error_stage           text,
  source_title          text,
  source_duration_secs  integer,
  credits_consumed      integer,
  processing_started_at timestamptz,
  processing_ended_at   timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  aspect_ratio          varchar,
  caption_style         varchar,
  clip_count_target     integer,
  min_duration_secs     integer,
  max_duration_secs     integer,
  specific_moments      text,
  download_progress     float8,
  stitched_output_url   text  -- [MIGRATION-TRACKED 20260622000002_video_jobs_stitched_url.sql]
);

ALTER TABLE public.video_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own jobs" ON public.video_jobs;
CREATE POLICY "Users can view own jobs"
  ON public.video_jobs FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own jobs" ON public.video_jobs;
CREATE POLICY "Users can insert own jobs"
  ON public.video_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users cannot update jobs directly" ON public.video_jobs;
CREATE POLICY "Users cannot update jobs directly"
  ON public.video_jobs FOR UPDATE
  USING (false);

DROP POLICY IF EXISTS "Users can delete own jobs" ON public.video_jobs;
CREATE POLICY "Users can delete own jobs"
  ON public.video_jobs FOR DELETE
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.video_clips (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id              uuid NOT NULL REFERENCES public.video_jobs(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  clip_index          integer NOT NULL,
  ai_title            text,
  ai_caption          text,
  hook_score          numeric,
  content_score       numeric,
  overall_score       numeric,
  start_time_secs     numeric(10,3) NOT NULL,
  end_time_secs       numeric(10,3) NOT NULL,
  duration_secs       numeric(10,3),
  storage_path        text,
  public_url          text,
  thumbnail_path      text,
  thumbnail_url       text,
  transcript_excerpt  text,
  platform_target     text CHECK (platform_target IN ('tiktok', 'reels', 'shorts', 'universal')),
  render_status       text NOT NULL DEFAULT 'pending' CHECK (render_status IN (
                          'pending', 'rendering', 'complete', 'failed'
                        )),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  flow_score          float8,
  trend_score         float8,
  why_this_works      text,
  error_message       text
);

ALTER TABLE public.video_clips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own clips" ON public.video_clips;
CREATE POLICY "Users can view own clips"
  ON public.video_clips FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users cannot insert clips directly" ON public.video_clips;
CREATE POLICY "Users cannot insert clips directly"
  ON public.video_clips FOR INSERT
  WITH CHECK (false);

DROP POLICY IF EXISTS "Users cannot update clips directly" ON public.video_clips;
CREATE POLICY "Users cannot update clips directly"
  ON public.video_clips FOR UPDATE
  USING (false);

DROP POLICY IF EXISTS "Users can delete own clips" ON public.video_clips;
CREATE POLICY "Users can delete own clips"
  ON public.video_clips FOR DELETE
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.video_transcripts (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id            uuid NOT NULL UNIQUE REFERENCES public.video_jobs(id) ON DELETE CASCADE,
  user_id           uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  raw_transcript    jsonb NOT NULL,
  word_segments     jsonb,
  speaker_segments  jsonb,
  detected_language text,
  word_error_notes  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  duration          float8,
  full_text         text,
  language          text
);

ALTER TABLE public.video_transcripts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own transcripts" ON public.video_transcripts;
CREATE POLICY "Users can view own transcripts"
  ON public.video_transcripts FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users cannot modify transcripts" ON public.video_transcripts;
CREATE POLICY "Users cannot modify transcripts"
  ON public.video_transcripts FOR INSERT
  WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at_video_jobs ON public.video_jobs;
CREATE TRIGGER set_updated_at_video_jobs
  BEFORE UPDATE ON public.video_jobs
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_video_clips ON public.video_clips;
CREATE TRIGGER set_updated_at_video_clips
  BEFORE UPDATE ON public.video_clips
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
