export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

export function handleCors(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response("ok", { headers: corsHeaders });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

export async function parseJsonBody<T>(req: Request): Promise<T> {
  try {
    return await req.json();
  } catch (_err) {
    throw new Error("Invalid JSON body");
  }
}

// Supabase/PostgREST errors (e.g. PostgrestError) are documented as
// extending Error, but empirically, in this deployed Deno/esm.sh runtime,
// `error instanceof Error` returns false for them — confirmed directly via
// a live debug call against this exact project: a real `.select()` failure
// against a missing table logged `isError: false` despite having a proper
// `{ code, message, details, hint }` shape. Without this fallback, every
// PostgREST error (missing table, RLS denial, constraint violation, etc.)
// silently degrades to the unhelpful literal string "[object Object]" via
// a bare String(error) — confirmed reproducible against
// personal-asset-upload's real insert failure when public.personal_assets
// doesn't exist yet (Packet 2 — Personal Content Library, Phase 3
// verification; see docs/calendar-library-rebuild/packet-2-personal-library/DECISIONS_LOG.md).
// Reads `.message` directly off the plain object before falling back to
// String() — used by both mapErrorToStatusCode and toErrorPayload below so
// neither regresses to the old behavior independently.
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return String(error);
}

export function mapErrorToStatusCode(error: unknown): number {
  if (typeof error === "object" && error && "statusCode" in error) {
    const statusCode = Number((error as { statusCode?: number }).statusCode);
    if (!Number.isNaN(statusCode) && statusCode > 0) return statusCode;
  }

  const message = extractErrorMessage(error).toLowerCase();

  if (message.includes("unauthorized")) return 401;
  if (message.includes("forbidden")) return 403;
  if (message.includes("not found")) return 404;
  if (message.includes("bad request") || message.includes("invalid") || message.includes("missing")) return 400;
  if (message.includes("rate limit") || message.includes("quota")) return 429;
  if (message.includes("timeout") || message.includes("timed out")) return 504;
  return 500;
}

export function toErrorPayload(error: unknown): { error: string } {
  return { error: extractErrorMessage(error) };
}
