import { getRuntimeEnvValue } from '../utils/runtimeEnv';

const rawSupabaseUrl = getRuntimeEnvValue('NEXT_PUBLIC_SUPABASE_URL');
const rawSupabaseAnonKey = getRuntimeEnvValue('NEXT_PUBLIC_SUPABASE_ANON_KEY');

export const supabaseUrl = rawSupabaseUrl.trim().replace(/\/$/, '');
export const supabaseAnonKey = rawSupabaseAnonKey.trim();

function isValidHttpsUrl(value) {
  try {
    const parsedUrl = new URL(value);
    return parsedUrl.protocol === 'https:' && Boolean(parsedUrl.hostname);
  } catch {
    return false;
  }
}

const looksLikePlaceholder =
  /YOUR_PROJECT_REF|<your-project-ref>/i.test(supabaseUrl) ||
  /YOUR_SUPABASE_URL/i.test(supabaseUrl) ||
  /YOUR_SUPABASE_ANON_KEY/i.test(supabaseAnonKey);

export const isSupabaseConfigured =
  isValidHttpsUrl(supabaseUrl) &&
  Boolean(supabaseAnonKey) &&
  !looksLikePlaceholder;

if (!isSupabaseConfigured) {
  console.error(
    '[Supabase] Invalid or missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.',
  );
}

export function getSupabaseFunctionUrl(functionName) {
  if (!isSupabaseConfigured) {
    throw new Error(
      'Supabase is not configured. Update NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in `.env`.',
    );
  }

  return `${supabaseUrl}/functions/v1/${functionName}`;
}
