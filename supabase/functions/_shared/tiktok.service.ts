// supabase/functions/_shared/tiktok.service.ts
//
// TikTok Direct Post adapter.
//
// ── Flow ─────────────────────────────────────────────────────────────────────
//   1. POST /v2/post/publish/video/init/   -> publish_id + upload_url
//   2. PUT the bytes to upload_url          (chunked, sequential)
//   3. POST /v2/post/publish/status/fetch/  -> poll until PUBLISH_COMPLETE
//
// Unlike LinkedIn, there is no synchronous "created" response. TikTok accepts
// the upload and processes asynchronously, so the publish is not real until
// the status endpoint says so. Returning success at step 2 would report posts
// as published that TikTok later rejected.
//
// ── FILE_UPLOAD rather than PULL_FROM_URL ────────────────────────────────────
// PULL_FROM_URL requires the media to sit on a TikTok-verified domain, and
// rejects pre-signed URLs from unverified hosts with url_ownership_unverified
// before the download even starts. Our media lives in Supabase storage, so
// FILE_UPLOAD is the only option that works without publishing media through
// our own verified domain.
//
// Note for later: PHOTO posts support PULL_FROM_URL ONLY. Photo carousels will
// need domain verification; this adapter is video-only for that reason.
//
// ── Unaudited clients ────────────────────────────────────────────────────────
// Until the app passes TikTok's content audit, privacy_level must be SELF_ONLY
// and the target account must be private, or init returns 403
// unaudited_client_can_only_post_to_private_accounts. That is surfaced as a
// specific, actionable message rather than a generic failure — the fix is a
// TikTok account setting, not anything the user can do in our app.

import { decryptToken } from "./tokenCrypto.ts";
import { safeFetch } from "./safeFetch.ts";
import { createMediaToken, mediaProxyUrl } from "./mediaToken.ts";

const API = "https://open.tiktokapis.com/v2";

const INIT_URL = `${API}/post/publish/video/init/`;
const STATUS_URL = `${API}/post/publish/status/fetch/`;

const TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 120_000;

// TikTok's documented chunk bounds.
const MIN_CHUNK = 5 * 1024 * 1024;        // 5 MB
const MAX_CHUNK = 64 * 1024 * 1024;       // 64 MB
const MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024;  // 4 GB
const TITLE_MAX = 2200;

// Processing typically takes 30s-2min. Poll on a gentle cadence: the status
// endpoint allows 30 requests/min per token, and hammering it wastes that
// budget without making TikTok faster.
const POLL_ATTEMPTS = 20;
const POLL_DELAY_MS = 6_000;

export type PublishResult = {
  success: boolean;
  platformPostId: string | null;
  platformPostUrl: string | null;
  failureReason: string | null;
  retriable: boolean;
  note?: string | null;
};

async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw new Error("tiktok_timeout");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Map a TikTok error code onto something the user can act on.
 *
 * Several of these are states of the user's own TikTok account, not faults in
 * our integration. Reporting them generically would send people looking in
 * entirely the wrong place.
 */
function describeError(code: string, httpStatus: number, raw: string): { message: string; retriable: boolean } {
  switch (code) {
    case "unaudited_client_can_only_post_to_private_accounts":
      return {
        message:
          "TikTok requires your account to be set to private while our integration is in review. "
          + "Set the account to private in TikTok, then try again.",
        retriable: false,
      };
    case "privacy_level_option_mismatch":
      return {
        message:
          "The privacy level chosen is no longer allowed for this account. "
          + "Reopen the post options and choose again.",
        retriable: false,
      };
    case "spam_risk_too_many_posts":
      return { message: "You have hit TikTok's daily posting limit for this account.", retriable: false };
    case "spam_risk_user_banned_from_posting":
      return { message: "TikTok has restricted posting on this account.", retriable: false };
    case "reached_active_user_cap":
      return { message: "TikTok's daily quota for this app is used up. This will retry tomorrow.", retriable: true };
    case "access_token_invalid":
      return { message: "TikTok signed you out. Reconnect the account to keep posting.", retriable: false };
    case "scope_not_authorized":
      return { message: "This account did not grant permission to post. Reconnect and approve posting.", retriable: false };
    case "rate_limit_exceeded":
      return { message: "TikTok rate limit reached. This will be retried automatically.", retriable: true };
    case "invalid_param":
      return { message: `TikTok rejected the post details: ${raw.slice(0, 200)}`, retriable: false };
    default:
      if (httpStatus >= 500) {
        return { message: "TikTok is having problems. This will be retried automatically.", retriable: true };
      }
      return { message: `TikTok rejected the post (${code || `HTTP ${httpStatus}`}).`, retriable: false };
  }
}

/**
 * Choose a chunk size and count that satisfy TikTok's rules.
 *
 * ── The trap ─────────────────────────────────────────────────────────────────
 * total_chunk_count is FLOOR(video_size / chunk_size), not ceil. The final
 * chunk absorbs the remainder and may exceed chunk_size (up to 128 MB).
 *
 * A naive ceil() produces a count one higher than TikTok expects, and the
 * upload fails partway through with an error that points at the bytes rather
 * than the arithmetic. This is the single easiest thing to get wrong here.
 */
function planChunks(videoSize: number): { chunkSize: number; totalChunks: number } {
  // Under the minimum: one chunk covering the whole file.
  if (videoSize <= MIN_CHUNK) {
    return { chunkSize: videoSize, totalChunks: 1 };
  }

  let chunkSize = MIN_CHUNK;

  // Cap at 1000 chunks by growing the chunk size, staying within MAX_CHUNK.
  if (Math.floor(videoSize / chunkSize) > 1000) {
    chunkSize = Math.min(MAX_CHUNK, Math.ceil(videoSize / 1000));
  }

  const totalChunks = Math.max(1, Math.floor(videoSize / chunkSize));
  return { chunkSize, totalChunks };
}

/**
 * Photo posts — a different TikTok API from video.
 *
 * ── The constraint that shapes this ─────────────────────────────────────────
 * TikTok's photo endpoint accepts PULL_FROM_URL ONLY ("PULL_FROM_URL is the
 * exclusive source type for photo posts"), and requires that the developer
 * "verify the ownership of the URL prefix or domain". TikTok's servers fetch
 * the image themselves, with no credential of ours.
 *
 * Our media lives on <project>.supabase.co, which we cannot verify — so the URL
 * handed to TikTok is a short-lived signed URL on OUR verified domain, served
 * by app/api/media/tiktok/[token]/route.js.
 *
 * ── Field limits differ from video ─────────────────────────────────────────
 * title 90 runes, description 4000 (video has one 2200-char title). The
 * composer collects a title for photo posts already — platformCaptionSpecs
 * lists titleForMedia: ["image", "carousel"].
 *
 * ── Interaction settings differ too ────────────────────────────────────────
 * TikTok: "Duet and Stitch features are not applicable to photo posts. So, for
 * Photo Posts, only 'Allow Comment' can be displayed in the UX." The panel
 * already hides them; this sends only disable_comment, and sending the other
 * two would contradict the guideline the panel follows.
 */
const PHOTO_INIT_URL = `${API}/post/publish/content/init/`;
const PHOTO_TITLE_MAX = 90;
const PHOTO_DESCRIPTION_MAX = 4000;

async function publishPhotoToTikTok({
  post,
  token,
  options,
  generationId,
  fail,
}: {
  post: Record<string, unknown>;
  token: string;
  options?: Record<string, unknown> | null;
  generationId?: string | null;
  fail: (reason: string, retriable?: boolean) => PublishResult;
}): Promise<PublishResult> {
  const privacyLevel = String(options?.privacyLevel ?? "").trim();
  if (!privacyLevel) {
    return fail(
      "No TikTok privacy level was chosen for this post. Open the post's TikTok options and pick one.",
    );
  }

  if (!generationId) {
    // Without the generation id there is nothing to mint a URL for. Saying so
    // beats letting TikTok fail to fetch a URL we never built.
    return fail("This post has no stored image to publish. Re-attach the photo and try again.");
  }

  const title = String(post.title ?? "").trim();
  const description = String(post.caption ?? "").trim();
  if (title.length > PHOTO_TITLE_MAX) {
    return fail(`Title is ${title.length} characters; TikTok's photo limit is ${PHOTO_TITLE_MAX}.`);
  }
  if (description.length > PHOTO_DESCRIPTION_MAX) {
    return fail(
      `Caption is ${description.length} characters; TikTok's photo limit is ${PHOTO_DESCRIPTION_MAX}.`,
    );
  }

  let photoUrl: string;
  try {
    const mediaToken = await createMediaToken({ generationId, postId: String(post.id ?? "") });
    photoUrl = mediaProxyUrl(Deno.env.get("APP_URL") ?? "", mediaToken);
  } catch (err) {
    // Configuration, not content: name the variable so it is fixable.
    console.error("[tiktok] could not build the photo URL:", (err as Error).message);
    return fail(`TikTok photo posting is not configured on the server: ${(err as Error).message}`);
  }

  const initBody = {
    media_type: "PHOTO",
    post_mode: "DIRECT_POST",
    post_info: {
      title,
      description,
      privacy_level: privacyLevel,
      // The panel reports what the user ALLOWED; TikTok wants what is DISABLED.
      disable_comment: options?.disableComment !== false,
      // Duet and stitch are deliberately ABSENT: TikTok does not apply them to
      // photo posts, and the panel does not offer them.
      brand_content_toggle: Boolean(options?.brandContentToggle),
      brand_organic_toggle: Boolean(options?.brandOrganicToggle),
    },
    source_info: {
      source: "PULL_FROM_URL",
      // One image today: a post carries one generation. TikTok accepts up to
      // 35, so carousels need multi-asset posts first — a composer change, not
      // an adapter one.
      photo_images: [photoUrl],
      photo_cover_index: 0,
    },
  };

  let initRes: Response;
  try {
    initRes = await fetchWithTimeout(PHOTO_INIT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify(initBody),
    });
  } catch (err) {
    const msg = (err as Error).message;
    return fail(`Could not reach TikTok (${msg}).`, msg === "tiktok_timeout");
  }

  const initRaw = await initRes.text();
  let initJson: Record<string, unknown> | null = null;
  try { initJson = JSON.parse(initRaw); } catch { /* handled below */ }

  const initErrCode = String((initJson?.error as Record<string, unknown> | undefined)?.code ?? "");
  if (!initRes.ok || (initErrCode && initErrCode !== "ok")) {
    // url_ownership_unverified is the one failure unique to this path, and its
    // remedy is in TikTok's portal, not in the post.
    if (/url_ownership_unverified|url_verification/i.test(initRaw)) {
      return fail(
        "TikTok will not fetch images from this domain: the URL prefix is not verified in the "
        + "TikTok developer portal. Verify https://www.brandosse.com/api/media/ under URL properties.",
      );
    }
    const { message, retriable } = describeError(initErrCode, initRes.status, initRaw);
    return fail(message, retriable);
  }

  const publishId = ((initJson?.data ?? {}) as Record<string, unknown>).publish_id as string | undefined;
  if (!publishId) return fail("TikTok accepted the photo post but returned no publish id.");

  return await pollPublishStatus(token, publishId, fail, "photos");
}

export async function publishToTikTok({
  post,
  account,
  secret,
  mediaUrl,
  options,
  mediaType,
  generationId,
}: {
  post: Record<string, unknown>;
  account: Record<string, unknown>;
  secret: Record<string, unknown> | null;
  mediaUrl: string | null;
  // Collected by TikTokOptionsPanel. Absent means the compose UI did not run,
  // which must never publish — see the guard below.
  options?: Record<string, unknown> | null;
  /** 'image' | 'video' from the generation row. Decides which API is used. */
  mediaType?: string | null;
  /** Needed to mint the public proxy URL a photo post is pulled from. */
  generationId?: string | null;
}): Promise<PublishResult> {
  const fail = (reason: string, retriable = false): PublishResult => ({
    success: false, platformPostId: null, platformPostUrl: null,
    failureReason: reason, retriable,
  });

  // ── Credentials ────────────────────────────────────────────────────────────
  const ciphertext = secret?.access_token_ciphertext as string | undefined;
  if (!ciphertext) {
    return fail("This TikTok account has no stored credential. Reconnect it to publish.");
  }

  let token: string;
  try {
    token = await decryptToken(ciphertext);
  } catch (err) {
    console.error("[tiktok] token decrypt failed:", (err as Error).message);
    return fail("Stored TikTok credentials could not be read. Reconnect the account.");
  }

  // ── Photo posts are a DIFFERENT API, not a variant of this one ─────────────
  //
  // Video: /v2/post/publish/video/init/ with FILE_UPLOAD — we push the bytes.
  // Photo: /v2/post/publish/content/init/ with PULL_FROM_URL — TikTok fetches
  // them, and only from a URL prefix TikTok has verified as ours. Different
  // endpoint, different body, different media contract, so it branches here
  // rather than threading conditionals through the upload path below.
  const isPhoto = ["image", "photo", "carousel"].includes(String(mediaType || "").toLowerCase());
  if (isPhoto) {
    return await publishPhotoToTikTok({ post, token, options, generationId, fail });
  }

  if (!mediaUrl) {
    return fail("TikTok posts need a video. Add one and try again.");
  }

  // ── Post settings ──────────────────────────────────────────────────────────
  //
  // privacy_level has NO default here, deliberately. TikTok's guidelines
  // require the user to choose it, and the compose panel enforces that. If it
  // is missing, the panel was bypassed — publishing with an invented value
  // would both violate the guideline and post at a visibility the user never
  // agreed to.
  const privacyLevel = String(options?.privacyLevel ?? "").trim();
  if (!privacyLevel) {
    return fail(
      "No TikTok privacy level was chosen for this post. Open the post's TikTok options and pick one.",
    );
  }

  const rawTitle = String(post.caption ?? post.title ?? "").trim();
  if (rawTitle.length > TITLE_MAX) {
    // Refuse rather than truncate — silently dropping the end of somebody's
    // caption is content loss, and the composer should have caught it.
    return fail(
      `Caption is ${rawTitle.length} characters; TikTok's limit is ${TITLE_MAX}. Shorten it and try again.`,
    );
  }

  // ── 1. Fetch the media ─────────────────────────────────────────────────────
  //
  // mediaUrl comes from generations.output_url — row data, caller-influenced.
  // A bare fetch would be SSRF: fetch an internal address, then upload the
  // response to a public TikTok post. safeFetch re-validates every redirect
  // hop, which is what defeats the usual first-URL-only bypass.
  let bytes: Uint8Array;
  try {
    const asset = await safeFetch(mediaUrl, {
      timeoutMs: UPLOAD_TIMEOUT_MS,
      maxBytes: MAX_VIDEO_BYTES,
      expectContentType: /^video\/(mp4|quicktime|webm)/i,
      context: "tiktok:video-upload",
    });
    bytes = asset.bytes;
  } catch (err) {
    const message = (err as Error).message || "";
    // The commonest cause is not a broken file: it is an IMAGE sent to a
    // video-only endpoint. Observed live 2026-09-23, where the user saw only
    // "supabase.co returned image/jpeg, which is not what was expected" —
    // true, and unactionable. The composer now refuses this before sending
    // (platformsRefusingMediaType), so reaching here means some other path
    // did not ask; it must still say what is wrong in plain words.
    if (/returned image\//i.test(message)) {
      return fail(
        "TikTok accepts video only, and this post's media is a photo. "
        + "Attach a video, or post the photo to a platform that takes images.",
      );
    }
    return fail(`Could not read the video for upload (${message}).`);
  }

  const videoSize = bytes.byteLength;
  if (videoSize === 0) return fail("The video file is empty.");
  if (videoSize > MAX_VIDEO_BYTES) {
    return fail(`Video is ${Math.round(videoSize / 1e6)}MB; TikTok's limit is 4GB.`);
  }

  const { chunkSize, totalChunks } = planChunks(videoSize);

  // ── 2. Initialise the upload ───────────────────────────────────────────────
  const initBody = {
    post_info: {
      title: rawTitle,
      privacy_level: privacyLevel,
      // The panel reports what the user ALLOWED; TikTok wants what is DISABLED.
      // Defaulting these to true (disabled) matches the guideline that
      // interactions are off unless the user turns them on.
      disable_comment: options?.disableComment !== false,
      disable_duet: options?.disableDuet !== false,
      disable_stitch: options?.disableStitch !== false,
      brand_content_toggle: Boolean(options?.brandContentToggle),
      brand_organic_toggle: Boolean(options?.brandOrganicToggle),
    },
    source_info: {
      source: "FILE_UPLOAD",
      video_size: videoSize,
      chunk_size: chunkSize,
      total_chunk_count: totalChunks,
    },
  };

  let initRes: Response;
  try {
    initRes = await fetchWithTimeout(INIT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify(initBody),
    });
  } catch (err) {
    const msg = (err as Error).message;
    return fail(`Could not reach TikTok (${msg}).`, msg === "tiktok_timeout");
  }

  const initRaw = await initRes.text();
  let initJson: Record<string, unknown> | null = null;
  try { initJson = JSON.parse(initRaw); } catch { /* handled below */ }

  const initErrCode = String(
    (initJson?.error as Record<string, unknown> | undefined)?.code ?? "",
  );
  if (!initRes.ok || (initErrCode && initErrCode !== "ok")) {
    const { message, retriable } = describeError(initErrCode, initRes.status, initRaw);
    return fail(message, retriable);
  }

  const data = (initJson?.data ?? {}) as Record<string, unknown>;
  const publishId = data.publish_id as string | undefined;
  const uploadUrl = data.upload_url as string | undefined;
  if (!publishId || !uploadUrl) {
    return fail("TikTok did not return an upload target. Try again.", true);
  }

  // ── 3. Upload the chunks, sequentially ─────────────────────────────────────
  //
  // Sequential is required, not an optimisation choice. The final chunk carries
  // the remainder, so its end offset is always videoSize - 1 regardless of
  // chunkSize — the same arithmetic that makes total_chunk_count a floor.
  for (let i = 0; i < totalChunks; i += 1) {
    const start = i * chunkSize;
    const end = i === totalChunks - 1 ? videoSize - 1 : start + chunkSize - 1;
    const slice = bytes.subarray(start, end + 1);

    let putRes: Response;
    try {
      putRes = await fetchWithTimeout(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(slice.byteLength),
          "Content-Range": `bytes ${start}-${end}/${videoSize}`,
        },
        body: slice,
      }, UPLOAD_TIMEOUT_MS);
    } catch (err) {
      const msg = (err as Error).message;
      return fail(
        `Upload to TikTok failed on chunk ${i + 1} of ${totalChunks} (${msg}).`,
        msg === "tiktok_timeout",
      );
    }

    if (!putRes.ok) {
      const body = await putRes.text().catch(() => "");
      return fail(
        `TikTok rejected chunk ${i + 1} of ${totalChunks} (HTTP ${putRes.status}): ${body.slice(0, 160)}`,
        putRes.status >= 500,
      );
    }
  }

  // ── 4. Poll until TikTok says it is actually published ─────────────────────
  return await pollPublishStatus(token, publishId, fail, "video");
}

/**
 * Wait for TikTok to say the post is really live.
 *
 * A successful upload (or a successful photo init) is NOT a published post:
 * TikTok processes asynchronously and can still reject the content. Reporting
 * success at upload time would mark posts published that never appeared.
 *
 * Shared by the video and photo paths so they cannot drift — the photo path
 * polls the same endpoint with the same publish_id.
 *
 * @param noun what to call the media in messages a user reads
 */
async function pollPublishStatus(
  token: string,
  publishId: string,
  fail: (reason: string, retriable?: boolean) => PublishResult,
  noun: "video" | "photos",
): Promise<PublishResult> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    await new Promise((r) => setTimeout(r, POLL_DELAY_MS));

    let statusRes: Response;
    try {
      statusRes = await fetchWithTimeout(STATUS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({ publish_id: publishId }),
      });
    } catch {
      continue;  // transient; keep polling within the bounded loop
    }

    if (!statusRes.ok) continue;

    const statusJson = await statusRes.json().catch(() => null);
    const sd = (statusJson?.data ?? {}) as Record<string, unknown>;
    const status = String(sd.status ?? "");

    if (status === "PUBLISH_COMPLETE") {
      return {
        success: true,
        platformPostId: publishId,
        // TikTok returns no post URL from this endpoint — only a publish_id,
        // which is not addressable as a web link. Claiming a URL we cannot
        // build would be worse than admitting there isn't one.
        platformPostUrl: null,
        failureReason: null,
        retriable: false,
        note: "Published to TikTok. TikTok does not return a direct link for API posts.",
      };
    }

    if (status === "FAILED") {
      const reason = String(sd.fail_reason ?? "unknown");
      return fail(`TikTok rejected the ${noun} after processing: ${reason}`, false);
    }
    // PROCESSING_UPLOAD / PROCESSING_DOWNLOAD / anything else -> keep waiting.
  }

  // Bounded, so a stuck job surfaces as ambiguity rather than holding the
  // publish open forever. Deliberately NOT reported as a failure: TikTok
  // accepted it and may still publish, so a retry could duplicate the post.
  return {
    success: false,
    platformPostId: publishId,
    platformPostUrl: null,
    failureReason:
      `TikTok accepted the ${noun} but is still processing after two minutes. `
      + "Check your TikTok profile before retrying — retrying may post it twice.",
    retriable: false,
  };
}
