// src/components/video-engine/clipLibraryActions.js
// Real Save-to-Library / Schedule wiring for rendered video clips — reuses
// the exact same upload pipeline (checksum, perceptual hash, personal-asset-
// upload edge function) manual Library uploads already go through, and the
// same Calendar quick-post handoff Library's own "Schedule" action uses.
// No separate/parallel storage path is invented for clips.
import { uploadPersonalAsset, buildScheduleHandoffPath } from "../../services/assetLibraryService";

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
export async function saveClipToLibrary(clip, source = {}) {
  if (!clip?.public_url) throw new Error("This clip has no downloadable file yet.");

  const response = await fetch(clip.public_url);
  if (!response.ok) throw new Error("Could not read the clip file to save it.");
  const blob = await response.blob();
  const filename = `${(clip.ai_title || `clip-${(clip.clip_index ?? 0) + 1}`).slice(0, 60).replace(/[^\w\- ]+/g, "").trim() || "clip"}.mp4`;
  const file = new File([blob], filename, { type: blob.type || "video/mp4" });

  const result = await uploadPersonalAsset({
    file,
    title: clip.ai_title || filename,
    description: clip.ai_caption || "",
    tags: clip.platform_target ? [clip.platform_target] : [],
    origin: {
      kind: "video_clip",
      clip_id: clip.id ?? null,
      job_id: source.jobId ?? clip.job_id ?? null,
      clip_index: clip.clip_index ?? null,
      start_time_secs: clip.start_time_secs ?? null,
      end_time_secs: clip.end_time_secs ?? null,
      source_title: source.title ?? null,
    },
  });

  const assetId = result?.asset?.id || result?.id;
  if (!assetId) throw new Error("Save succeeded but no asset id was returned.");
  return assetId;
}

export function scheduleHandoffPathForAsset(assetId, generationId = null) {
  return buildScheduleHandoffPath(assetId, generationId);
}
