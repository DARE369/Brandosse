// Pure display-formatting helpers shared between LibraryPage's grid card,
// table row, and asset detail drawer, so all three stay in sync without
// re-deriving logic. Moved verbatim from
// src/pages/LibraryPage/libraryItemUtils.js as part of the ui-v2 migration
// (Master Brief §3 — presentation-layer rebuild only; this file is a pure
// presentational helper, not a data-layer file, and its logic/prop shapes
// are unchanged, only its location moved alongside the new component tree).

const SOURCE_LABELS = {
  upload: 'Upload',
  generation: 'Generation',
  post: 'Post-linked',
};

// A clip is stored as source='upload' because it goes through the same upload
// pipeline on purpose — same checksum, same perceptual hash, same validation.
// Its provenance lives in metadata.origin instead, written by
// personal-asset-upload after whitelisting. Deriving the label from there keeps
// the distinction without a schema change, and without a second write path that
// could disagree with the first.
//
// Assets saved before this shipped have no origin, so they keep reading as
// 'Upload'. That is accurate rather than convenient: nothing links a stored
// asset back to the clip it was cut from, so a backfill would be guesswork.
export function getAssetOrigin(asset) {
  const origin = asset?.metadata?.origin;
  if (!origin || typeof origin !== 'object') return null;
  return origin.kind ? origin : null;
}

export function isClip(asset) {
  return getAssetOrigin(asset)?.kind === 'video_clip';
}

export function getSourceLabel(asset) {
  if (isClip(asset)) return 'Clip';
  return SOURCE_LABELS[asset?.source] || 'Asset';
}

function formatTimecode(secs) {
  if (typeof secs !== 'number' || !Number.isFinite(secs) || secs < 0) return null;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * "Clipped from “Founder AMA” · 12:04–12:45", when we know that much.
 * Degrades a piece at a time rather than all at once: without the source title
 * it still reports the timecode, and without either it says nothing at all
 * instead of inventing a placeholder.
 */
export function getProvenanceLabel(asset) {
  const origin = getAssetOrigin(asset);
  if (!origin || origin.kind !== 'video_clip') return null;

  const from = String(origin.source_title || '').trim();
  const start = formatTimecode(origin.start_time_secs);
  const end = formatTimecode(origin.end_time_secs);
  const span = start && end ? `${start}–${end}` : start;

  if (from && span) return `Clipped from “${from}” · ${span}`;
  if (from) return `Clipped from “${from}”`;
  if (span) return `Clipped at ${span}`;
  return 'Clipped from a video';
}

export function getItemTitle(asset) {
  const title = String(asset?.title || '').trim();
  if (title) return title;
  return asset?.media_type === 'video' ? 'Untitled video' : 'Untitled asset';
}

export function getItemDescription(asset) {
  const description = String(asset?.description || '').trim();
  if (description) return description;
  if (asset?.ai_tagging_status === 'pending') return 'AI is tagging this asset…';
  return SOURCE_LABELS[asset?.source]
    ? `${SOURCE_LABELS[asset.source]} asset ready to use.`
    : 'Asset ready to use.';
}

export function getUsedInCount(asset) {
  return Array.isArray(asset?.used_in_post_ids) ? asset.used_in_post_ids.length : 0;
}

export function isUnused(asset) {
  return getUsedInCount(asset) === 0;
}

export function formatDate(value) {
  if (!value) return 'No date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid date';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Compact "2d ago" / "just now" relative-time label, matching the mockup's
// meta-row copy exactly ("2d ago", "just now", "5d ago").
export function formatRelativeTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60) return 'just now';

  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;

  const diffDay = Math.round(diffHour / 24);
  if (diffDay < 30) return `${diffDay}d ago`;

  const diffMonth = Math.round(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth}mo ago`;

  const diffYear = Math.round(diffMonth / 12);
  return `${diffYear}y ago`;
}

export function formatFileSize(bytes) {
  const value = Number(bytes || 0);
  if (!value) return '';
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(seconds) {
  const value = Number(seconds || 0);
  if (!value) return '';
  const mins = Math.floor(value / 60);
  const secs = Math.round(value % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function getFormatLabel(asset) {
  if (asset?.format) return String(asset.format).toUpperCase();
  if (asset?.mime_type) {
    const subtype = asset.mime_type.split('/')[1];
    if (subtype) return subtype.toUpperCase();
  }
  return asset?.media_type ? asset.media_type.toUpperCase() : 'FILE';
}

// "JPG · 4.1 MB" / "MP4 · 0:18" — the asset-card meta-row's left segment.
export function getMetaLeftLabel(asset) {
  const format = getFormatLabel(asset);
  if (asset?.media_type === 'video' && asset?.duration_seconds) {
    return `${format} · ${formatDuration(asset.duration_seconds)}`;
  }
  const size = formatFileSize(asset?.file_size_bytes);
  return size ? `${format} · ${size}` : format;
}

// "used ×3" / "2d ago" — the asset-card meta-row's right segment: usage
// count takes priority once an asset has been used at least once, otherwise
// falls back to a relative-time label.
export function getMetaRightLabel(asset) {
  const usedCount = getUsedInCount(asset);
  if (usedCount > 0) return `used ×${usedCount}`;
  return formatRelativeTime(asset?.created_at);
}
