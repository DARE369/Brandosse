-- supabase/video-engine-stage-1-schema.sql
-- Stage 1: Video Engine database foundation.
-- Run this manually in the Supabase SQL Editor after confirming these table
-- names do not conflict with your existing public schema.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$
DECLARE
  conflicting_tables TEXT[];
BEGIN
  SELECT ARRAY_AGG(table_name ORDER BY table_name)
  INTO conflicting_tables
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name = ANY (ARRAY[
      'video_jobs',
      'video_clips',
      'video_transcripts',
      'user_credits',
      'credit_transactions'
    ]);

  IF conflicting_tables IS NOT NULL THEN
    RAISE EXCEPTION
      'Video engine table name conflict(s): %. Stop and prefix the new tables with ve_ before running this script.',
      conflicting_tables;
  END IF;
END
$$;

CREATE TABLE public.video_jobs (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_url            TEXT NOT NULL,
  source_platform       TEXT NOT NULL CHECK (source_platform IN ('youtube', 'twitter', 'upload')),
  status                TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
                          'queued', 'downloading', 'transcribing',
                          'analyzing', 'rendering', 'complete', 'failed'
                        )),
  error_message         TEXT,
  error_stage           TEXT,
  source_title          TEXT,
  source_duration_secs  INTEGER,
  credits_consumed      INTEGER,
  processing_started_at TIMESTAMPTZ,
  processing_ended_at   TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.video_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own jobs"
  ON public.video_jobs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own jobs"
  ON public.video_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users cannot update jobs directly"
  ON public.video_jobs FOR UPDATE
  USING (false);

CREATE POLICY "Users can delete own jobs"
  ON public.video_jobs FOR DELETE
  USING (auth.uid() = user_id);

CREATE TABLE public.video_clips (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id              UUID NOT NULL REFERENCES public.video_jobs(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  clip_index          INTEGER NOT NULL,
  ai_title            TEXT,
  ai_caption          TEXT,
  hook_score          NUMERIC(4,3) CHECK (hook_score >= 0 AND hook_score <= 1),
  content_score       NUMERIC(4,3) CHECK (content_score >= 0 AND content_score <= 1),
  overall_score       NUMERIC(4,3) CHECK (overall_score >= 0 AND overall_score <= 1),
  start_time_secs     NUMERIC(10,3) NOT NULL,
  end_time_secs       NUMERIC(10,3) NOT NULL,
  duration_secs       NUMERIC(10,3),
  storage_path        TEXT,
  public_url          TEXT,
  thumbnail_path      TEXT,
  thumbnail_url       TEXT,
  transcript_excerpt  TEXT,
  platform_target     TEXT CHECK (platform_target IN ('tiktok', 'reels', 'shorts', 'universal')),
  render_status       TEXT NOT NULL DEFAULT 'pending' CHECK (render_status IN (
                          'pending', 'rendering', 'complete', 'failed'
                        )),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.video_clips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own clips"
  ON public.video_clips FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users cannot insert clips directly"
  ON public.video_clips FOR INSERT
  WITH CHECK (false);

CREATE POLICY "Users cannot update clips directly"
  ON public.video_clips FOR UPDATE
  USING (false);

CREATE POLICY "Users can delete own clips"
  ON public.video_clips FOR DELETE
  USING (auth.uid() = user_id);

CREATE TABLE public.video_transcripts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id            UUID NOT NULL UNIQUE REFERENCES public.video_jobs(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  raw_transcript    JSONB NOT NULL,
  word_segments     JSONB,
  speaker_segments  JSONB,
  detected_language TEXT,
  word_error_notes  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.video_transcripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own transcripts"
  ON public.video_transcripts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users cannot modify transcripts"
  ON public.video_transcripts FOR INSERT
  WITH CHECK (false);

CREATE TABLE public.user_credits (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  balance             INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  lifetime_purchased  INTEGER NOT NULL DEFAULT 0,
  lifetime_consumed   INTEGER NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own credits"
  ON public.user_credits FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users cannot modify credits directly"
  ON public.user_credits FOR UPDATE
  USING (false);

CREATE TABLE public.credit_transactions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id            UUID REFERENCES public.video_jobs(id) ON DELETE SET NULL,
  amount            INTEGER NOT NULL,
  balance_after     INTEGER NOT NULL,
  transaction_type  TEXT NOT NULL CHECK (transaction_type IN (
                      'purchase', 'consumption', 'refund', 'bonus', 'adjustment'
                    )),
  description       TEXT,
  stripe_payment_id TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own transactions"
  ON public.credit_transactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users cannot insert transactions directly"
  ON public.credit_transactions FOR INSERT
  WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_video_jobs
  BEFORE UPDATE ON public.video_jobs
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at_video_clips
  BEFORE UPDATE ON public.video_clips
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at_user_credits
  BEFORE UPDATE ON public.user_credits
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user_credits()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_credits (user_id, balance)
  VALUES (NEW.id, 30)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created_credits
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_credits();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Users can view own video clips'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Users can view own video clips"
        ON storage.objects FOR SELECT
        USING (
          bucket_id = 'video-clips'
          AND auth.uid()::text = (storage.foldername(name))[1]
        )
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Users can delete own video clips'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Users can delete own video clips"
        ON storage.objects FOR DELETE
        USING (
          bucket_id = 'video-clips'
          AND auth.uid()::text = (storage.foldername(name))[1]
        )
    $policy$;
  END IF;
END
$$;

CREATE INDEX idx_video_jobs_user_id ON public.video_jobs(user_id);
CREATE INDEX idx_video_jobs_status ON public.video_jobs(status);
CREATE INDEX idx_video_jobs_created_at ON public.video_jobs(created_at DESC);
CREATE INDEX idx_video_clips_job_id ON public.video_clips(job_id);
CREATE INDEX idx_video_clips_user_id ON public.video_clips(user_id);
CREATE INDEX idx_credit_transactions_user_id ON public.credit_transactions(user_id);
CREATE INDEX idx_credit_transactions_created_at ON public.credit_transactions(created_at DESC);

COMMIT;
