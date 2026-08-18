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

// Refresh failures are the one auth event we cannot debug after the fact: they
// happen during page load, supabase-js deletes the stored session when the
// error is non-retryable (GoTrueClient _callRefreshToken -> _removeSession),
// and by the time anyone opens the console the evidence is gone. Record the
// status + server message to localStorage so the reason survives the reload.
// Read it with: localStorage.getItem('socialai-auth-last-refresh-failure')
const AUTH_REFRESH_FAILURE_KEY = 'socialai-auth-last-refresh-failure';

function recordRefreshFailure(detail) {
  try {
    globalThis.localStorage?.setItem(
      AUTH_REFRESH_FAILURE_KEY,
      JSON.stringify({ at: new Date().toISOString(), ...detail }),
    );
  } catch {
    // Storage unavailable (private mode) — diagnostics are best-effort only.
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
      try {
        globalThis.localStorage?.removeItem(AUTH_REFRESH_FAILURE_KEY);
      } catch {
        // best-effort cleanup only
      }
    }

    // A non-OK refresh is the case that silently destroys the session: anything
    // outside supabase-js's retryable set (502/503/504/520-530) causes
    // _removeSession(), which deletes the stored token and forces a real
    // re-login. Capture the server's reason before that happens — a 400
    // "Invalid Refresh Token: Already Used" means token rotation stranded the
    // stored token, which is a project-settings problem, not a client bug.
    if (refreshRequest && !response.ok) {
      let body = '';
      try {
        body = (await response.clone().text()).slice(0, 500);
      } catch {
        body = '<unreadable>';
      }
      recordRefreshFailure({ status: response.status, body, kind: 'http' });
      console.warn(
        `[supabaseClient] token refresh failed (${response.status}). `
        + 'If this is a 4xx, supabase-js will delete the stored session and force a re-login. '
        + `Reason recorded in localStorage['${AUTH_REFRESH_FAILURE_KEY}']:`,
        body,
      );
    }

    return response;
  } catch (_error) {
    if (refreshRequest) {
      setRefreshSuppressUntil(Date.now() + AUTH_REFRESH_RETRY_COOLDOWN_MS);
      // Network-level failure. This path is SAFE for the session — it returns a
      // 503, which supabase-js classifies as retryable, so the token survives.
      // Recorded anyway so a repeated-timeout pattern is visible.
      recordRefreshFailure({ status: 0, body: String(_error?.message || _error), kind: 'network' });
    }

    return authUnavailableResponse(
      'Could not reach Supabase authentication. Check your connection and try again.',
    );
  } finally {
    globalThis.clearTimeout(timeoutId);
    sourceSignal?.removeEventListener?.('abort', abortFromSource);
  }
}

// supabase-js logs every internal auth decision when debug is on — including
// the exact reason it removes a session, which is the one thing our own
// instrumentation cannot see from outside the library. Gated on a localStorage
// flag rather than NODE_ENV so it can be turned on against production without
// a redeploy:
//   localStorage.setItem('socialai-auth-debug', '1')  // then reload
// Logs are also mirrored into a ring buffer that survives the reload, because
// the interesting events happen during page load and are easy to miss live:
//   JSON.parse(localStorage.getItem('socialai-auth-debug-log'))
const AUTH_DEBUG_FLAG_KEY = 'socialai-auth-debug';
const AUTH_DEBUG_LOG_KEY = 'socialai-auth-debug-log';
const AUTH_DEBUG_LOG_LIMIT = 80;

function authDebugEnabled() {
  try {
    return globalThis.localStorage?.getItem(AUTH_DEBUG_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

function appendAuthDebugLog(message, ...args) {
  console.debug('[supabase-auth]', message, ...args);

  try {
    const storage = globalThis.localStorage;
    if (!storage) return;

    const existing = JSON.parse(storage.getItem(AUTH_DEBUG_LOG_KEY) || '[]');
    const entries = Array.isArray(existing) ? existing : [];
    entries.push({
      at: new Date().toISOString(),
      message: String(message),
      // Arguments are stringified defensively: they routinely contain Errors
      // and session objects that JSON.stringify would drop or choke on.
      detail: args.map((arg) => {
        try {
          if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
          return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
        } catch {
          return '<unserializable>';
        }
      }),
    });

    storage.setItem(
      AUTH_DEBUG_LOG_KEY,
      JSON.stringify(entries.slice(-AUTH_DEBUG_LOG_LIMIT)),
    );
  } catch {
    // Diagnostics must never break auth.
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
      ...(authDebugEnabled() ? { debug: appendAuthDebugLog } : {}),
    },
  },
);
