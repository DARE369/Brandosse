import { readEnv } from "./env.ts";
import type { DatabaseClient } from "./supabase.ts";

export type ConnectionEventPayload = {
  connectedAccountId: string;
  userId: string;
  organizationId?: string | null;
  eventType: string;
  platform: string;
  severity?: string;
  message?: string | null;
  metadata?: Record<string, unknown>;
  isSimulatedFailure?: boolean;
};

/**
 * The shared secret a MACHINE caller must present to invoke a privileged
 * function. Set as a Supabase function secret and stored in Vault so pg_cron
 * can send it.
 *
 * ── Why this is not the service-role key ────────────────────────────────────
 * It used to be. `requireServiceRole` compared the Authorization header against
 * the runtime's SUPABASE_SERVICE_ROLE_KEY, and every scheduled invocation in the
 * product silently 401'd for weeks as a result.
 *
 * The cause, diagnosed 2026-09-10: this project has Supabase's NEW API key
 * system enabled, so the edge runtime is injected with the new-style keys —
 * SUPABASE_ANON_KEY holds the `sb_publishable_…` value and
 * SUPABASE_SERVICE_ROLE_KEY holds the `sb_secret_…` value. Every caller (Vault,
 * .env.local, operator scripts) still presented the LEGACY service_role JWT.
 * PostgREST accepts that JWT happily, so the database kept working and only the
 * functions broke — which is why it looked inexplicable for so long.
 *
 * The deeper fault is that a DATABASE CREDENTIAL was being used as an RPC
 * password. Those are different things with different lifecycles, and coupling
 * them meant a platform-side key migration silently disabled every cron in the
 * product: publish-post, process-jobs, process-risk-alerts,
 * detect-account-failures, refresh-social-tokens, mock-publish and
 * admin-seed-connected-account.
 *
 * So caller authentication now uses a secret WE own and rotate.
 * createAdminClient() still uses the platform-injected key for database access,
 * which is what that key is actually for.
 */
const INVOKE_SECRET_ENV = "FUNCTION_INVOKE_SECRET";

/**
 * Refuse anything short enough to be brute-forced or accidentally set to a
 * placeholder. 32 characters of base64url is ~192 bits.
 */
const MIN_INVOKE_SECRET_LENGTH = 32;

/**
 * Constant-time comparison.
 *
 * The old check used `!==` on a string. For a value that is now a bearer
 * SECRET rather than an already-public key, an early-exit comparison leaks how
 * many leading bytes a guess got right. Lengths are compared first and that
 * does leak length — unavoidable, and not useful to an attacker who already
 * knows the format.
 */
function timingSafeEquals(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const left = enc.encode(a);
  const right = enc.encode(b);
  if (left.length !== right.length) return false;

  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

/**
 * The header the secret travels in.
 *
 * NOT `Authorization`, and that is not a style choice. Supabase's API gateway
 * sits in front of every edge function and validates the Authorization header
 * as a JWT BEFORE the function runs. An opaque secret there never arrives — the
 * gateway rejects it with UNAUTHORIZED_INVALID_JWT_FORMAT / "Invalid JWT", and
 * no amount of function-side code can see it. Verified live on 2026-09-10.
 *
 * So a machine caller sends TWO things:
 *   Authorization: Bearer <anon key>   — satisfies the gateway. Public by
 *                                        design; it authorises nothing here.
 *   X-Invoke-Secret: <secret>          — the actual authorisation, checked below.
 *
 * The alternative was setting verify_jwt = false per function to make the
 * gateway pass anything through. That trades a whole layer of defence for a
 * tidier header, which is the wrong direction: this way the gateway still turns
 * away unauthenticated traffic and our secret decides who may actually act.
 */
const INVOKE_SECRET_HEADER = "X-Invoke-Secret";

/** Does this request carry the machine-caller secret? Never throws. */
export function presentsInvokeSecret(req: Request): boolean {
  const secret = Deno.env.get(INVOKE_SECRET_ENV) ?? "";
  if (secret.length < MIN_INVOKE_SECRET_LENGTH) return false;

  const presented = (req.headers.get(INVOKE_SECRET_HEADER) ?? "").trim();
  if (!presented) return false;

  return timingSafeEquals(presented, secret);
}

/**
 * Demand the machine-caller secret, or refuse.
 *
 * A MISCONFIGURED deployment is reported differently from an UNAUTHORISED
 * caller, deliberately. Collapsing the two is what made the original defect so
 * expensive: an unset secret and a wrong secret both returned a bare 401, so
 * "the cron is broken" and "the cron is being rejected" were indistinguishable
 * from outside. The message avoids the words this repo's mapErrorToStatusCode
 * treats as 400/401 so it surfaces as a 500 — our fault, not the caller's.
 */
export function requireInvokeSecret(req: Request) {
  const secret = Deno.env.get(INVOKE_SECRET_ENV) ?? "";

  if (secret.length < MIN_INVOKE_SECRET_LENGTH) {
    console.error(
      `[auth] ${INVOKE_SECRET_ENV} is unset or too short (${secret.length} chars). `
      + "Every scheduled invocation of this function will be refused until it is set. "
      + "Set it with: npx supabase secrets set FUNCTION_INVOKE_SECRET=<value>",
    );
    throw new Error("function_invoke_secret_not_configured");
  }

  if (!presentsInvokeSecret(req)) {
    throw new Error("Unauthorized");
  }
}

export function normalizeConnectionStatus(status: string | null | undefined) {
  return String(status || "active").trim().toLowerCase() || "active";
}

export function isConnectedStatus(status: string | null | undefined) {
  const normalized = normalizeConnectionStatus(status);
  return normalized === "active" || normalized === "mock" || normalized === "connected";
}

export function buildMockPostId(platform: string) {
  const prefixMap: Record<string, string> = {
    instagram: "IG_POST",
    tiktok: "TT_POST",
    youtube: "YT_POST",
    facebook: "FB_POST",
    linkedin: "LI_POST",
    twitter: "X_POST",
    pinterest: "PIN_POST",
    threads: "THR_POST",
  };

  return `${prefixMap[String(platform || "").toLowerCase()] || "POST"}_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

export function buildMockPostUrl(platform: string, mockPostId: string, username?: string | null) {
  const key = String(platform || "").trim().toLowerCase();
  const account = String(username || "socialai").replace(/^@+/, "");

  switch (key) {
    case "instagram":
      return `https://instagram.com/${account}/p/${mockPostId.toLowerCase()}`;
    case "tiktok":
      return `https://www.tiktok.com/@${account}/video/${mockPostId.toLowerCase()}`;
    case "youtube":
      return `https://www.youtube.com/watch?v=${mockPostId.toLowerCase()}`;
    case "facebook":
      return `https://facebook.com/${account}/posts/${mockPostId.toLowerCase()}`;
    case "linkedin":
      return `https://www.linkedin.com/feed/update/${mockPostId.toLowerCase()}`;
    case "twitter":
      return `https://x.com/${account}/status/${mockPostId.toLowerCase()}`;
    case "pinterest":
      return `https://www.pinterest.com/pin/${mockPostId.toLowerCase()}`;
    case "threads":
      return `https://www.threads.net/@${account}/post/${mockPostId.toLowerCase()}`;
    default:
      return `https://socialai.mock/${key || "platform"}/${mockPostId.toLowerCase()}`;
  }
}

export async function insertConnectionEvent(
  adminClient: DatabaseClient,
  payload: ConnectionEventPayload,
) {
  const { error } = await adminClient
    .from("connection_events")
    .insert({
      connected_account_id: payload.connectedAccountId,
      user_id: payload.userId,
      organization_id: payload.organizationId || null,
      event_type: payload.eventType,
      platform: payload.platform,
      severity: payload.severity || "info",
      message: payload.message || null,
      metadata: payload.metadata || {},
      is_simulated_failure: Boolean(payload.isSimulatedFailure),
    });

  if (error) {
    throw error;
  }
}

export function pickFailureReason(consecutiveFailureCount = 0) {
  const thresholdBoost = consecutiveFailureCount >= 3 ? 20 : 0;
  const roll = Math.floor(Math.random() * 100);
  const adjusted = Math.min(99, roll + thresholdBoost);

  if (adjusted < 70) {
    return {
      success: true,
      retriable: false,
      reason: null,
      severity: "info",
      nextStatus: "active",
    };
  }

  if (adjusted < 85) {
    return {
      success: false,
      retriable: true,
      reason: adjusted % 2 === 0 ? "network_timeout" : "server_busy",
      severity: "warning",
      nextStatus: "active",
    };
  }

  if (adjusted < 95) {
    return {
      success: false,
      retriable: false,
      reason: adjusted % 2 === 0 ? "invalid_media_type" : "rate_limit_exceeded",
      severity: "error",
      nextStatus: "error",
    };
  }

  return {
    success: false,
    retriable: false,
    reason: adjusted % 2 === 0 ? "account_suspended" : "api_unavailable",
    severity: "critical",
    nextStatus: "error",
  };
}
