// src/components/video-engine/clipLibraryActions.js
// Real Save-to-Library / Schedule wiring for rendered video clips — reuses
// the exact same upload pipeline (checksum, perceptual hash, personal-asset-
// upload edge function) manual Library uploads already go through, and the
// same Calendar quick-post handoff Library's own "Schedule" action uses.
// No separate/parallel storage path is invented for clips.
import { uploadPersonalAsset, buildScheduleHandoffPath, requestAssetAiTagging } from "../../services/assetLibraryService";

/**
 * @param {object} clip   a video_clips row
 * @param {object} [source]  the job it was cut from: { jobId, title }
 *
 * The clip goes through the SAME upload pipeline as a manual upload, on purpose
 * — same checksum, same perceptual hash, same validation. The cost used to be
 * that it then looked exactly like a phone photo in the Library. `origin`
 * carries the provenance so the Library can say what it actually is, and which
 * seconds of which video it came from.
 */
export async function saveClipToLibrary(clip, source = {}, { onProgress } = {}) {
  const filename = `${(clip?.ai_title || `clip-${(clip?.clip_index ?? 0) + 1}`).slice(0, 60).replace(/[^\w\- ]+/g, "").trim() || "clip"}.mp4`;

  const common = {
    title: clip?.ai_title || filename,
    description: clip?.ai_caption || "",
    tags: clip?.platform_target ? [clip.platform_target] : [],
    origin: {
      kind: "video_clip",
      clip_id: clip?.id ?? null,
      job_id: source.jobId ?? clip?.job_id ?? null,
      clip_index: clip?.clip_index ?? null,
      start_time_secs: clip?.start_time_secs ?? null,
      end_time_secs: clip?.end_time_secs ?? null,
      source_title: source.title ?? null,
    },
    onProgress,
  };

  // ── Preferred: let the server copy its own file ──────────────────────────
  // The clip is in this project's `video-clips` bucket. Sending `clip_id`
  // moves it to the Library bucket server-side, so nothing large crosses the
  // user's connection. The old path downloaded 8.7MB and uploaded it straight
  // back — about a minute of dead spinner on 4G, and on a worse connection it
  // never finished at all.
  let result = null;
  if (clip?.id) {
    try {
      result = await uploadPersonalAsset({ clipId: clip.id, ...common });
    } catch (clipModeError) {
      // The deployed function may predate clip mode, in which case it reports
      // the missing file rather than the id it does not know to read. Anything
      // else is a real failure and must not be masked by a silent retry that
      // then uploads 8.7MB and fails again for the same reason.
      const message = String(clipModeError?.message || "");
      if (!/missing file upload/i.test(message)) throw clipModeError;
      console.warn(
        "[clipLibraryActions] personal-asset-upload has no clip mode yet; "
        + "falling back to uploading the bytes from the browser. Deploy "
        + "supabase/functions/personal-asset-upload to remove the round trip.",
      );
    }
  }

  // ── Fallback: ship the bytes, as before ──────────────────────────────────
  if (!result) {
    if (!clip?.public_url) throw new Error("This clip has no downloadable file yet.");
    const response = await fetch(clip.public_url);
    if (!response.ok) throw new Error("Could not read the clip file to save it.");
    const blob = await response.blob();
    const file = new File([blob], filename, { type: blob.type || "video/mp4" });
    result = await uploadPersonalAsset({ file, ...common });
  }

  const assetId = result?.asset?.id || result?.id;
  if (!assetId) throw new Error("Save succeeded but no asset id was returned.");

  // personal-asset-upload creates this row with ai_tagging_status: 'pending'
  // for every non-document asset, video included — but nothing flips it off
  // 'pending' except THIS call (LibraryStore.js's uploadAsset() fires it for
  // the ordinary Upload modal; this path had no equivalent). For a clip that
  // means 'pending' forever: publishability.js's TAGGING gate never lifts,
  // and createQuickPost() (calendarService.js) now refuses to ever SEND it —
  // not slow tagging, no tagging at all. The edge function itself resolves a
  // video immediately with no vision cost (personal-asset-ai-tag/index.ts:
  // media_type !== 'image' → 'not_applicable', no Claude call), so this is
  // cheap; fire-and-forget, same as the direct-upload path, so it cannot
  // delay or fail the save itself.
  requestAssetAiTagging(assetId).catch((err) => {
    console.error('[clipLibraryActions] AI tagging request failed:', err);
  });

  return assetId;
}

export function scheduleHandoffPathForAsset(assetId, generationId = null) {
  return buildScheduleHandoffPath(assetId, generationId);
}
