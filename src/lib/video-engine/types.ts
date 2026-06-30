// src/lib/video-engine/types.ts

export type JobStatus =
  | 'queued'
  | 'downloading'
  | 'transcribing'
  | 'analyzing'
  | 'rendering'
  | 'complete'
  | 'failed';

export type SourcePlatform = 'youtube' | 'twitter' | 'upload';

export type PlatformTarget = 'tiktok' | 'reels' | 'shorts' | 'universal';

export type TransactionType = 'purchase' | 'consumption' | 'refund' | 'bonus' | 'adjustment';

export type RenderStatus = 'pending' | 'rendering' | 'complete' | 'failed';

export interface VideoJob {
  id: string;
  user_id: string;
  source_url: string;
  source_platform: SourcePlatform;
  status: JobStatus;
  error_message: string | null;
  error_stage: string | null;
  source_title: string | null;
  source_duration_secs: number | null;
  credits_consumed: number | null;
  processing_started_at: string | null;
  processing_ended_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface VideoClip {
  id: string;
  job_id: string;
  user_id: string;
  clip_index: number;
  ai_title: string | null;
  ai_caption: string | null;
  hook_score: number | null;
  content_score: number | null;
  overall_score: number | null;
  start_time_secs: number;
  end_time_secs: number;
  duration_secs: number | null;
  storage_path: string | null;
  public_url: string | null;
  thumbnail_path: string | null;
  thumbnail_url: string | null;
  transcript_excerpt: string | null;
  platform_target: PlatformTarget | null;
  render_status: RenderStatus;
  created_at: string;
  updated_at: string;
}

export interface VideoTranscript {
  id: string;
  job_id: string;
  user_id: string;
  raw_transcript: Record<string, unknown>;
  word_segments: unknown[] | null;
  speaker_segments: unknown[] | null;
  detected_language: string | null;
  word_error_notes: string | null;
  created_at: string;
}

export interface UserCredits {
  id: string;
  user_id: string;
  balance: number;
  lifetime_purchased: number;
  lifetime_consumed: number;
  updated_at: string;
}

export interface CreditTransaction {
  id: string;
  user_id: string;
  job_id: string | null;
  amount: number;
  balance_after: number;
  transaction_type: TransactionType;
  description: string | null;
  stripe_payment_id: string | null;
  created_at: string;
}

export interface JobSubmitResponse {
  success: boolean;
  job_id?: string;
  error?: string;
  credits_remaining?: number;
}

export interface VideoJobWithClips extends VideoJob {
  clips: VideoClip[];
}
