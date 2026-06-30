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

function getEdgeStatus(error) {
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

export function normalizeEdgeFunctionError(error, functionName) {
  const status = getEdgeStatus(error);

  if (isEdgeFunctionUnavailable(error)) {
    return new Error(buildUnavailableEdgeFunctionMessage(functionName));
  }

  if (status === 401 || status === 403) {
    return new Error(`You do not have permission to use the \`${functionName}\` Edge Function.`);
  }

  if (error?.name === 'FunctionsHttpError') {
    return new Error(`The \`${functionName}\` Edge Function returned an unexpected HTTP error.`);
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error || `The \`${functionName}\` Edge Function failed.`));
}
