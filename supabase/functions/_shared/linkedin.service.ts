// supabase/functions/_shared/linkedin.service.ts
//
// LinkedIn publish adapter. Replaces the Zernio path for LinkedIn only —
// the other platforms keep routing through Zernio until each is migrated.
//
// ── API surface ──────────────────────────────────────────────────────────────
// POST /rest/posts, the versioned Posts API. /v2/ugcPosts and /v2/shares are
// deprecated, and Marketing version 202508 sunsets 2026-08-17.
//
// Every request carries:
//   Authorization: Bearer <token>
//   LinkedIn-Version: YYYYMM      <- pinned, never floating
//   X-Restli-Protocol-Version: 2.0.0
//
// The version is pinned for the same reason LOCK L4.7 forbids `-latest` model
// aliases: an unpinned version silently changes behaviour underneath a working
// integration, and LinkedIn sunsets versions on a schedule. Pinned, it fails
// loudly on a known date instead.
//
// ── Images are a three-step asynchronous upload ──────────────────────────────
//   1. POST /rest/images?action=initializeUpload  -> { uploadUrl, image URN }
//   2. PUT the binary to uploadUrl                 (single-use URL)
//   3. Poll GET /rest/images/{urn} until status = AVAILABLE
// Only then can the URN be referenced in a post. Skipping step 3 produces a
// post that references an image LinkedIn has not finished ingesting, which
// fails or renders blank.
//
// ── Timeouts on everything ───────────────────────────────────────────────────
// zernio.service.ts shipped four outbound calls with zero timeouts and left 20
// posts frozen in `publishing` for four months (20260821160000). Every call
// here has a deadline, and the polling loop has a hard ceiling.

import { decryptToken } from "./tokenCrypto.ts";
import { safeFetch } from "./safeFetch.ts";

const API = "https://api.linkedin.com";
const DEFAULT_VERSION = "202607";

const TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 60_000;   // a binary upload legitimately takes longer
const IMAGE_POLL_ATTEMPTS = 10;
const IMAGE_POLL_DELAY_MS = 1_500;

/** LinkedIn's own documented caption ceiling. */
const COMMENTARY_MAX = 3000;

export type PublishResult = {
  success: boolean;
  platformPostId: string | null;
  platformPostUrl: string | null;
  failureReason: string | null;
  retriable: boolean;
  note?: string | null;
};

function version(): string {
  return Deno.env.get("LINKEDIN_VERSION") || DEFAULT_VERSION;
}

function headers(token: string, extra: Record<string, string> = {}): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "LinkedIn-Version": version(),
    "X-Restli-Protocol-Version": "2.0.0",
    ...extra,
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  ms = TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw new Error("linkedin_timeout");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Is this failure worth retrying?
 *
 * Getting this wrong in either direction is expensive: retrying a 400 burns
 * quota forever on a post that can never succeed, and NOT retrying a 503
 * silently drops content the user scheduled.
 */
function isRetriable(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

/** Map a LinkedIn error onto something a person can act on. */
function describeError(status: number, body: string): string {
  const snippet = body.slice(0, 300);
  switch (status) {
    case 401:
      return "LinkedIn signed you out. Reconnect the account to keep publishing.";
    case 403:
      return "LinkedIn refused this post: the account is missing the posting permission. Reconnect and approve posting.";
    case 422:
      return `LinkedIn rejected the post content: ${snippet}`;
    case 429:
      return "LinkedIn rate limit reached. This will be retried automatically.";
    default:
      if (status >= 500) return "LinkedIn is having problems. This will be retried automatically.";
      return `LinkedIn rejected the post (HTTP ${status}): ${snippet}`;
  }
}

// ── Image upload ─────────────────────────────────────────────────────────────

async function uploadImage(
  token: string,
  ownerUrn: string,
  mediaUrl: string,
): Promise<string> {
  // 1. Register the upload and claim an image URN.
  const initRes = await fetchWithTimeout(`${API}/rest/images?action=initializeUpload`, {
    method: "POST",
    headers: headers(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ initializeUploadRequest: { owner: ownerUrn } }),
  });

  if (!initRes.ok) {
    const body = await initRes.text().catch(() => "");
    throw new Error(`image_init_failed:${initRes.status}:${body.slice(0, 200)}`);
  }

  const init = await initRes.json();
  const uploadUrl: string | undefined = init?.value?.uploadUrl;
  const imageUrn: string | undefined = init?.value?.image;
  if (!uploadUrl || !imageUrn) throw new Error("image_init_failed:malformed_response");

  // 2. Fetch the asset, then PUT the bytes.
  //
  // THIS URL IS CALLER-INFLUENCEABLE. mediaUrl comes from
  // generations.output_url / storage_path, which is row data, not a constant.
  // A bare fetch here would be SSRF with an unusually good exfiltration
  // channel: we would fetch an internal address and then upload whatever came
  // back to a public LinkedIn post. safeFetch re-validates every redirect hop,
  // which is what defeats the usual bypass of checking only the first URL.
  let bytes: Uint8Array;
  try {
    const asset = await safeFetch(mediaUrl, {
      timeoutMs: UPLOAD_TIMEOUT_MS,
      maxBytes: 20 * 1024 * 1024,
      // LinkedIn accepts JPG, PNG and GIF. Asserting it here stops an HTML
      // error page being uploaded as though it were an image.
      expectContentType: /^image\/(jpeg|jpg|png|gif)/i,
      context: "linkedin:image-upload",
    });
    bytes = asset.bytes;
  } catch (err) {
    throw new Error(`image_source_unreadable:${(err as Error).message}`);
  }
  if (bytes.byteLength === 0) throw new Error("image_source_empty");

  const putRes = await fetchWithTimeout(uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: bytes,
  }, UPLOAD_TIMEOUT_MS);

  if (!putRes.ok) {
    const body = await putRes.text().catch(() => "");
    throw new Error(`image_upload_failed:${putRes.status}:${body.slice(0, 200)}`);
  }

  // 3. Wait for ingestion. Referencing an image before it is AVAILABLE yields
  //    a post that fails or renders blank, so this is not optional.
  const encoded = encodeURIComponent(imageUrn);
  for (let attempt = 0; attempt < IMAGE_POLL_ATTEMPTS; attempt += 1) {
    await new Promise((r) => setTimeout(r, IMAGE_POLL_DELAY_MS));

    const statusRes = await fetchWithTimeout(`${API}/rest/images/${encoded}`, {
      headers: headers(token),
    });
    if (!statusRes.ok) continue;

    const status = (await statusRes.json())?.status;
    if (status === "AVAILABLE") return imageUrn;
    if (status === "PROCESSING_FAILED" || status === "CLIENT_ERROR") {
      throw new Error(`image_processing_failed:${status}`);
    }
  }

  // Bounded, so a stuck ingestion surfaces as a real failure rather than
  // holding the publish open indefinitely.
  throw new Error("image_processing_timeout");
}

// ── Publish ──────────────────────────────────────────────────────────────────

export async function publishToLinkedIn({
  post,
  account,
  secret,
  mediaUrl,
}: {
  post: Record<string, unknown>;
  account: Record<string, unknown>;
  secret: Record<string, unknown> | null;
  mediaUrl: string | null;
}): Promise<PublishResult> {
  const fail = (reason: string, retriable = false): PublishResult => ({
    success: false, platformPostId: null, platformPostUrl: null,
    failureReason: reason, retriable,
  });

  // ── Credentials ────────────────────────────────────────────────────────────
  const ciphertext = secret?.access_token_ciphertext as string | undefined;
  if (!ciphertext) {
    return fail("This LinkedIn account has no stored credential. Reconnect it to publish.");
  }

  let token: string;
  try {
    token = await decryptToken(ciphertext);
  } catch (err) {
    // Undecryptable means the key rotated or the row was tampered with. Never
    // retriable: retrying cannot make a key correct, and a retry loop here
    // would burn the account's health score for a reason the user cannot see.
    console.error("[linkedin] token decrypt failed:", (err as Error).message);
    return fail("Stored LinkedIn credentials could not be read. Reconnect the account.");
  }

  const metadata = (account.platform_metadata ?? {}) as Record<string, unknown>;
  const authorUrn = (metadata.author_urn as string)
    || (account.account_id ? `urn:li:person:${account.account_id}` : null);
  if (!authorUrn) {
    return fail("This LinkedIn account is missing its author identifier. Reconnect it.");
  }

  // ── Commentary ─────────────────────────────────────────────────────────────
  const rawCaption = String(post.caption ?? post.title ?? "").trim();
  if (!rawCaption && !mediaUrl) {
    return fail("Nothing to post — add a caption or an image.");
  }
  if (rawCaption.length > COMMENTARY_MAX) {
    // Refuse rather than silently truncating. Losing the end of somebody's
    // post without telling them is a content-loss bug, and validation should
    // have caught this at compose time.
    return fail(
      `Caption is ${rawCaption.length} characters; LinkedIn's limit is ${COMMENTARY_MAX}. `
      + "Shorten it and try again.",
    );
  }

  // ── Optional image ─────────────────────────────────────────────────────────
  let imageUrn: string | null = null;
  if (mediaUrl) {
    try {
      imageUrn = await uploadImage(token, authorUrn, mediaUrl);
    } catch (err) {
      const message = (err as Error).message || "image_failed";
      const retriable = message === "linkedin_timeout"
        || message === "image_processing_timeout"
        || /:(5\d\d|429):/.test(message);
      return fail(`Could not attach the image to LinkedIn (${message}).`, retriable);
    }
  }

  // ── Create the post ────────────────────────────────────────────────────────
  const body: Record<string, unknown> = {
    author: authorUrn,
    commentary: rawCaption,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  if (imageUrn) {
    body.content = { media: { id: imageUrn, title: String(post.title ?? "").slice(0, 200) || undefined } };
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(`${API}/rest/posts`, {
      method: "POST",
      headers: headers(token, { "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
  } catch (err) {
    const message = (err as Error).message;
    // A timeout is genuinely ambiguous: the post may or may not exist. Say so
    // rather than reporting a clean failure the user would act on wrongly.
    if (message === "linkedin_timeout") {
      return {
        success: false, platformPostId: null, platformPostUrl: null,
        failureReason:
          "We lost contact with LinkedIn and cannot tell whether this published. "
          + "Check your LinkedIn profile before retrying.",
        retriable: false,
      };
    }
    return fail(`Could not reach LinkedIn (${message}).`, true);
  }

  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    return fail(describeError(res.status, raw), isRetriable(res.status));
  }

  // 201, with the post URN in the x-restli-id header rather than the body.
  const postUrn = res.headers.get("x-restli-id");
  if (!postUrn) {
    // Published, but we cannot record what. Report success — claiming failure
    // would invite a retry and duplicate the post on the user's feed.
    return {
      success: true, platformPostId: null, platformPostUrl: null, failureReason: null,
      retriable: false,
      note: "Published, but LinkedIn did not return a post id, so no link is available.",
    };
  }

  return {
    success: true,
    platformPostId: postUrn,
    platformPostUrl: `https://www.linkedin.com/feed/update/${postUrn}/`,
    failureReason: null,
    retriable: false,
  };
}

/**
 * Revoke the token at LinkedIn.
 *
 * Required by LinkedIn API Terms §4.4: content and tokens collected on a
 * user's behalf must be deleted immediately on their request. Deleting only
 * our row would leave a live grant the user believes they cancelled — a
 * privacy claim we would be breaking.
 *
 * Best-effort by design: if LinkedIn refuses, local deletion still proceeds,
 * because refusing to disconnect would be the worse failure.
 */
export async function revokeLinkedInToken(
  accessToken: string,
  clientId: string,
  clientSecret: string,
): Promise<boolean> {
  try {
    const res = await fetchWithTimeout("https://www.linkedin.com/oauth/v2/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: accessToken,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });
    return res.ok;
  } catch {
    return false;
  }
}
