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
  // Set when the post still succeeded but something was silently adjusted
  // to fit a platform constraint (e.g. a caption shortened for TikTok's
  // photo-post title limit) — surfaced to the user so a modified caption is
  // never a surprise.
  note?: string | null;
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

  // Zernio's own TikTok guide: "No text-only posts (media required)" — both
  // photo and video are supported (just not mixed in the same post).
  if (platform === "tiktok" && !mediaUrl) {
    return {
      success: false,
      platformPostId: null,
      platformPostUrl: null,
      failureReason: "TikTok requires an image or video.",
      retriable: false,
    };
  }

  const caption = String(post.caption || "");
  const hashtags = Array.isArray(post.hashtags) ? (post.hashtags as string[]).join(" ") : "";
  let content = hashtags ? `${caption}\n\n${hashtags}` : caption;

  const generationRow = Array.isArray(post.generations) ? post.generations[0] : post.generations;
  const rawMediaType = String((generationRow as Record<string, unknown> | undefined)?.media_type || "image").toLowerCase();
  const mediaType = rawMediaType.includes("video") ? "video" : "image";

  // TikTok photo/slideshow posts reuse `content` as the post's title, which
  // TikTok hard-caps at 90 characters (video posts have no such limit) —
  // confirmed live via a real Zernio rejection. Rather than failing the
  // publish outright, auto-fit it: drop hashtags first (least essential part
  // of a 90-char title, and usually what pushes it over), then truncate the
  // caption itself if it's still too long on its own. `publishNote` carries
  // this back so a silently-shortened caption is never a surprise — surfaced
  // in the publish result UI, not just swallowed.
  const TIKTOK_PHOTO_TITLE_LIMIT = 90;
  let publishNote: string | null = null;
  if (platform === "tiktok" && mediaType === "image" && content.length > TIKTOK_PHOTO_TITLE_LIMIT) {
    const originalLength = content.length;
    content = caption.length > TIKTOK_PHOTO_TITLE_LIMIT
      ? `${caption.slice(0, TIKTOK_PHOTO_TITLE_LIMIT - 1)}…`
      : caption;
    publishNote = `Caption shortened from ${originalLength} to ${content.length} characters to fit TikTok's ${TIKTOK_PHOTO_TITLE_LIMIT}-character photo-post title limit${hashtags ? " (hashtags dropped)" : ""}.`;
  }

  const platformEntry: Record<string, unknown> = { platform, accountId };

  // Confirmed 2026-07-17 against docs.zernio.com: TikTok is the one platform
  // whose settings live in a top-level `tiktokSettings` object, not inlined
  // on the platform entry and not under `platformSpecificData` (every other
  // platform uses platformSpecificData) — this was previously guessed wrong
  // (inlined on platformEntry), which is why real TikTok publishes failed
  // with "tiktok posts require media content" even when media was attached:
  // Zernio never saw a recognized media field at all (see below).
  const body: Record<string, unknown> = {
    content,
    publishNow: true,
    platforms: [platformEntry],
    // Confirmed field name/shape: top-level `mediaItems`, each entry
    // `{ type: "image" | "video", url }` — NOT `media_urls: [url]`, which
    // Zernio silently didn't recognize (hence "requires media content" even
    // with a valid media URL passed the old way).
    ...(mediaUrl ? { mediaItems: [{ type: mediaType, url: mediaUrl }] } : {}),
  };

  if (platform === "tiktok") {
    body.tiktokSettings = {
      privacy_level: "PUBLIC_TO_EVERYONE",
      allow_comment: true,
      allow_duet: true,
      allow_stitch: true,
      content_preview_confirmed: true,
      express_consent_given: true,
    };
  }

  const apiKey = getZernioKey();
  try {
    const res = await fetch(`${ZERNIO_BASE}/posts`, {
      method: "POST",
      headers: zernioHeaders(apiKey),
      body: JSON.stringify(body),
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
      note: publishNote,
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
