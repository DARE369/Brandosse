// src/lib/video-engine/constants.ts

export const VIDEO_ENGINE_CONSTANTS = {
  CREDITS_PER_MINUTE_OF_SOURCE: 1,
  MIN_CREDITS_REQUIRED: 5,
  FREE_CREDITS_ON_SIGNUP: 30,

  MAX_SOURCE_DURATION_MINUTES: 180,
  MAX_CONCURRENT_JOBS_PER_USER: 2,
  MAX_SUBMISSIONS_PER_HOUR: 10,

  MIN_CLIP_DURATION_SECS: 30,
  MAX_CLIP_DURATION_SECS: 90,
  TARGET_CLIPS_PER_JOB: 7,

  CLIPS_BUCKET: 'video-clips',
  SOURCE_CACHE_BUCKET: 'video-source-cache',
  SIGNED_URL_EXPIRY_SECONDS: 172800,

  SUPPORTED_PLATFORMS: ['youtube', 'twitter', 'upload'] as const,

  YOUTUBE_URL_PATTERNS: [
    /^https?:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]{11}/,
    /^https?:\/\/youtu\.be\/[\w-]{11}/,
    /^https?:\/\/(www\.)?youtube\.com\/shorts\/[\w-]{11}/,
  ],

  TWITTER_URL_PATTERNS: [
    /^https?:\/\/(www\.)?twitter\.com\/\w+\/status\/\d+/,
    /^https?:\/\/(www\.)?x\.com\/\w+\/status\/\d+/,
  ],
} as const;

export const JOB_STATUS_LABELS: Record<string, string> = {
  queued: 'In Queue',
  downloading: 'Downloading Video',
  transcribing: 'Transcribing Audio',
  analyzing: 'Analyzing Content',
  rendering: 'Rendering Clips',
  complete: 'Complete',
  failed: 'Failed',
};

export const JOB_STATUS_ORDER = [
  'queued',
  'downloading',
  'transcribing',
  'analyzing',
  'rendering',
  'complete',
] as const;
