/**
 * publisher.service.ts — Real social platform publisher
 *
 * Each platform function takes a post + connected_account row and makes the
 * actual API call to publish. The calling function (publish-post) decides
 * whether to use mock or real based on account.is_mock.
 *
 * STATUS PER PLATFORM (June 2026):
 *   Instagram   — code complete; needs INSTAGRAM_APP_ID + INSTAGRAM_APP_SECRET in Supabase secrets
 *   LinkedIn    — code complete; needs LINKEDIN_CLIENT_ID + LINKEDIN_CLIENT_SECRET
 *   X / Twitter — code complete; needs X_CLIENT_ID + X_CLIENT_SECRET
 *   TikTok      — code complete; needs TIKTOK_CLIENT_KEY + TIKTOK_CLIENT_SECRET
 *
 * All platforms: activate by adding app credentials as Supabase secrets once
 * your developer app is approved by each platform.
 */

import { isConnectedStatus } from "./connectionHelpers.ts";
import { readEnv } from "./env.ts";

// ── Types ──────────────────────────────────────────────────────────────────────

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

const TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000;
const REAL_PLATFORM_REFRESH_ENV_KEYS: Record<string, string[]> = {
  instagram: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"],
  facebook: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"],
  linkedin: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
  x: ["X_CLIENT_ID", "X_CLIENT_SECRET"],
  twitter: ["X_CLIENT_ID", "X_CLIENT_SECRET"],
  tiktok: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
};

function failure(failureReason: string, retriable = false): PublishResult {
  return {
    success: false,
    platformPostId: null,
    platformPostUrl: null,
    failureReason,
    retriable,
  };
}

function normalizePlatform(platform: unknown) {
  const normalized = String(platform || "").trim().toLowerCase();
  return normalized === "twitter" ? "x" : normalized;
}

function getTokenExpiryMs(account: Record<string, unknown>) {
  if (!account.token_expires_at) return Infinity;
  const expiresAt = new Date(String(account.token_expires_at)).getTime();
  return Number.isFinite(expiresAt) ? expiresAt : Infinity;
}

function validateRealPublishInput(input: PublishInput): PublishResult | null {
  const { account, mediaUrl } = input;
  const platform = normalizePlatform(account.platform);
  const accessToken = String(account.access_token || "").trim();
  const accountId = String(account.account_id || "").trim();
  const supportedPlatforms = new Set(["instagram", "facebook", "linkedin", "x", "tiktok"]);

  if (!supportedPlatforms.has(platform)) {
    return failure(`Platform "${platform}" is not yet supported for real publishing`);
  }

  if (!isConnectedStatus(String(account.connection_status || "active"))) {
    return failure("Connected account is not active. Reconnect the account before publishing.");
  }

  if (!accessToken) {
    return failure("Connected account is missing an access token. Reconnect the account before publishing.");
  }

  if (["instagram", "facebook", "linkedin"].includes(platform) && !accountId) {
    return failure("Connected account is missing its platform account id. Reconnect the account before publishing.");
  }

  if (["instagram", "facebook", "tiktok"].includes(platform) && !mediaUrl) {
    return failure(`${platform} publishing requires a public media URL.`);
  }

  if (getTokenExpiryMs(account) <= Date.now() + TOKEN_REFRESH_WINDOW_MS) {
    const refreshToken = String(account.refresh_token || "").trim();
    if (!refreshToken) {
      return failure("Connected account token has expired. Reconnect the account before publishing.");
    }

    const missingRefreshEnv = (REAL_PLATFORM_REFRESH_ENV_KEYS[platform] || [])
      .filter((key) => !readEnv(key, false));
    if (missingRefreshEnv.length > 0) {
      return failure(`Token refresh is not configured for ${platform}. Missing: ${missingRefreshEnv.join(", ")}`);
    }
  }

  return null;
}

// ── Token refresh ─────────────────────────────────────────────────────────────

export async function refreshTokenIfNeeded(
  account: Record<string, unknown>,
): Promise<string> {
  const accessToken = String(account.access_token || "");
  const expiresAt = account.token_expires_at
    ? new Date(String(account.token_expires_at)).getTime()
    : Infinity;

  // If token expires in < 5 minutes, refresh it
  if (Date.now() + 5 * 60 * 1000 < expiresAt) return accessToken;

  const platform = String(account.platform || "").toLowerCase();
  const refreshToken = String(account.refresh_token || "");
  if (!refreshToken) return accessToken; // can't refresh without refresh token

  switch (platform) {
    case "instagram":
    case "facebook": {
      const appId = readEnv("INSTAGRAM_APP_ID", false);
      const appSecret = readEnv("INSTAGRAM_APP_SECRET", false);
      if (!appId || !appSecret) return accessToken;
      const res = await fetch(
        `https://graph.facebook.com/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${accessToken}`,
      );
      if (!res.ok) return accessToken;
      const data = await res.json();
      return data.access_token || accessToken;
    }
    case "linkedin": {
      const clientId = readEnv("LINKEDIN_CLIENT_ID", false);
      const clientSecret = readEnv("LINKEDIN_CLIENT_SECRET", false);
      if (!clientId || !clientSecret) return accessToken;
      const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });
      if (!res.ok) return accessToken;
      const data = await res.json();
      return data.access_token || accessToken;
    }
    case "x":
    case "twitter": {
      const clientId = readEnv("X_CLIENT_ID", false);
      const clientSecret = readEnv("X_CLIENT_SECRET", false);
      if (!clientId || !clientSecret) return accessToken;
      const credentials = btoa(`${clientId}:${clientSecret}`);
      const res = await fetch("https://api.twitter.com/2/oauth2/token", {
        method: "POST",
        headers: {
          "Authorization": `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      });
      if (!res.ok) return accessToken;
      const data = await res.json();
      return data.access_token || accessToken;
    }
    case "tiktok": {
      const clientKey = readEnv("TIKTOK_CLIENT_KEY", false);
      const clientSecret = readEnv("TIKTOK_CLIENT_SECRET", false);
      if (!clientKey || !clientSecret) return accessToken;
      const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: clientKey,
          client_secret: clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      });
      if (!res.ok) return accessToken;
      const data = await res.json();
      return data.access_token || accessToken;
    }
    default:
      return accessToken;
  }
}

// ── Instagram (Meta Graph API) ────────────────────────────────────────────────

export async function publishToInstagram(input: PublishInput): Promise<PublishResult> {
  const { post, account, mediaUrl } = input;
  const token = await refreshTokenIfNeeded(account);
  const igUserId = String(account.account_id || "");
  const caption = String(post.caption || "");
  const hashtags = Array.isArray(post.hashtags) ? (post.hashtags as string[]).join(" ") : "";
  const fullCaption = hashtags ? `${caption}\n\n${hashtags}` : caption;

  try {
    // Step 1: Create media container
    const mediaType = String(post.media_type || "IMAGE").toUpperCase();
    const containerBody: Record<string, string> = {
      caption: fullCaption,
      access_token: token,
    };

    if (mediaType === "VIDEO" || mediaType === "REEL") {
      containerBody.media_type = "REELS";
      containerBody.video_url = String(mediaUrl || "");
    } else {
      containerBody.image_url = String(mediaUrl || "");
    }

    const containerRes = await fetch(
      `https://graph.instagram.com/v19.0/${igUserId}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(containerBody),
      },
    );

    if (!containerRes.ok) {
      const err = await containerRes.json();
      return {
        success: false,
        platformPostId: null,
        platformPostUrl: null,
        failureReason: err?.error?.message || "Failed to create Instagram media container",
        retriable: containerRes.status >= 500,
      };
    }

    const container = await containerRes.json();
    const creationId = container.id;

    // Step 2: Publish container
    const publishRes = await fetch(
      `https://graph.instagram.com/v19.0/${igUserId}/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creation_id: creationId, access_token: token }),
      },
    );

    if (!publishRes.ok) {
      const err = await publishRes.json();
      return {
        success: false,
        platformPostId: null,
        platformPostUrl: null,
        failureReason: err?.error?.message || "Failed to publish Instagram media",
        retriable: publishRes.status >= 500,
      };
    }

    const published = await publishRes.json();
    const postId = published.id;
    const username = String(account.username || account.account_name || "");
    return {
      success: true,
      platformPostId: postId,
      platformPostUrl: `https://www.instagram.com/p/${postId}/`,
      failureReason: null,
      retriable: false,
    };
  } catch (err) {
    return {
      success: false,
      platformPostId: null,
      platformPostUrl: null,
      failureReason: err instanceof Error ? err.message : "Unknown Instagram error",
      retriable: true,
    };
  }
}

// ── LinkedIn ──────────────────────────────────────────────────────────────────

export async function publishToLinkedIn(input: PublishInput): Promise<PublishResult> {
  const { post, account, mediaUrl } = input;
  const token = await refreshTokenIfNeeded(account);
  const personUrn = String(account.account_id || "");
  const caption = String(post.caption || "");

  try {
    const body: Record<string, unknown> = {
      author: `urn:li:person:${personUrn}`,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: caption },
          shareMediaCategory: mediaUrl ? "IMAGE" : "NONE",
          ...(mediaUrl ? {
            media: [{
              status: "READY",
              description: { text: caption.slice(0, 200) },
              originalUrl: mediaUrl,
            }],
          } : {}),
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    };

    const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json();
      return {
        success: false,
        platformPostId: null,
        platformPostUrl: null,
        failureReason: err?.message || "LinkedIn publish failed",
        retriable: res.status >= 500,
      };
    }

    const postId = res.headers.get("x-restli-id") || "";
    return {
      success: true,
      platformPostId: postId,
      platformPostUrl: `https://www.linkedin.com/feed/update/${postId}/`,
      failureReason: null,
      retriable: false,
    };
  } catch (err) {
    return {
      success: false,
      platformPostId: null,
      platformPostUrl: null,
      failureReason: err instanceof Error ? err.message : "Unknown LinkedIn error",
      retriable: true,
    };
  }
}

// ── X / Twitter (API v2) ──────────────────────────────────────────────────────

export async function publishToX(input: PublishInput): Promise<PublishResult> {
  const { post, account } = input;
  const token = await refreshTokenIfNeeded(account);
  const caption = String(post.caption || "");
  // X has 280 char limit — truncate if needed
  const text = caption.length > 280 ? caption.slice(0, 277) + "…" : caption;

  try {
    const res = await fetch("https://api.twitter.com/2/tweets", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      const err = await res.json();
      return {
        success: false,
        platformPostId: null,
        platformPostUrl: null,
        failureReason: err?.detail || err?.title || "X publish failed",
        retriable: res.status >= 500,
      };
    }

    const data = await res.json();
    const tweetId = data?.data?.id;
    const username = String(account.username || "");
    return {
      success: true,
      platformPostId: tweetId,
      platformPostUrl: username ? `https://x.com/${username}/status/${tweetId}` : `https://x.com/i/web/status/${tweetId}`,
      failureReason: null,
      retriable: false,
    };
  } catch (err) {
    return {
      success: false,
      platformPostId: null,
      platformPostUrl: null,
      failureReason: err instanceof Error ? err.message : "Unknown X error",
      retriable: true,
    };
  }
}

// ── TikTok ────────────────────────────────────────────────────────────────────

export async function publishToTikTok(input: PublishInput): Promise<PublishResult> {
  const { post, account, mediaUrl } = input;
  const token = await refreshTokenIfNeeded(account);
  const caption = String(post.caption || "");

  try {
    // TikTok Content Posting API (video required)
    if (!mediaUrl) {
      return {
        success: false,
        platformPostId: null,
        platformPostUrl: null,
        failureReason: "TikTok requires a video URL",
        retriable: false,
      };
    }

    const res = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        post_info: {
          title: caption.slice(0, 150),
          privacy_level: "PUBLIC_TO_EVERYONE",
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
          video_cover_timestamp_ms: 1000,
        },
        source_info: {
          source: "PULL_FROM_URL",
          video_url: mediaUrl,
        },
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      return {
        success: false,
        platformPostId: null,
        platformPostUrl: null,
        failureReason: err?.error?.message || "TikTok publish failed",
        retriable: res.status >= 500,
      };
    }

    const data = await res.json();
    const publishId = data?.data?.publish_id;
    return {
      success: true,
      platformPostId: publishId,
      platformPostUrl: `https://www.tiktok.com/@${account.username || ""}`,
      failureReason: null,
      retriable: false,
    };
  } catch (err) {
    return {
      success: false,
      platformPostId: null,
      platformPostUrl: null,
      failureReason: err instanceof Error ? err.message : "Unknown TikTok error",
      retriable: true,
    };
  }
}

// ── Router: dispatch to correct platform ──────────────────────────────────────

export async function publishToRealPlatform(input: PublishInput): Promise<PublishResult> {
  const readinessFailure = validateRealPublishInput(input);
  if (readinessFailure) return readinessFailure;

  const platform = normalizePlatform(input.account.platform);

  switch (platform) {
    case "instagram":
    case "facebook":
      return publishToInstagram(input);
    case "linkedin":
      return publishToLinkedIn(input);
    case "x":
      return publishToX(input);
    case "tiktok":
      return publishToTikTok(input);
    default:
      return failure(`Platform "${platform}" is not yet supported for real publishing`);
  }
}
