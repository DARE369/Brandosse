const EDGE_UNAVAILABLE_TTL_MS = 5 * 60 * 1000;

function getSessionStorage() {
  if (typeof window === 'undefined') return null;

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function getUnavailableKey(functionName) {
  return `socialai_edge_function_unavailable_until:${String(functionName || '').trim()}`;
}

export function getEdgeStatus(error) {
  return error?.context?.status || error?.response?.status || null;
}

export function buildUnavailableEdgeFunctionMessage(functionName) {
  return `Could not reach the \`${functionName}\` Edge Function. This usually means it is not deployed to the current Supabase project, crashed before responding to OPTIONS, or this app is pointed at the wrong Supabase environment.`;
}

export function isEdgeFunctionUnavailable(error) {
  const message = String(error?.message || '').toLowerCase();
  const status = getEdgeStatus(error);

  return (
    error?.name === 'FunctionsFetchError'
    || message.includes('failed to send a request')
    || message.includes('failed to fetch')
    || message.includes('networkerror')
    || message.includes('cors')
    || status === 404
    || status === 502
    || status === 503
    || status === 504
  );
}

export function shouldSkipEdgeFunction(functionName) {
  const storage = getSessionStorage();
  if (!storage) return false;

  const rawValue = storage.getItem(getUnavailableKey(functionName));
  if (!rawValue) return false;

  const until = Number(rawValue);
  return Number.isFinite(until) && until > Date.now();
}

export function markEdgeFunctionUnavailable(functionName, ttlMs = EDGE_UNAVAILABLE_TTL_MS) {
  const storage = getSessionStorage();
  if (!storage) return;

  storage.setItem(getUnavailableKey(functionName), String(Date.now() + ttlMs));
}

export function clearEdgeFunctionUnavailable(functionName) {
  const storage = getSessionStorage();
  if (!storage) return;

  storage.removeItem(getUnavailableKey(functionName));
}

// Week 2 Fix 2: the edge functions this app calls now return typed,
// specific error messages (createHttpError + toErrorPayload → { error: "..." })
// for every expected failure mode (400/402/403/404). Previously this
// normalizer discarded that message entirely for any non-401/403
// FunctionsHttpError, replacing it with a generic "unexpected HTTP error" —
// which meant a user hitting, say, a 400 "caption is required" validation
// failure would never see that specific text. This now reads the real
// response body first and only falls back to the generic per-status
// messages if the body can't be read/parsed (e.g. a genuine network-layer
// failure with no body at all).
async function readEdgeErrorBody(error) {
  const context = error?.context;
  if (!context) return null;

  try {
    if (typeof context.json === 'function') {
      const source = typeof context.clone === 'function' ? context.clone() : context;
      return await source.json();
    }

    if (typeof context.text === 'function') {
      const source = typeof context.clone === 'function' ? context.clone() : context;
      const text = await source.text();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return { error: text.trim() };
      }
    }
  } catch {
    return null;
  }

  return null;
}

function extractMessageFromBody(body) {
  if (body && typeof body.error === 'string' && body.error.trim()) return body.error.trim();
  if (body && typeof body.message === 'string' && body.message.trim()) return body.message.trim();
  return null;
}

export async function normalizeEdgeFunctionError(error, functionName) {
  const status = getEdgeStatus(error);

  if (isEdgeFunctionUnavailable(error)) {
    return new Error(buildUnavailableEdgeFunctionMessage(functionName));
  }

  const body = await readEdgeErrorBody(error);
  const backendMessage = extractMessageFromBody(body);

  // WEEK 2 FIX 5 (+ ADDENDUM UPGRADE 3): a 429 carries retry_after_seconds
  // in its body (see _shared/http.ts: toErrorPayload). Attach it to the
  // returned Error so callers can show a real countdown instead of a
  // generic "try again later."
  if (status === 429) {
    const retryAfterSeconds = Number(body?.retry_after_seconds);
    const normalizedError = new Error(
      backendMessage || "You're going a bit fast — try again in a few seconds.",
    );
    normalizedError.retryAfterSeconds = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? Math.ceil(retryAfterSeconds)
      : 5;
    return normalizedError;
  }

  if (status === 401 || status === 403) {
    return new Error(backendMessage || `You do not have permission to use the \`${functionName}\` Edge Function.`);
  }

  if (error?.name === 'FunctionsHttpError') {
    return new Error(backendMessage || `The \`${functionName}\` Edge Function returned an unexpected HTTP error.`);
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error || `The \`${functionName}\` Edge Function failed.`));
}
