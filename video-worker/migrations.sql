-- Pack 1: Real AI Pipeline Database Migration
-- Run these commands in Supabase SQL Editor

-- Add flow_score column to video_clips
ALTER TABLE video_clips
ADD COLUMN IF NOT EXISTS flow_score FLOAT DEFAULT 0.7;

-- Add trend_score column to video_clips
ALTER TABLE video_clips
ADD COLUMN IF NOT EXISTS trend_score FLOAT DEFAULT 0.7;

-- Add why_this_works column to video_clips
ALTER TABLE video_clips
ADD COLUMN IF NOT EXISTS why_this_works TEXT;

-- Create index on overall_score for sorting
CREATE INDEX IF NOT EXISTS idx_clips_score ON video_clips(job_id, overall_score DESC);

-- Update video_transcripts table to store duration
ALTER TABLE video_transcripts
ADD COLUMN IF NOT EXISTS duration FLOAT;

-- Done! New schema is ready for Pack 1
-- video_clips now has: hook_score, flow_score, content_score, trend_score, overall_score


-- Pack 10: Clip error messages
-- Run this command in Supabase SQL Editor

-- Add error_message column to video_clips. render.py already passes the
-- caught exception's str(e) into mark_clip_render_failed(); this column is
-- where it gets persisted so the frontend can show the real failure reason
-- instead of a generic "Render failed" fallback.
ALTER TABLE video_clips
ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Optional: confirm video_jobs and video_clips are in the Realtime publication.
-- useJobRealtime.js subscribes to postgres_changes on both tables and falls
-- back to 3s polling regardless, so this is a nice-to-have, not required.
-- If the SELECT below returns no rows for a table, run the matching ALTER:
--   SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
--   ALTER PUBLICATION supabase_realtime ADD TABLE video_jobs;
--   ALTER PUBLICATION supabase_realtime ADD TABLE video_clips;


-- ============================================================
-- CRITICAL FIX — run this before ANY job can succeed.
-- ============================================================
-- The base schema stored scores as NUMERIC(4,3) with CHECK (value <= 1),
-- expecting 0-1 floats. The worker inserts 0-100 integers (e.g. 82).
-- Every INSERT hits the CHECK constraint and fails silently, which is why
-- the Analyzing stage always raised "No valid clips could be created."
--
-- This migration:
--   1. Drops the broken 0-1 constraints on hook_score / content_score / overall_score
--   2. Converts those columns to INTEGER (matching how the worker stores them)
--   3. Safely converts any existing 0-1 rows to 0-100 scale
--   4. Adds download_progress to video_jobs (used by the progress bar UI)
-- All statements are idempotent — safe to re-run.

-- 1. Fix hook_score
ALTER TABLE video_clips DROP CONSTRAINT IF EXISTS video_clips_hook_score_check;
ALTER TABLE video_clips
  ALTER COLUMN hook_score TYPE INTEGER
  USING COALESCE(ROUND(
    CASE WHEN hook_score > 1 THEN hook_score
         ELSE hook_score * 100
    END
  )::INTEGER, 0);

-- 2. Fix content_score
ALTER TABLE video_clips DROP CONSTRAINT IF EXISTS video_clips_content_score_check;
ALTER TABLE video_clips
  ALTER COLUMN content_score TYPE INTEGER
  USING COALESCE(ROUND(
    CASE WHEN content_score > 1 THEN content_score
         ELSE content_score * 100
    END
  )::INTEGER, 0);

-- 3. Fix overall_score
ALTER TABLE video_clips DROP CONSTRAINT IF EXISTS video_clips_overall_score_check;
ALTER TABLE video_clips
  ALTER COLUMN overall_score TYPE INTEGER
  USING COALESCE(ROUND(
    CASE WHEN overall_score > 1 THEN overall_score
         ELSE overall_score * 100
    END
  )::INTEGER, 0);

-- 4. Add download_progress to video_jobs (for the downloading-stage progress bar)
ALTER TABLE video_jobs
  ADD COLUMN IF NOT EXISTS download_progress FLOAT DEFAULT 0;

-- Done. video_clips scores now accept 0-100 integers; video_jobs tracks download %.


-- ============================================================
-- TRANSCRIPTS FIX — run this to enable captions in rendered clips.
-- ============================================================
-- The base schema's video_transcripts table was designed for an older worker
-- that stored raw_transcript / detected_language.  The current transcribe.py
-- stores full_text / language / duration instead.  The columns were missing,
-- so every transcript upsert failed silently, leaving word_segments empty,
-- which caused "Captions will be skipped for all clips" on every render.
--
-- user_id is made nullable because the worker upserts via service-role key
-- and the job already ties the transcript to the correct user via job_id.
-- All statements are idempotent — safe to re-run.

ALTER TABLE video_transcripts ADD COLUMN IF NOT EXISTS full_text TEXT;
ALTER TABLE video_transcripts ADD COLUMN IF NOT EXISTS language  TEXT;
ALTER TABLE video_transcripts ADD COLUMN IF NOT EXISTS duration  FLOAT;

-- Make user_id nullable so the worker can upsert without providing it.
-- The UNIQUE constraint on job_id already ties transcripts to their owner.
ALTER TABLE video_transcripts ALTER COLUMN user_id DROP NOT NULL;


-- Phase 3: Video clip stitching
-- Stores the signed URL of the single stitched output MP4 produced by
-- stages/stitch.py after all clips are concatenated via FFmpeg stream-copy.
ALTER TABLE video_jobs
  ADD COLUMN IF NOT EXISTS stitched_output_url TEXT;
