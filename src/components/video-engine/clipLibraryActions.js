// src/components/video-engine/clipLibraryActions.js
// Real Save-to-Library / Schedule wiring for rendered video clips — reuses
// the exact same upload pipeline (checksum, perceptual hash, personal-asset-
// upload edge function) manual Library uploads already go through, and the
// same Calendar quick-post handoff Library's own "Schedule" action uses.
// No separate/parallel storage path is invented for clips.
import { uploadPersonalAsset, buildScheduleHandoffPath } from "../../services/assetLibraryService";

export async function saveClipToLibrary(clip) {
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
  });

  const assetId = result?.asset?.id || result?.id;
  if (!assetId) throw new Error("Save succeeded but no asset id was returned.");
  return assetId;
}

export function scheduleHandoffPathForAsset(assetId) {
  return buildScheduleHandoffPath(assetId);
}
