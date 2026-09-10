// supabase/functions/_shared/youtube.service.ts
//
// YouTube publish adapter. Uploads a video via the resumable protocol, then
// waits for YouTube to finish PROCESSING it before reporting success.
//
// ── API surface ──────────────────────────────────────────────────────────────
//   1. POST https://www.googleapis.com/upload/youtube/v3/videos
//        ?uploadType=resumable&part=snippet,status
//      with X-Upload-Content-Length / X-Upload-Content-Type and the metadata
//      as the JSON body    -> 200, and the session URI in the `Location` header
//   2. PUT the bytes to that Location URI  -> 201 with the video resource
//   3. Poll GET /youtube/v3/videos?part=status&id=... until uploadStatus
//      leaves `uploaded`
//
// ── An accepted upload is NOT a published video ──────────────────────────────
// This is the discipline TikTok's adapter established (handoff 2026-09-09 §5.2)
// and it applies here for the same reason. Step 2 returns 201 as soon as the
// bytes are stored; YouTube then transcodes asynchronously and can still set
// uploadStatus to `failed` (codec, conversion, emptyFile, invalidFile, tooSmall,
// uploadAborted) or `rejected` (copyright, duplicate, inappropriate, legal,
// length, termsOfUse, trademark, claim, or the uploader's account being closed
// or suspended). Returning success at 201 would mark posts published that never
// appeared, which is precisely what Law 3 forbids.
//
// ── A poll timeout is deliberately NOT retriable ─────────────────────────────
// The bytes are already on YouTube's side. A retry would upload the whole video
// a second time and produce a duplicate on the user's channel, which no error
// message can undo. Timing out therefore asks the user to check their channel.
//
// ── Before the compliance audit, every upload is private ─────────────────────
// YouTube: "All videos uploaded via the videos.insert endpoint from unverified
// API projects created after 28 July 2020 will be restricted to private viewing
// mode." That lock is applied by YouTube, not by us, and it is not appealable —
// the only remedy is re-uploading after approval, which loses the URL and the
// views. So privacyStatus below is what we ASK for; the response is what we
// report.

import { decryptToken } from "./tokenCrypto.ts";
import { safeFetch } from "./safeFetch.ts";

const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/youtube/v3";

const TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 120_000;

/**
 * Cap on the video we will pull into memory.
 *
 * NOT YouTube's limit — YouTube accepts 256GB. This is the runtime's: the
 * bytes are held in a single Uint8Array inside an edge function, so the real
 * ceiling is the function's memory, and asking for more than it has fails as
 * an opaque OOM kill rather than a message anyone can act on. 200MB is
 * comfortably above the vertical clips this product renders.
 *
 * (tiktok.service.ts declares 4GB for the same in-memory pattern. That number
 * is unreachable for the same reason and is worth revisiting — a video anywhere
 * near it would die in the runtime long before TikTok objected.)
 */
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

// ~2 minutes, matching the TikTok adapter. Long enough for a short clip to
// transcode; short enough that a stuck post does not sit in `publishing`.
const POLL_ATTEMPTS = 20;
const POLL_DELAY_MS = 6_000;

// YouTube's documented ceilings. Enforced here so a long caption is trimmed
// with the user told, rather than rejected by Google with a 400 that names a
// field the user never saw.
const TITLE_MAX = 100;
const DESCRIPTION_MAX_BYTES = 5000;
const TAGS_MAX_CHARS = 500;

// ── Exported for youtube.service.test.ts ────────────────────────────────────
// sanitiseText, truncateBytes, readOptions, fitTags and classifyGoogleError are
// exported ONLY so they can be unit-tested. They are pure and cheap to test,
// and they encode the rules that would otherwise only be exercised by a real
// upload — byte-accurate truncation, the tri-state disclosure fields, and the
// Google error taxonomy that decides whether a failure is retriable. Do not
// import them from anywhere but the test.

/** People & Blogs. Valid in every region, unlike several other category ids. */
const DEFAULT_CATEGORY_ID = "22";

export type PublishResult = {
  success: boolean;
  platformPostId: string | null;
  platformPostUrl: string | null;
  failureReason: string | null;
  retriable: boolean;
  note?: string | null;
};

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
    if ((err as Error)?.name === "AbortError") throw new Error("youtube_timeout");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * YouTube rejects `<` and `>` in title and description outright.
 *
 * Stripped rather than escaped: the caption is plain text destined for a plain
 * text field, so an escaped entity would render literally as `&lt;` on the
 * video page. Losing an angle bracket is the smaller harm.
 */
export function sanitiseText(value: string): string {
  return value.replace(/[<>]/g, "").trim();
}

/** Trim to a BYTE budget without splitting a multi-byte character. */
export function truncateBytes(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).length <= maxBytes) return value;

  let out = value;
  while (encoder.encode(out).length > maxBytes && out.length > 0) {
    // Drop a whole code point, never half a surrogate pair — slicing by
    // UTF-16 unit can otherwise leave a lone surrogate and produce invalid
    // JSON that Google rejects with a parse error naming nothing useful.
    out = Array.from(out).slice(0, -1).join("");
  }
  return out;
}

/**
 * Read the per-post YouTube settings.
 *
 * Unlike TikTok, YouTube's own guidelines do NOT require the user to pick a
 * visibility, so this does not refuse to publish without one. It defaults to
 * `private`, which is both the safe direction (a private video can be made
 * public; an unintended public one cannot be un-seen) and the truthful one
 * before the compliance audit, where YouTube forces private regardless. The
 * default is REPORTED in the result note rather than applied silently.
 */
type YouTubeOptions = {
  privacyStatus: "private" | "public" | "unlisted";
  privacyWasDefaulted: boolean;
  categoryId: string;
  tags: string[];
  madeForKids: boolean | null;
  containsSyntheticMedia: boolean | null;
};

export function readOptions(raw: Record<string, unknown> | null): YouTubeOptions {
  const o = raw ?? {};
  const requested = String(o.privacy_status ?? "").toLowerCase();
  const valid = requested === "public" || requested === "unlisted" || requested === "private";

  // Filter BEFORE stringifying, not after. String(null) is "null" — a truthy
  // five-character string — so a null in this array used to survive
  // .filter(Boolean) and reach YouTube as a literal tag reading "null" on the
  // user's video. Caught by youtube.service.test.ts before any user saw it.
  const tags = Array.isArray(o.tags)
    ? o.tags
        .filter((t) => typeof t === "string" || typeof t === "number")
        .map((t) => String(t).trim())
        .filter(Boolean)
    : [];

  return {
    privacyStatus: valid ? (requested as YouTubeOptions["privacyStatus"]) : "private",
    privacyWasDefaulted: !valid,
    categoryId: String(o.category_id ?? DEFAULT_CATEGORY_ID),
    tags,
    // Tri-state on purpose. `false` is a positive declaration that the video is
    // not for children; absent means the channel's own default applies. They
    // are different statements and must not be collapsed.
    madeForKids: typeof o.made_for_kids === "boolean" ? o.made_for_kids : null,
    containsSyntheticMedia:
      typeof o.contains_synthetic_media === "boolean" ? o.contains_synthetic_media : null,
  };
}

/** Keep tags under YouTube's combined 500-character budget. */
export function fitTags(tags: string[]): string[] {
  const out: string[] = [];
  let used = 0;
  for (const tag of tags) {
    const cost = tag.length + (out.length ? 1 : 0);
    if (used + cost > TAGS_MAX_CHARS) break;
    out.push(tag);
    used += cost;
  }
  return out;
}

export async function publishToYouTube({
  post,
  account: _account,
  secret,
  mediaUrl,
  options,
}: {
  post: Record<string, unknown>;
  account: Record<string, unknown>;
  secret: Record<string, unknown> | null;
  mediaUrl: string | null;
  options: Record<string, unknown> | null;
}): Promise<PublishResult> {
  const fail = (reason: string, retriable = false): PublishResult => ({
    success: false, platformPostId: null, platformPostUrl: null,
    failureReason: reason, retriable,
  });

  // ── Credentials ────────────────────────────────────────────────────────────
  const ciphertext = secret?.access_token_ciphertext as string | undefined;
  if (!ciphertext) {
    return fail("This YouTube account has no stored credential. Reconnect it to publish.");
  }

  let token: string;
  try {
    token = await decryptToken(ciphertext);
  } catch (err) {
    // Never retriable: retrying cannot make a rotated key correct, and a retry
    // loop would burn the account's health score for a cause the user cannot
    // see or fix.
    console.error("[youtube] token decrypt failed:", (err as Error).message);
    return fail("Stored YouTube credentials could not be read. Reconnect the account.");
  }

  if (!mediaUrl) {
    // YouTube has no text-only post. Refusing here is the honest answer; the
    // alternative is a publish that appears to work and produces nothing.
    return fail("YouTube requires a video. This post has no media attached.");
  }

  const opts = readOptions(options);

  // ── Refuse without the made-for-kids declaration ───────────────────────────
  //
  // YouTube accepts an upload with `selfDeclaredMadeForKids` absent, so this is
  // not the API protecting anyone — it is us. The video lands on the channel and
  // YouTube Studio marks it incomplete in red, and the user has to finish it by
  // hand on youtube.com. That happened to the first real upload through this
  // product (video vjuIoPzSVcc, 2026-09-10).
  //
  // Same reasoning as TikTok's privacy_level: a COPPA answer is a legal
  // declaration this product must not invent, and publishing without one
  // produces work for the user rather than a finished post. So it refuses, and
  // YouTubeOptionsPanel blocks scheduling before it ever gets here.
  if (opts.madeForKids === null) {
    return fail(
      "YouTube requires you to declare whether this video is made for kids, and no "
      + "answer was recorded for this post. Open the post, answer the audience "
      + "question, and schedule it again.",
    );
  }

  // ── Metadata ───────────────────────────────────────────────────────────────
  const rawTitle = String(post.title ?? "").trim()
    || String(post.caption ?? "").trim().split("\n")[0]
    || "Untitled";
  const title = sanitiseText(rawTitle).slice(0, TITLE_MAX) || "Untitled";

  const description = truncateBytes(
    sanitiseText(String(post.caption ?? "")),
    DESCRIPTION_MAX_BYTES,
  );

  const status: Record<string, unknown> = { privacyStatus: opts.privacyStatus };
  if (opts.madeForKids !== null) status.selfDeclaredMadeForKids = opts.madeForKids;
  if (opts.containsSyntheticMedia !== null) {
    status.containsSyntheticMedia = opts.containsSyntheticMedia;
  }

  const metadata = {
    snippet: {
      title,
      description,
      tags: fitTags(opts.tags),
      categoryId: opts.categoryId,
    },
    status,
  };

  // ── 1. Fetch the media ─────────────────────────────────────────────────────
  //
  // mediaUrl comes from generations.output_url — row data, and therefore
  // caller-influenced. A bare fetch would be SSRF with the reply delivered to a
  // public YouTube channel. safeFetch revalidates EVERY redirect hop, which is
  // what defeats the usual first-URL-only bypass.
  let bytes: Uint8Array;
  let contentType: string;
  try {
    const asset = await safeFetch(mediaUrl, {
      timeoutMs: UPLOAD_TIMEOUT_MS,
      maxBytes: MAX_VIDEO_BYTES,
      expectContentType: /^video\/(mp4|quicktime|webm|x-matroska)/i,
      context: "youtube:video-upload",
    });
    bytes = asset.bytes;
    contentType = asset.contentType || "video/mp4";
  } catch (err) {
    return fail(`Could not read the video for upload (${(err as Error).message}).`);
  }

  const videoSize = bytes.byteLength;
  if (videoSize === 0) return fail("The video file is empty.");

  // ── 2. Open a resumable session ────────────────────────────────────────────
  let sessionUri: string;
  try {
    const init = await fetchWithTimeout(
      `${UPLOAD_API}/videos?uploadType=resumable&part=snippet,status`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Length": String(videoSize),
          "X-Upload-Content-Type": contentType,
        },
        body: JSON.stringify(metadata),
      },
    );

    if (!init.ok) {
      const body = await init.text().catch(() => "");
      return classifyGoogleError(init.status, body, fail);
    }

    const location = init.headers.get("location");
    if (!location) {
      // A 200 with no Location means the contract changed under us. Treated as
      // retriable because it is more likely a transient edge than a redesign,
      // but logged loudly because if it is a redesign, nothing else will say so.
      console.error("[youtube] resumable init returned 200 with no Location header");
      return fail("YouTube did not return an upload URL. Try again shortly.", true);
    }
    sessionUri = location;
  } catch (err) {
    const message = (err as Error).message;
    if (message === "youtube_timeout") {
      return fail("YouTube did not respond while starting the upload. Try again.", true);
    }
    return fail(`Could not start the YouTube upload (${message}).`, true);
  }

  // ── 3. Send the bytes ──────────────────────────────────────────────────────
  //
  // One PUT for the whole file. The resumable protocol also allows chunking
  // with Content-Range, but that only buys resumability across a crash — and
  // the bytes live in this function's memory, so a crash loses them anyway.
  // Chunking would add failure modes without removing one.
  let videoId: string | null = null;
  let uploadStatus: string | null = null;
  try {
    const put = await fetchWithTimeout(
      sessionUri,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": contentType,
          "Content-Length": String(videoSize),
        },
        // Cast, not a copy. Deno 2 / TS 5.7 made typed arrays generic over
        // their backing buffer, so Uint8Array<ArrayBufferLike> no longer
        // satisfies BodyInit even though every runtime accepts it verbatim.
        // Re-materialising the video as a Blob to satisfy the checker would
        // double peak memory in a function that has ~256MB to work with, which
        // is a real outage in exchange for a type-level nicety. safeFetch reads
        // from a fetch response, so this is never a SharedArrayBuffer.
        body: bytes as unknown as BodyInit,
      },
      UPLOAD_TIMEOUT_MS,
    );

    if (put.status === 404) {
      // The session expired. Restartable, and safe to retry: nothing was
      // published.
      return fail("The YouTube upload session expired before it finished. Try again.", true);
    }
    if (!put.ok) {
      const body = await put.text().catch(() => "");
      return classifyGoogleError(put.status, body, fail);
    }

    const created = await put.json().catch(() => null);
    videoId = created?.id ?? null;
    uploadStatus = created?.status?.uploadStatus ?? null;

    if (!videoId) {
      // Bytes accepted, no id returned. NOT retriable: the video may well
      // exist, and re-uploading would duplicate it on the user's channel.
      console.error("[youtube] upload succeeded but returned no video id");
      return fail(
        "YouTube accepted the video but did not return its id. Check your channel "
        + "before retrying — the video may have been published.",
      );
    }
  } catch (err) {
    const message = (err as Error).message;
    if (message === "youtube_timeout") {
      // Deliberately not retriable. The upload may have completed on YouTube's
      // side after our deadline; retrying risks a duplicate video that no error
      // message can take back.
      return fail(
        "The upload to YouTube timed out. It may still have completed — check your "
        + "channel before trying again, to avoid uploading it twice.",
      );
    }
    return fail(`The upload to YouTube failed (${message}).`);
  }

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // ── 4. Wait for processing ─────────────────────────────────────────────────
  //
  // `uploaded` means received but not yet transcoded. Only `processed` is a
  // video anyone can watch.
  let terminal = uploadStatus;
  let failureReason: string | null = null;
  let rejectionReason: string | null = null;

  for (
    let attempt = 0;
    attempt < POLL_ATTEMPTS && (!terminal || terminal === "uploaded");
    attempt += 1
  ) {
    await new Promise((r) => setTimeout(r, POLL_DELAY_MS));

    try {
      const res = await fetchWithTimeout(
        `${API}/videos?part=status&id=${encodeURIComponent(videoId)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) continue;   // a transient poll failure is not a publish failure

      const body = await res.json().catch(() => null);
      const st = Array.isArray(body?.items) ? body.items[0]?.status : null;
      if (!st) continue;

      terminal = st.uploadStatus ?? terminal;
      failureReason = st.failureReason ?? null;
      rejectionReason = st.rejectionReason ?? null;
    } catch {
      // Keep polling. The upload is done; only our visibility of it is flaky.
      continue;
    }
  }

  if (terminal === "failed") {
    return {
      success: false,
      platformPostId: videoId,
      platformPostUrl: videoUrl,
      failureReason: `YouTube could not process the video (${failureReason ?? "unknown reason"}).`,
      // The file itself is the problem. Re-uploading the same bytes fails the
      // same way, so a retry only wastes quota and delays the real answer.
      retriable: false,
    };
  }

  if (terminal === "rejected") {
    return {
      success: false,
      platformPostId: videoId,
      platformPostUrl: videoUrl,
      failureReason: `YouTube rejected the video (${rejectionReason ?? "unknown reason"}).`,
      retriable: false,
    };
  }

  if (terminal !== "processed") {
    // Still transcoding past our ceiling. This is a genuinely unknown outcome
    // and is reported as one — not as a success, and not as a failure that
    // invites a duplicate upload.
    return {
      success: false,
      platformPostId: videoId,
      platformPostUrl: videoUrl,
      failureReason:
        "The video uploaded, but YouTube was still processing it after two minutes. "
        + "It will most likely appear shortly — check your channel. Do not re-upload.",
      retriable: false,
    };
  }

  // ── Success ────────────────────────────────────────────────────────────────
  const notes: string[] = [];
  if (opts.privacyWasDefaulted) {
    notes.push(
      "Published as PRIVATE because no visibility was chosen for this post. "
      + "Change it on YouTube, or set one before publishing next time.",
    );
  }
  if (opts.containsSyntheticMedia === null) {
    // Not silently decided either way. YouTube requires creators to disclose
    // realistic altered or synthetic content, and this product generates
    // content — so an undeclared upload is a compliance gap the user should
    // know exists, not one we quietly answer on their behalf.
    notes.push(
      "No altered-or-synthetic-content disclosure was set. If this video contains "
      + "realistic AI-generated or altered footage, YouTube requires you to disclose it.",
    );
  }

  return {
    success: true,
    platformPostId: videoId,
    platformPostUrl: videoUrl,
    failureReason: null,
    retriable: false,
    note: notes.length ? notes.join(" ") : null,
  };
}

/**
 * Turn a Google API error into something the user can act on.
 *
 * Google returns the same 403 for "you did not grant this scope", "the channel
 * is suspended" and "you are out of quota", distinguished only by a `reason`
 * buried in the JSON. Collapsing them into "YouTube rejected the upload" sends
 * every one of those users to the wrong place.
 */
export function classifyGoogleError(
  httpStatus: number,
  rawBody: string,
  fail: (reason: string, retriable?: boolean) => PublishResult,
): PublishResult {
  let reason = "";
  let message = "";
  try {
    const parsed = JSON.parse(rawBody);
    reason = parsed?.error?.errors?.[0]?.reason ?? parsed?.error?.status ?? "";
    message = parsed?.error?.message ?? "";
  } catch {
    // Non-JSON error body; the HTTP status is all we have.
  }

  // Logged with the reason but WITHOUT the body: Google echoes request context
  // into some error shapes, and this string is persisted to the post's error
  // field where it would then sit in the database.
  console.error(`[youtube] upload rejected: http_${httpStatus} reason=${reason || "none"}`);

  if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
    // Quota is per CLOUD PROJECT, shared by every user of this app — so this is
    // not something the affected user did, and not something they can fix.
    return fail(
      "YouTube's daily upload quota for this app is used up. This is an app-wide "
      + "limit, not a limit on your channel. Try again tomorrow.",
      true,
    );
  }
  if (reason === "insufficientPermissions" || httpStatus === 401) {
    return fail("YouTube did not accept the sign-in for this channel. Reconnect the account.");
  }
  if (reason === "youtubeSignupRequired") {
    return fail("This Google account has no YouTube channel. Create one, then reconnect.");
  }
  if (reason === "forbidden" || reason === "accountSuspended") {
    return fail("YouTube refused the upload for this channel. Check the channel's standing on YouTube.");
  }
  if (reason === "uploadLimitExceeded") {
    return fail("This channel has reached its own YouTube upload limit for now. Try again later.", true);
  }
  if (reason === "invalidCategoryId") {
    return fail("The video category is not valid in this channel's region. Pick another category.");
  }
  if (httpStatus >= 500) {
    return fail("YouTube is having trouble right now. This will be retried.", true);
  }

  return fail(
    `YouTube rejected the upload (${reason || `http_${httpStatus}`}${message ? `: ${message.slice(0, 120)}` : ""}).`,
  );
}
