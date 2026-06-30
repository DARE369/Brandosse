import { createClient } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from './supabaseConfig';

const fallbackSupabaseUrl = 'https://example.supabase.co';
const fallbackSupabaseAnonKey = 'missing-supabase-anon-key';
const AUTH_FETCH_TIMEOUT_MS = 12_000;
const AUTH_REFRESH_RETRY_COOLDOWN_MS = 30_000;
const AUTH_REFRESH_SUPPRESS_UNTIL_KEY = 'socialai-auth-refresh-suppress-until';

let suppressRefreshUntil = 0;

function getRefreshSuppressUntil() {
  if (suppressRefreshUntil > Date.now()) return suppressRefreshUntil;

  try {
    const storedValue = Number(globalThis.sessionStorage?.getItem(AUTH_REFRESH_SUPPRESS_UNTIL_KEY) || 0);
    suppressRefreshUntil = Number.isFinite(storedValue) ? storedValue : 0;
  } catch {
    suppressRefreshUntil = 0;
  }

  return suppressRefreshUntil;
}

function setRefreshSuppressUntil(value) {
  suppressRefreshUntil = value;
  try {
    if (value > Date.now()) {
      globalThis.sessionStorage?.setItem(AUTH_REFRESH_SUPPRESS_UNTIL_KEY, String(value));
    } else {
      globalThis.sessionStorage?.removeItem(AUTH_REFRESH_SUPPRESS_UNTIL_KEY);
    }
  } catch {
    // Storage can be unavailable in private contexts; in-memory suppression still applies.
  }
}

function getRequestUrl(resource) {
  if (typeof resource === 'string') return resource;
  if (resource instanceof URL) return resource.toString();
  return resource?.url || '';
}

function isSupabaseAuthRequest(resource) {
  const rawUrl = getRequestUrl(resource);
  if (!rawUrl) return false;

  try {
    const parsedUrl = new URL(rawUrl);
    const configuredOrigin = new URL(isSupabaseConfigured ? supabaseUrl : fallbackSupabaseUrl).origin;
    return parsedUrl.origin === configuredOrigin && parsedUrl.pathname.startsWith('/auth/v1/');
  } catch {
    return false;
  }
}

function isRefreshTokenRequest(resource) {
  const rawUrl = getRequestUrl(resource);
  if (!rawUrl) return false;

  try {
    const parsedUrl = new URL(rawUrl);
    return (
      parsedUrl.pathname.endsWith('/auth/v1/token') &&
      parsedUrl.searchParams.get('grant_type') === 'refresh_token'
    );
  } catch {
    return false;
  }
}

function authUnavailableResponse(message) {
  return new Response(
    JSON.stringify({
      error: 'auth_unavailable',
      message,
      error_description: message,
      msg: message,
    }),
    {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
      },
    },
  );
}

async function supabaseFetch(resource, options = {}) {
  const authRequest = isSupabaseAuthRequest(resource);
  const refreshRequest = authRequest && isRefreshTokenRequest(resource);

  if (refreshRequest && Date.now() < getRefreshSuppressUntil()) {
    return authUnavailableResponse('Supabase auth refresh is temporarily unavailable.');
  }

  if (!authRequest) {
    return globalThis.fetch(resource, options);
  }

  const controller = new AbortController();
  const sourceSignal = options?.signal;
  const abortFromSource = () => controller.abort(sourceSignal?.reason);
  const timeoutId = globalThis.setTimeout(() => {
    controller.abort(new DOMException('Supabase auth request timed out.', 'AbortError'));
  }, AUTH_FETCH_TIMEOUT_MS);

  if (sourceSignal?.aborted) {
    controller.abort(sourceSignal.reason);
  } else if (sourceSignal) {
    sourceSignal.addEventListener('abort', abortFromSource, { once: true });
  }

  try {
    const response = await globalThis.fetch(resource, {
      ...options,
      signal: controller.signal,
    });

    if (refreshRequest && response.ok) {
      setRefreshSuppressUntil(0);
    }

    return response;
  } catch (_error) {
    if (refreshRequest) {
      setRefreshSuppressUntil(Date.now() + AUTH_REFRESH_RETRY_COOLDOWN_MS);
    }

    return authUnavailableResponse(
      'Could not reach Supabase authentication. Check your connection and try again.',
    );
  } finally {
    globalThis.clearTimeout(timeoutId);
    sourceSignal?.removeEventListener?.('abort', abortFromSource);
  }
}

export const supabase = createClient(
  isSupabaseConfigured ? supabaseUrl : fallbackSupabaseUrl,
  isSupabaseConfigured ? supabaseAnonKey : fallbackSupabaseAnonKey,
  {
    global: {
      fetch: supabaseFetch,
    },
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storageKey: 'socialai-auth',
    },
  },
);
