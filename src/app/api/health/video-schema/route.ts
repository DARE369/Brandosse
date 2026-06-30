// src/app/api/health/video-schema/route.ts

import { createClient } from '@supabase/supabase-js';

const VIDEO_ENGINE_TABLES = [
  'video_jobs',
  'video_clips',
  'video_transcripts',
  'user_credits',
  'credit_transactions',
] as const;

type VideoEngineTable = (typeof VIDEO_ENGINE_TABLES)[number];
type HealthStatus = 'healthy' | 'degraded' | 'error';

type TableCheck = {
  exists: boolean;
  accessible: boolean;
};

type VideoSchemaChecks = {
  [TableName in VideoEngineTable]: TableCheck;
};

type HealthResponse = {
  status: HealthStatus;
  timestamp: string;
  checks: VideoSchemaChecks;
  error: string | null;
};

type RuntimeEnvironment = {
  process?: {
    env?: Record<string, string | undefined>;
  };
};

type SupabaseHealthError = {
  code?: string;
  message?: string;
};

function createInitialChecks(): VideoSchemaChecks {
  return {
    video_jobs: { exists: false, accessible: false },
    video_clips: { exists: false, accessible: false },
    video_transcripts: { exists: false, accessible: false },
    user_credits: { exists: false, accessible: false },
    credit_transactions: { exists: false, accessible: false },
  };
}

function getRuntimeEnv(): Record<string, string | undefined> {
  return (globalThis as typeof globalThis & RuntimeEnvironment).process?.env ?? {};
}

function getSupabaseConfig(): { url: string; anonKey: string } | null {
  const env = getRuntimeEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  return { url, anonKey };
}

function getBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization') ?? '';

  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return null;
  }

  const token = authHeader.slice('bearer '.length).trim();
  return token.length > 0 ? token : null;
}

function isMissingTableError(error: SupabaseHealthError): boolean {
  const message = error.message?.toLowerCase() ?? '';

  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    message.includes('could not find the table') ||
    (message.includes('relation') && message.includes('does not exist'))
  );
}

function createHealthResponse(
  status: HealthStatus,
  checks: VideoSchemaChecks,
  error: string | null,
): HealthResponse {
  return {
    status,
    timestamp: new Date().toISOString(),
    checks,
    error,
  };
}

export async function GET(request: Request): Promise<Response> {
  const checks = createInitialChecks();
  const config = getSupabaseConfig();

  if (!config) {
    return Response.json(
      createHealthResponse(
        'error',
        checks,
        'Supabase URL or anon key is not configured for the health check route.',
      ),
      { status: 500 },
    );
  }

  const token = getBearerToken(request);

  if (!token) {
    return Response.json(
      createHealthResponse('error', checks, 'Authentication required.'),
      { status: 401 },
    );
  }

  const supabase = createClient(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  const authResult = await supabase.auth.getUser(token);

  if (authResult.error || !authResult.data.user) {
    return Response.json(
      createHealthResponse('error', checks, 'Authentication failed.'),
      { status: 401 },
    );
  }

  const errors: string[] = [];

  for (const tableName of VIDEO_ENGINE_TABLES) {
    const result = await supabase
      .from(tableName)
      .select('id', { count: 'exact', head: true })
      .limit(1);

    if (result.error) {
      const healthError = result.error as SupabaseHealthError;
      checks[tableName] = {
        exists: !isMissingTableError(healthError),
        accessible: false,
      };
      errors.push(`${tableName}: ${healthError.message ?? 'query failed'}`);
      continue;
    }

    checks[tableName] = {
      exists: true,
      accessible: true,
    };
  }

  const passedChecks = VIDEO_ENGINE_TABLES.filter(
    (tableName) => checks[tableName].exists && checks[tableName].accessible,
  ).length;

  const status: HealthStatus =
    passedChecks === VIDEO_ENGINE_TABLES.length
      ? 'healthy'
      : passedChecks > 0
        ? 'degraded'
        : 'error';

  return Response.json(
    createHealthResponse(status, checks, errors.length > 0 ? errors.join('; ') : null),
    { status: status === 'healthy' ? 200 : 500 },
  );
}
