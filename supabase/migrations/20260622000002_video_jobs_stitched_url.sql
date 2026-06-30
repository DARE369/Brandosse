-- Phase 3: Video clip stitching
-- Stores the signed URL of the stitched output MP4 produced after all clips
-- are concatenated by the video worker's stitch stage.
ALTER TABLE public.video_jobs
  ADD COLUMN IF NOT EXISTS stitched_output_url TEXT;
