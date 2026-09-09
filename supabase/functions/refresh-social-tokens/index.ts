// supabase/functions/refresh-social-tokens/index.ts
//
// Refreshes stored OAuth access tokens before they expire.
//
// ── Why this exists ──────────────────────────────────────────────────────────
// connected_account_secrets has carried refresh_after, last_refreshed_at,
// refresh_failures and last_refresh_error since migration 20260904120000, whose
// own comment says the columns exist "so a refresh worker can find expiring
// rows". The columns were written at connect time and read by nobody: the
// worker was never built.
//
// The consequence is specific. TikTok access tokens live 24 hours. Without a
// refresher, any post scheduled more than a day out fails at publish with
// access_token_invalid, which the TikTok adapter reports — accurately for the
// symptom, misleadingly for the cause — as "TikTok signed you out. Reconnect
// the account." Nobody signed the user out; we simply let the token lapse.
//
// ── Refresh-token ROTATION is the thing to be careful about ──────────────────
// TikTok returns a NEW refresh_token on every refresh and invalidates the one
// just used. Two consequences follow, and both are handled below:
//
//   1. The new refresh token must be persisted, or the next run authenticates
//      with a dead token and the account locks out for good.
//   2. Two overlapping runs must never refresh the same row. Each would spend
//      the other's token, and whichever lost the race would write a refresh
//      token the provider had already invalidated. Rows are therefore CLAIMED
//      with a compare-and-swap before any network call (see claimRow).
//
// ── LinkedIn ─────────────────────────────────────────────────────────────────
// LinkedIn's standard tier issues no refresh token, so those rows have
// refresh_token_ciphertext = NULL and cannot be refreshed by anybody. They are
// not silently skipped: once such a token is actually past expiry the account
// is marked `expired`, which is the signal the connections UI already reads to
// prompt a reconnect. Better a truthful "reconnect this account" a day early
// than a publish failure the user cannot interpret.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient } from "../_shared/supabase.ts";
import { readEnv } from "../_shared/env.ts";
import { handleCors, jsonResponse, mapErrorToStatusCode, toErrorPayload } from "../_shared/http.ts";
import { decryptToken, encryptToken } from "../_shared/tokenCrypto.ts";

const TIMEOUT_MS = 20_000;

// Give up on a row after this many consecutive failures and tell the user to
// reconnect. Transient provider outages recover well inside three runs; past
// that the credential itself is the likely problem, and continuing to retry
// silently is how an account stays broken for months without anyone noticing.
const MAX_REFRESH_FAILURES = 3;

// How long a claim is held. Long enough that a slow provider call cannot let a
// second run pick up the same row, short enough that a crashed run's rows come
// back on the next pass rather than waiting for the next natural refresh.
const CLAIM_MINUTES = 10;

// Refresh at 80% of a token's life, matching what the connect callback writes.
// A failure then still leaves a fifth of the lifetime to retry in.
const REFRESH_AT_FRACTION = 0.8;

type ProviderConfig = {
  tokenUrl: string;
  clientId: () => string;
  clientSecret: () => string;
  /** TikTok names the credential `client_key`, not `client_id`. */
  clientIdParam: string;
};

/**
 * Deliberately duplicated from app/api/_lib/socialProviders.js rather than
 * imported: that file is Next.js/Node and this is Deno, and there is no build
 * step bridging them. Kept to the few fields a refresh needs so the drift
 * surface is small, and guarded by scripts/check-oauth-provider-parity.cjs,
 * which fails if the two disagree on a token URL or credential parameter name.
 */
const PROVIDERS: Record<string, ProviderConfig> = {
  tiktok: {
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    clientId: () => readEnv("TIKTOK_CLIENT_KEY"),
    clientSecret: () => readEnv("TIKTOK_CLIENT_SECRET"),
    clientIdParam: "client_key",
  },
};

type SecretRow = {
  connected_account_id: string;
  refresh_token_ciphertext: string | null;
  refresh_failures: number;
  expires_at: string | null;
  connected_accounts: { provider: string | null; connection_status: string | null } | null;
};

/**
 * Short, non-reversible fingerprint of a secret, for logs.
 *
 * Enough to answer "are these two values the same?" and nothing else. Never
 * log the secret, and never log enough of it to narrow a guess.
 */
async function fingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest).slice(0, 4))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The caller must present the service-role key this runtime was given.
 *
 * ── Why the mismatch case is logged ──────────────────────────────────────────
 * This is an exact string comparison against the platform-injected
 * SUPABASE_SERVICE_ROLE_KEY, while the pg_cron job authenticates with whatever
 * value is stored in Vault under 'service_role_key'. If those two ever drift —
 * a key rotation that updated one and not the other, say — every scheduled run
 * gets a bare 401 and simply stops refreshing tokens. Nothing raises, nothing
 * retries, and the first symptom is expired accounts weeks later.
 *
 * So a rejection logs the fingerprint of both sides. Same fingerprint means the
 * problem is elsewhere; different fingerprints name the cause outright, without
 * either secret appearing in the logs.
 */
async function requireServiceRole(req: Request) {
  const serviceKey = readEnv("SUPABASE_SERVICE_ROLE_KEY");
  const presented = req.headers.get("Authorization") || "";

  if (presented !== `Bearer ${serviceKey}`) {
    const token = presented.replace(/^Bearer /, "");
    console.error(
      "[refresh-social-tokens] rejected an unauthorized call. "
      + `expected key fp=${await fingerprint(serviceKey)}, `
      + `presented fp=${token ? await fingerprint(token) : "<none>"}. `
      + "Different fingerprints with a caller that should be authorised means the "
      + "Vault secret 'service_role_key' has drifted from the runtime's "
      + "SUPABASE_SERVICE_ROLE_KEY — re-create it with vault.create_secret().",
    );
    throw new Error("Unauthorized");
  }
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw new Error("refresh_timeout");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Compare-and-swap claim. Pushes refresh_after into the future ONLY if the row
 * is still due, and reports whether this run won it.
 *
 * This is what makes overlapping runs safe. Without it, two runs both read a
 * due row, both spend the refresh token, and the loser persists a token the
 * provider already rotated away — locking the account out until the user
 * reconnects by hand.
 */
async function claimRow(
  admin: ReturnType<typeof createAdminClient>,
  id: string,
  nowIso: string,
): Promise<boolean> {
  const claimUntil = new Date(Date.now() + CLAIM_MINUTES * 60_000).toISOString();
  const { data, error } = await admin
    .from("connected_account_secrets")
    .update({ refresh_after: claimUntil })
    .eq("connected_account_id", id)
    .lte("refresh_after", nowIso)
    .select("connected_account_id");

  if (error) throw error;
  return Array.isArray(data) && data.length === 1;
}

/** Exchange a refresh token for a new access token. Never logs either value. */
async function refreshWithProvider(config: ProviderConfig, refreshToken: string) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    [config.clientIdParam]: config.clientId(),
    client_secret: config.clientSecret(),
  });

  const res = await fetchWithTimeout(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try { json = JSON.parse(text); } catch { /* handled below */ }

  if (!res.ok || !json?.access_token) {
    // Only the provider's error CODE is surfaced. Some error shapes echo the
    // client secret back, and this string is persisted to last_refresh_error
    // where it would then sit in the database in plaintext.
    const code = String(json?.error ?? `http_${res.status}`);
    throw new Error(`refresh_rejected:${code}`);
  }

  return {
    accessToken: String(json.access_token),
    // Rotation: absent a new refresh token, the old one is still current.
    refreshToken: json.refresh_token ? String(json.refresh_token) : null,
    expiresInSeconds: Number(json.expires_in) || null,
    grantedScopes: typeof json.scope === "string"
      ? json.scope.split(/[\s,]+/).filter(Boolean)
      : null,
  };
}

/**
 * Are OUR credentials for this provider present?
 *
 * readEnv throws when a required variable is missing, and that throw would
 * otherwise land in the per-row catch below and be recorded as the ACCOUNT
 * failing to refresh. Three runs of that — 90 minutes — and every TikTok
 * account gets marked `expired`, telling people to reconnect a perfectly good
 * connection because a server-side secret was never set.
 *
 * A missing secret is our misconfiguration, not the user's problem, and it must
 * never spend an account's failure budget. Checked BEFORE the row is claimed so
 * a misconfigured deploy leaves the queue exactly as it found it.
 */
function providerConfigured(config: ProviderConfig): boolean {
  try {
    return Boolean(config.clientId() && config.clientSecret());
  } catch {
    return false;
  }
}

/**
 * A refresh token the provider has rejected outright will never work again, so
 * retrying it wastes runs and delays the reconnect prompt the user needs. These
 * are the OAuth 2.0 terminal codes plus TikTok's spelling of them.
 */
function isTerminalRejection(message: string): boolean {
  return /invalid_grant|invalid_request|invalid_client|access_denied|revoked/i.test(message);
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
    await requireServiceRole(req);

    const admin = createAdminClient();
    const nowIso = new Date().toISOString();

    const summary = { due: 0, claimed: 0, refreshed: 0, failed: 0, expired: 0, skipped: 0 };
    const misconfigured = new Set<string>();

    // ── Pass 1: rows that can actually be refreshed ──────────────────────────
    const { data: dueRows, error: dueErr } = await admin
      .from("connected_account_secrets")
      .select(
        "connected_account_id, refresh_token_ciphertext, refresh_failures, expires_at,"
        + " connected_accounts!inner(provider, connection_status)",
      )
      .lte("refresh_after", nowIso)
      .not("refresh_token_ciphertext", "is", null)
      .limit(200);

    if (dueErr) throw dueErr;

    const rows = (dueRows || []) as unknown as SecretRow[];
    summary.due = rows.length;

    for (const row of rows) {
      const provider = String(row.connected_accounts?.provider || "").toLowerCase();
      const config = PROVIDERS[provider];

      // A provider with no refresh config is not an error — it is a platform
      // whose adapter has not landed yet. Left untouched so its row stays due
      // and it starts refreshing the moment support is added.
      if (!config) { summary.skipped += 1; continue; }

      // Our own misconfiguration — skip without claiming or counting failures.
      if (!providerConfigured(config)) {
        misconfigured.add(provider);
        summary.skipped += 1;
        continue;
      }

      if (!(await claimRow(admin, row.connected_account_id, nowIso))) {
        summary.skipped += 1;
        continue;
      }
      summary.claimed += 1;

      try {
        const currentRefresh = await decryptToken(row.refresh_token_ciphertext as string);
        const next = await refreshWithProvider(config, currentRefresh);

        const lifetime = next.expiresInSeconds;
        const patch: Record<string, unknown> = {
          access_token_ciphertext: await encryptToken(next.accessToken),
          expires_at: lifetime ? new Date(Date.now() + lifetime * 1000).toISOString() : null,
          refresh_after: lifetime
            ? new Date(Date.now() + lifetime * 1000 * REFRESH_AT_FRACTION).toISOString()
            // No stated lifetime: come back in an hour rather than never. The
            // claim already moved refresh_after forward, so "never" would mean
            // this row silently stops refreshing.
            : new Date(Date.now() + 3_600_000).toISOString(),
          last_refreshed_at: new Date().toISOString(),
          refresh_failures: 0,
          last_refresh_error: null,
          updated_at: new Date().toISOString(),
        };

        // Persist the rotated refresh token. Skipping this is the single
        // failure that cannot be recovered without the user reconnecting.
        if (next.refreshToken) {
          patch.refresh_token_ciphertext = await encryptToken(next.refreshToken);
        }
        if (next.grantedScopes) patch.granted_scopes = next.grantedScopes;

        const { error: updErr } = await admin
          .from("connected_account_secrets")
          .update(patch)
          .eq("connected_account_id", row.connected_account_id);
        if (updErr) throw updErr;

        // An account previously parked as expired is working again.
        if (row.connected_accounts?.connection_status === "expired") {
          await admin
            .from("connected_accounts")
            .update({ connection_status: "active" })
            .eq("id", row.connected_account_id);
        }

        summary.refreshed += 1;
      } catch (err) {
        const message = (err as Error).message || "unknown_error";
        const failures = (row.refresh_failures || 0) + 1;
        const terminal = isTerminalRejection(message) || failures >= MAX_REFRESH_FAILURES;

        await admin
          .from("connected_account_secrets")
          .update({
            refresh_failures: failures,
            last_refresh_error: message.slice(0, 300),
            // Terminal: stop retrying, the user must reconnect. Otherwise let
            // the claim lapse so the next run picks it up.
            refresh_after: terminal
              ? null
              : new Date(Date.now() + 15 * 60_000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("connected_account_id", row.connected_account_id);

        if (terminal) {
          await admin
            .from("connected_accounts")
            .update({ connection_status: "expired" })
            .eq("id", row.connected_account_id);
          summary.expired += 1;
        }

        // Logged without the token values; message is a provider error code.
        console.error(
          `[refresh-social-tokens] ${provider} account ${row.connected_account_id} failed`,
          `(attempt ${failures}${terminal ? ", terminal" : ""}): ${message}`,
        );
        summary.failed += 1;
      }
    }

    // ── Pass 2: tokens nobody can refresh, now actually expired ──────────────
    //
    // LinkedIn standard tier. There is no refresh token, so the only honest
    // action is to tell the user the connection needs re-authorising, using the
    // same `expired` status the UI already understands.
    const { data: staleRows, error: staleErr } = await admin
      .from("connected_account_secrets")
      .select("connected_account_id, connected_accounts!inner(connection_status)")
      .is("refresh_token_ciphertext", null)
      .not("expires_at", "is", null)
      .lte("expires_at", nowIso)
      .limit(200);

    if (staleErr) throw staleErr;

    for (const row of (staleRows || []) as unknown as SecretRow[]) {
      if (row.connected_accounts?.connection_status === "expired") continue;
      await admin
        .from("connected_accounts")
        .update({ connection_status: "expired" })
        .eq("id", row.connected_account_id);
      summary.expired += 1;
    }

    // Loud, and in the response body: a run that refreshed nothing because a
    // secret is unset must not look like a run that had nothing to do.
    if (misconfigured.size > 0) {
      console.error(
        "[refresh-social-tokens] NOT CONFIGURED for: "
        + `${[...misconfigured].join(", ")}. Set the client key/secret for these `
        + "providers as Supabase secrets. Accounts were left untouched.",
      );
    }

    return jsonResponse({
      ok: misconfigured.size === 0,
      ...summary,
      misconfigured: [...misconfigured],
    });
  } catch (error) {
    console.error("[refresh-social-tokens] run failed:", (error as Error).message);
    return jsonResponse(toErrorPayload(error), mapErrorToStatusCode(error));
  }
});
