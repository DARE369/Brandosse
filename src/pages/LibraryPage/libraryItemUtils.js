// Pure display-formatting helpers shared between LibraryPageV2's grid card,
// table row, and asset detail drawer, so all three stay in sync without
// re-deriving logic — same rationale as the original file's header comment
// (AS_IS_AUDIT.md §3.4 — Refactor: shape kept, implementation re-pointed at
// the new personal_assets row shape, which has real title/description
// fields instead of needing them derived from a post's caption).

const SOURCE_LABELS = {
  upload: 'Upload',
  generation: 'Generation',
  post: 'Post-linked',
};

export function getSourceLabel(asset) {
  return SOURCE_LABELS[asset?.source] || 'Asset';
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
// meta-row copy exactly (mockup-gallery.html cards: "2d ago", "just now",
// "5d ago"). No existing shared helper does this app-wide (checked
// src/calendar/** and src/org/**), so this is a small, local, single-purpose
// addition rather than introducing a new dependency.
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

// "JPG · 4.1 MB" / "MP4 · 0:18" — the asset-card meta-row's left segment,
// matching the mockup's exact composition (file format + size, or format +
// duration for video).
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
// falls back to a relative-time label (matches every card in the mockup).
export function getMetaRightLabel(asset) {
  const usedCount = getUsedInCount(asset);
  if (usedCount > 0) return `used ×${usedCount}`;
  return formatRelativeTime(asset?.created_at);
}
