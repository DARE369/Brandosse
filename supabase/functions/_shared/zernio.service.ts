/**
 * zernio.service.ts — shared Zernio client for Supabase Edge Functions (Deno).
 *
 * Wraps the Zernio unified social-posting REST API directly (no SDK — Deno-safe,
 * same pattern as fal.service.ts).
 * Docs: https://docs.zernio.com/
 *
 * Provider: Zernio (https://zernio.com)
 * Auth:     ZERNIO_API_KEY secret (set via: npx supabase secrets set ZERNIO_API_KEY=...)
 *
 * Zernio is a unified API over 15 social platforms — it holds the platform app
 * registrations itself, so connecting an account goes through Zernio's own
 * OAuth (GET /connect/{platform}) instead of Brandosse applying for its own
 * developer app on each platform (that per-platform path is publisher.service.ts,
 * kept as a separate, parallel provider — see connected_accounts.provider).
 *
 * Every Brandosse user maps to exactly one Zernio "profile" (Zernio's own
 * multi-tenant grouping concept), stored at profiles.zernio_profile_id and
 * created lazily via ensureZernioProfile() on first connect.
 */

import type { DatabaseClient } from "./supabase.ts";
import { readEnv } from "./env.ts";

const ZERNIO_BASE = "https://zernio.com/api/v1";

// ── Types ──────────────────────────────────────────────────────────────────────
// (formerly imported from publisher.service.ts, the direct-per-platform-OAuth
// path — removed; Zernio is the only real-publish provider now)

export interface PublishResult {
  success: boolean;
  platformPostId: string | null;
  platformPostUrl: string | null;
  failureReason: string | null;
  retriable: boolean;
}

export interface PublishInput {
  post: Record<string, unknown>;
  account: Record<string, unknown>;
  mediaUrl?: string | null;
}

function getZernioKey(): string {
  return readEnv("ZERNIO_API_KEY");
}

function zernioHeaders(apiKey: string) {
  return {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

async function checkZernioError(res: Response, context: string): Promise<void> {
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`Zernio ${context} failed (${res.status}): ${body}`);
  }
}

// ── Profiles ─────────────────────────────────────────────────────────────────

export interface ZernioAccount {
  _id: string;
  platform: string;
  username?: string;
  displayName?: string;
}

/**
 * Reads profiles.zernio_profile_id; creates a Zernio profile and persists the
 * id on first call for a given user. One profile per Brandosse user, reused
 * for every platform they connect through Zernio.
 */
export async function ensureZernioProfile(
  adminClient: DatabaseClient,
  userId: string,
): Promise<string> {
  const { data: profileRow, error: readErr } = await adminClient
    .from("profiles")
    .select("zernio_profile_id")
    .eq("id", userId)
    .maybeSingle();
  if (readErr) throw readErr;

  const existing = profileRow?.zernio_profile_id as string | undefined;
  if (existing) return existing;

  const apiKey = getZernioKey();
  const res = await fetch(`${ZERNIO_BASE}/profiles`, {
    method: "POST",
    headers: zernioHeaders(apiKey),
    body: JSON.stringify({ name: `brandosse-user-${userId}` }),
  });
  await checkZernioError(res, "create profile");
  const data = await res.json();
  const profileId = data?.profile?._id;
  if (!profileId) throw new Error("Zernio did not return a profile id");

  const { error: writeErr } = await adminClient
    .from("profiles")
    .update({ zernio_profile_id: profileId })
    .eq("id", userId);
  if (writeErr) throw writeErr;

  return profileId;
}

// ── Connect ──────────────────────────────────────────────────────────────────

export async function getZernioConnectUrl(
  platform: string,
  profileId: string,
  redirectUrl: string,
): Promise<string> {
  const apiKey = getZernioKey();
  const url = `${ZERNIO_BASE}/connect/${encodeURIComponent(platform)}` +
    `?profileId=${encodeURIComponent(profileId)}&redirect_url=${encodeURIComponent(redirectUrl)}`;
  const res = await fetch(url, { headers: zernioHeaders(apiKey) });
  await checkZernioError(res, "connect");
  const data = await res.json();
  if (!data?.authUrl) throw new Error("Zernio did not return an authUrl");
  return data.authUrl;
}

export async function listZernioAccounts(profileId: string): Promise<ZernioAccount[]> {
  const apiKey = getZernioKey();
  const res = await fetch(`${ZERNIO_BASE}/accounts?profileId=${encodeURIComponent(profileId)}`, {
    headers: zernioHeaders(apiKey),
  });
  await checkZernioError(res, "list accounts");
  const data = await res.json();
  return Array.isArray(data?.accounts) ? data.accounts : [];
}

// ── Publish ──────────────────────────────────────────────────────────────────

/**
 * Publishes a post via Zernio's unified /posts endpoint. Returns the same
 * PublishResult shape publisher.service.ts's publishToRealPlatform() returns,
 * so publish-post/index.ts's retry/health-score bookkeeping doesn't need to
 * know which provider actually ran.
 */
export async function publishToZernio(input: PublishInput): Promise<PublishResult> {
  const { post, account, mediaUrl } = input;
  const platform = String(account.platform || "").trim().toLowerCase();
  const accountId = String(account.account_id || "").trim();

  if (!accountId) {
    return {
      success: false,
      platformPostId: null,
      platformPostUrl: null,
      failureReason: "Connected account is missing its Zernio account id. Reconnect the account before publishing.",
      retriable: false,
    };
  }

  // Zernio's own TikTok guide: "No text-only posts (media required)".
  if (platform === "tiktok" && !mediaUrl) {
    return {
      success: false,
      platformPostId: null,
      platformPostUrl: null,
      failureReason: "TikTok requires a video URL.",
      retriable: false,
    };
  }

  const caption = String(post.caption || "");
  const hashtags = Array.isArray(post.hashtags) ? (post.hashtags as string[]).join(" ") : "";
  const content = hashtags ? `${caption}\n\n${hashtags}` : caption;

  const platformEntry: Record<string, unknown> = { platform, accountId };
  // Best-effort TikTok defaults (mirrors publisher.service.ts's direct-TikTok
  // publicTo-everyone default). Zernio's own docs give inconsistent field
  // placement for TikTok settings across pages (top-level tiktokSettings vs.
  // inlined per-platform fields) — inlined here per the official Python SDK's
  // literal example (client.posts.create(..., platforms=[{"platform": "x",
  // "accountId": "...", "<platform>Title": "..."}])). NOT yet confirmed
  // against a live call — if a real publish fails on an "unknown field" or
  // "missing field" error, adjust this block first.
  if (platform === "tiktok") {
    platformEntry.privacy_level = "PUBLIC_TO_EVERYONE";
    platformEntry.allow_comment = true;
    platformEntry.allow_duet = true;
    platformEntry.allow_stitch = true;
    platformEntry.content_preview_confirmed = true;
    platformEntry.express_consent_given = true;
  }

  const apiKey = getZernioKey();
  try {
    const res = await fetch(`${ZERNIO_BASE}/posts`, {
      method: "POST",
      headers: zernioHeaders(apiKey),
      body: JSON.stringify({
        content,
        publishNow: true,
        platforms: [platformEntry],
        // Field name per the official Python SDK's literal example
        // (media_urls=[...]) — same live-verification caveat as above.
        ...(mediaUrl ? { media_urls: [mediaUrl] } : {}),
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return {
        success: false,
        platformPostId: null,
        platformPostUrl: null,
        failureReason: err?.error || err?.message || "Zernio publish failed",
        retriable: res.status >= 500,
      };
    }

    const data = await res.json();
    const postId = data?.post?._id ?? null;
    return {
      success: true,
      platformPostId: postId,
      // Zernio's create-post response doesn't include a platform permalink;
      // it's only available via a later GET /posts/{id}, which v1 (sync
      // response only) doesn't call.
      platformPostUrl: null,
      failureReason: null,
      retriable: false,
    };
  } catch (err) {
    return {
      success: false,
      platformPostId: null,
      platformPostUrl: null,
      failureReason: err instanceof Error ? err.message : "Unknown Zernio error",
      retriable: true,
    };
  }
}
