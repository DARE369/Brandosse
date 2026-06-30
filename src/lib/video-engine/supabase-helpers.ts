// src/lib/video-engine/supabase-helpers.ts

import { supabase } from '../../services/supabaseClient';
import { VIDEO_ENGINE_CONSTANTS } from './constants';
import type {
  CreditTransaction,
  UserCredits,
  VideoClip,
  VideoJob,
  VideoJobWithClips,
} from './types';

type SupabaseQueryError = {
  message: string;
};

type SupabaseQueryResult<T> = {
  data: T | null;
  error: SupabaseQueryError | null;
};

function logVideoEngineError(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[VideoEngine] ${context}: ${message}`);
}

export async function getUserJobs(userId: string): Promise<VideoJob[]> {
  try {
    const result = await supabase
      .from('video_jobs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    const { data, error } = result as SupabaseQueryResult<VideoJob[]>;

    if (error) {
      logVideoEngineError('Failed to fetch user jobs', error.message);
      return [];
    }

    return data ?? [];
  } catch (error) {
    logVideoEngineError('Unexpected error fetching user jobs', error);
    return [];
  }
}

export async function getUserJobById(
  jobId: string,
  userId: string,
): Promise<VideoJobWithClips | null> {
  try {
    const result = await supabase
      .from('video_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('user_id', userId)
      .maybeSingle();

    const { data, error } = result as SupabaseQueryResult<VideoJob>;

    if (error) {
      logVideoEngineError('Failed to fetch user job by ID', error.message);
      return null;
    }

    if (!data) {
      return null;
    }

    const clips = await getJobClips(jobId, userId);

    return {
      ...data,
      clips,
    };
  } catch (error) {
    logVideoEngineError('Unexpected error fetching user job by ID', error);
    return null;
  }
}

export async function getUserCredits(userId: string): Promise<UserCredits | null> {
  try {
    const result = await supabase
      .from('user_credits')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    const { data, error } = result as SupabaseQueryResult<UserCredits>;

    if (error) {
      logVideoEngineError('Failed to fetch user credits', error.message);
      return null;
    }

    return data ?? null;
  } catch (error) {
    logVideoEngineError('Unexpected error fetching user credits', error);
    return null;
  }
}

export async function getUserTransactions(userId: string): Promise<CreditTransaction[]> {
  try {
    const result = await supabase
      .from('credit_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    const { data, error } = result as SupabaseQueryResult<CreditTransaction[]>;

    if (error) {
      logVideoEngineError('Failed to fetch user transactions', error.message);
      return [];
    }

    return data ?? [];
  } catch (error) {
    logVideoEngineError('Unexpected error fetching user transactions', error);
    return [];
  }
}

export async function getJobClips(jobId: string, userId: string): Promise<VideoClip[]> {
  try {
    const result = await supabase
      .from('video_clips')
      .select('*')
      .eq('job_id', jobId)
      .eq('user_id', userId)
      .order('clip_index', { ascending: true });

    const { data, error } = result as SupabaseQueryResult<VideoClip[]>;

    if (error) {
      logVideoEngineError('Failed to fetch job clips', error.message);
      return [];
    }

    return data ?? [];
  } catch (error) {
    logVideoEngineError('Unexpected error fetching job clips', error);
    return [];
  }
}

export async function getClipSignedUrl(storagePath: string): Promise<string | null> {
  try {
    const result = await supabase.storage
      .from(VIDEO_ENGINE_CONSTANTS.CLIPS_BUCKET)
      .createSignedUrl(storagePath, VIDEO_ENGINE_CONSTANTS.SIGNED_URL_EXPIRY_SECONDS);

    const { data, error } = result as SupabaseQueryResult<{ signedUrl: string }>;

    if (error) {
      logVideoEngineError('Failed to create clip signed URL', error.message);
      return null;
    }

    return data?.signedUrl ?? null;
  } catch (error) {
    logVideoEngineError('Unexpected error creating clip signed URL', error);
    return null;
  }
}
