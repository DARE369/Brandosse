// ============================================================================
// ASSET LIBRARY SERVICE — query + mutation layer for the Personal Content
// Library, built against the new public.personal_assets table
// (LIBRARY_SPEC.md §2.1, named per spec §10's explicit instruction that this
// file is "the service file" enforcing the no-query-omits-scope-filter rule).
//
// Packet 2 (Personal Content Library) — Phase 3, feature-data-layer-builder.
// Built strictly against the approved mockup
// (docs/calendar-library-rebuild/packet-2-personal-library/mockups/mockup-gallery.html)
// and docs/LIBRARY_SPEC.md. See DECISIONS_LOG.md (2026-06-25, Phase 3
// section) for the architectural reasoning behind personal_assets holding a
// real row per source instead of a read-time UNION.
//
// IMPORTANT — this file does NOT touch contentLibraryService.js or
// ensureLibraryRowsForPosts() in any way. That function and its six call
// sites (4 in src/stores/SessionStore.js, 2 in
// src/admin/pages/AdminModeration/moderationApi.js) remain completely
// untouched, per Master Brief §0 rule 2/the packet's explicit instruction.
// This service reads/writes ONLY public.personal_assets.
//
// Every exported query function filters by the signed-in user's own
// user_id (RLS-enforced server-side too, but every query here is also
// explicit client-side, per LIBRARY_SPEC.md §10: "no query in
// assetLibraryService.js omits the scope filter").
// ============================================================================

import { supabase } from './supabaseClient';
import { getSupabaseFunctionUrl, supabaseAnonKey } from './supabaseConfig';

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function isMissingRelationError(error) {
  if (!error) return false;
  const message = `${error.code || ''} ${error.message || ''}`.toLowerCase();
  return (
    message.includes('does not exist')
    || message.includes('relation')
    || message.includes('pgrst')
    || error.code === '42P01'
  );
}

async function requireUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) {
    throw new Error('You must be signed in to use the Library.');
  }
  return data.user.id;
}

// ── Client-side duplicate-detection hashing (RESEARCH.md §2.4) ─────────────
// Two-tier, zero-new-dependency: SHA-256 exact hash via SubtleCrypto for
// every file type, plus a Canvas-native average-hash for images only. Both
// travel with the upload request and are compared server-side in the
// personal-asset-upload edge function (it has access to every other user's-
// own-asset row to compare against; the browser does not need to, and
// should not, fetch and compare against every existing asset itself).

export async function computeFileChecksum(file) {
  if (!file || typeof file.arrayBuffer !== 'function') return null;
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  try {
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  } catch (_error) {
    return null;
  }
}

// Canvas-native average-hash (aHash). Draws the image to a small offscreen
// canvas, thresholds each pixel's luminance against the average, packs the
// result into a hex bit-string. Only meaningful for image files — video/
// document files get exact-hash-only duplicate detection in v1, per
// RESEARCH.md §2.4.
export async function computePerceptualHash(file) {
  if (!file || !String(file.type || '').startsWith('image/')) return null;
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;

  const HASH_SIZE = 8; // 8x8 = 64-bit hash, packed into 16 hex chars.

  try {
    const objectUrl = URL.createObjectURL(file);
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = objectUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = HASH_SIZE;
    canvas.height = HASH_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      URL.revokeObjectURL(objectUrl);
      return null;
    }
    ctx.drawImage(image, 0, 0, HASH_SIZE, HASH_SIZE);
    const { data } = ctx.getImageData(0, 0, HASH_SIZE, HASH_SIZE);
    URL.revokeObjectURL(objectUrl);

    const luminances = [];
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      luminances.push((r * 0.299 + g * 0.587 + b * 0.114));
    }
    const average = luminances.reduce((sum, value) => sum + value, 0) / luminances.length;

    let bits = '';
    for (const luminance of luminances) {
      bits += luminance >= average ? '1' : '0';
    }

    // Pack the 64-bit string into 16 hex characters.
    let hex = '';
    for (let i = 0; i < bits.length; i += 4) {
      hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    }
    return hex;
  } catch (_error) {
    return null;
  }
}

// ── List / filter / search (LIBRARY_SPEC.md §4) ─────────────────────────────

const DEFAULT_SELECT = '*';

/**
 * fetchPersonalAssets — the single unified query backing the Library grid
 * and table views (LIBRARY_SPEC.md §1: one collection, distinguished by
 * `source`, not separate tabs/queries per source).
 *
 * Every filter is applied server-side; `status='active'` is always
 * enforced unless includeArchived/includeTrashed explicitly widen it, and
 * superseded rows (personal_assets.id referenced by some other row's
 * superseded_by_asset_id) are excluded from the default view per spec §6.2
 * ("old row is hidden from default views").
 */
export async function fetchPersonalAssets({
  source = null, // 'upload' | 'generation' | 'post' | null (= all)
  search = '',
  mediaType = null, // 'image' | 'video' | 'document'
  tag = null,
  unusedOnly = false,
  includeArchived = false,
  includeTrashed = false,
} = {}) {
  const userId = await requireUserId();

  let query = supabase
    .from('personal_assets')
    .select(DEFAULT_SELECT)
    .eq('user_id', userId)
    .is('superseded_by_asset_id', null)
    .order('created_at', { ascending: false });

  if (!includeTrashed) {
    query = query.neq('status', 'trashed');
  }
  if (!includeArchived) {
    query = query.neq('status', 'archived');
  }

  if (source) {
    query = query.eq('source', source);
  }
  if (mediaType) {
    query = query.eq('media_type', mediaType);
  }
  if (tag) {
    query = query.contains('tags', [tag]);
  }
  if (unusedOnly) {
    query = query.eq('used_in_post_ids', '{}');
  }
  if (search && search.trim()) {
    const term = search.trim().replace(/[%,]/g, '');
    query = query.or(
      `title.ilike.%${term}%,description.ilike.%${term}%,alt_text.ilike.%${term}%`,
    );
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
  return safeArray(data);
}

export async function fetchPersonalAssetCounts() {
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from('personal_assets')
    .select('source, status, used_in_post_ids')
    .eq('user_id', userId)
    .is('superseded_by_asset_id', null);

  if (error) {
    if (isMissingRelationError(error)) {
      return { all: 0, upload: 0, generation: 0, post: 0, unused: 0, archived: 0 };
    }
    throw error;
  }

  const rows = safeArray(data);
  const active = rows.filter((row) => row.status === 'active');

  return {
    all: active.length,
    upload: active.filter((row) => row.source === 'upload').length,
    generation: active.filter((row) => row.source === 'generation').length,
    post: active.filter((row) => row.source === 'post').length,
    unused: active.filter((row) => safeArray(row.used_in_post_ids).length === 0).length,
    archived: rows.filter((row) => row.status === 'archived').length,
  };
}

export async function fetchPersonalAssetById(assetId) {
  if (!assetId) throw new Error('An asset id is required.');
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from('personal_assets')
    .select(DEFAULT_SELECT)
    .eq('id', assetId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

// Used by the Calendar Schedule hand-off (LIBRARY_SPEC.md §7) — fetches the
// one asset Library is handing off, scoped to the signed-in user exactly
// like every other read here. Thin, named wrapper so the calendar side has
// one obvious entry point rather than reaching for the generic getter.
export async function fetchAssetForHandoff(assetId) {
  return fetchPersonalAssetById(assetId);
}

// "Used in" list (spec §6) — every post this asset is attached to, with
// enough shape to deep-link into Calendar's post detail drawer.
export async function fetchAssetUsedInPosts(assetId) {
  if (!assetId) return [];
  const userId = await requireUserId();

  const asset = await fetchPersonalAssetById(assetId);
  if (!asset) return [];

  const postIds = safeArray(asset.used_in_post_ids);
  if (postIds.length === 0) return [];

  const { data, error } = await supabase
    .from('posts')
    .select('id, title, caption, status, scheduled_at, platform')
    .eq('user_id', userId)
    .in('id', postIds);

  if (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
  return safeArray(data);
}

// ── Upload (LIBRARY_SPEC.md §5) ─────────────────────────────────────────────

/**
 * uploadPersonalAsset — routes through the personal-asset-upload edge
 * function (server-side MIME/size validation + trusted row insert), per
 * RESEARCH.md §1.3's explicit recommendation and DECISIONS_LOG.md. Never
 * writes the personal_assets row directly from the client.
 *
 * `onProgress(pct)` fires from a real XMLHttpRequest upload.onprogress
 * event (BrandKitStore.uploadWithProgress()'s technique, pointed at the
 * edge function's URL instead of the storage REST URL directly — RESEARCH.md
 * §1.2/§1.3).
 */
export async function uploadPersonalAsset({
  file,
  title = '',
  description = '',
  altText = '',
  tags = [],
  onProgress,
} = {}) {
  if (!file) throw new Error('Choose a file first.');

  const [checksum, perceptualHash] = await Promise.all([
    computeFileChecksum(file),
    computePerceptualHash(file),
  ]);

  const formData = new FormData();
  formData.append('file', file);
  formData.append('title', title || file.name || '');
  formData.append('description', description || '');
  formData.append('alt_text', altText || '');
  formData.append('tags', JSON.stringify(safeArray(tags).filter(Boolean)));
  if (checksum) formData.append('checksum', checksum);
  if (perceptualHash) formData.append('perceptual_hash', perceptualHash);

  const {
    data: { session },
  } = await supabase.auth.getSession();

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', getSupabaseFunctionUrl('personal-asset-upload'), true);
    xhr.setRequestHeader('apikey', supabaseAnonKey);
    if (session?.access_token) {
      xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
    }

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const pct = Math.round((event.loaded / event.total) * 100);
      if (typeof onProgress === 'function') onProgress(pct);
    };

    xhr.onerror = () => reject(new Error('Network error during upload.'));
    xhr.onload = () => {
      let payload = null;
      try {
        payload = JSON.parse(xhr.responseText || '{}');
      } catch (_err) {
        payload = null;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload || {});
        return;
      }

      const message = payload?.error || `Upload failed with status ${xhr.status}.`;
      reject(new Error(message));
    };

    xhr.send(formData);
  });
}

// Fire-and-forget trigger for the async AI-tagging edge function
// (LIBRARY_SPEC.md §5 step 3 / §8). Deliberately never awaited by the
// upload flow itself — the mockup's shimmer state is what covers the gap
// while this resolves in the background. Caller may still await this
// directly (e.g. to know when the shimmer should clear), but the upload
// itself must already be marked complete before this is invoked.
export async function requestAssetAiTagging(assetId) {
  if (!assetId) return null;
  const { data, error } = await supabase.functions.invoke('personal-asset-ai-tag', {
    body: { asset_id: assetId },
  });
  if (error) {
    console.error('[assetLibraryService] AI tagging request failed:', error);
    return null;
  }
  return data || null;
}

// ── Metadata edit / archive / soft-delete / restore (LIBRARY_SPEC.md §6) ───

export async function updatePersonalAssetMetadata(assetId, updates = {}) {
  if (!assetId) throw new Error('An asset id is required.');
  const userId = await requireUserId();

  const allowedFields = ['title', 'description', 'alt_text', 'tags'];
  const payload = {};
  for (const field of allowedFields) {
    if (field in updates) payload[field] = updates[field];
  }
  if ('title' in payload) payload.title = String(payload.title || '').trim() || null;
  if ('description' in payload) payload.description = String(payload.description || '').trim() || null;
  if ('alt_text' in payload) payload.alt_text = String(payload.alt_text || '').trim() || null;
  if ('tags' in payload) payload.tags = safeArray(payload.tags).map((tag) => String(tag || '').trim()).filter(Boolean);

  const { data, error } = await supabase
    .from('personal_assets')
    .update(payload)
    .eq('id', assetId)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function archivePersonalAsset(assetId) {
  if (!assetId) throw new Error('An asset id is required.');
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from('personal_assets')
    .update({ status: 'archived' })
    .eq('id', assetId)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function unarchivePersonalAsset(assetId) {
  if (!assetId) throw new Error('An asset id is required.');
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from('personal_assets')
    .update({ status: 'active' })
    .eq('id', assetId)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

// Soft-delete (LIBRARY_SPEC.md §6 — "recoverable trash state... a defined
// recovery window," matching the approved mockup's 30-day messaging).
export async function softDeletePersonalAsset(assetId) {
  if (!assetId) throw new Error('An asset id is required.');
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from('personal_assets')
    .update({ status: 'trashed', deleted_at: new Date().toISOString() })
    .eq('id', assetId)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function restorePersonalAsset(assetId) {
  if (!assetId) throw new Error('An asset id is required.');
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from('personal_assets')
    .update({ status: 'active', deleted_at: null })
    .eq('id', assetId)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function fetchTrashedPersonalAssets() {
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from('personal_assets')
    .select(DEFAULT_SELECT)
    .eq('user_id', userId)
    .eq('status', 'trashed')
    .order('deleted_at', { ascending: false });

  if (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }
  return safeArray(data);
}

// ── Duplicate-check / version-supersede (LIBRARY_SPEC.md §5/§6.2) ──────────

/**
 * markAssetAsNewVersion — the user confirms "this is a new version of X"
 * after the upload flow's duplicate warning (spec §5/§6.2). Links the new
 * row to the old one via superseded_by_asset_id on the OLD row (the spec's
 * explicit direction — the old row points forward to what replaced it),
 * and the old row is excluded from default views by
 * fetchPersonalAssets()'s `is('superseded_by_asset_id', null)` filter,
 * while remaining independently fetchable (fetchPersonalAssetById) for any
 * post's "used in" history that still references it.
 */
export async function markAssetAsNewVersion({ oldAssetId, newAssetId }) {
  if (!oldAssetId || !newAssetId) {
    throw new Error('Both the old and new asset ids are required.');
  }
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from('personal_assets')
    .update({ superseded_by_asset_id: newAssetId })
    .eq('id', oldAssetId)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function fetchVersionChain(assetId) {
  if (!assetId) return [];
  const userId = await requireUserId();

  // Walk forward (this row -> whatever superseded it -> ...) and backward
  // (whatever this row superseded -> ...) to assemble the full chain,
  // newest first, matching the approved mockup's version-history ordering.
  const chain = [];
  let currentId = assetId;
  const seen = new Set();

  // Walk to find the newest (current) row first.
  let newestId = assetId;
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const { data, error } = await supabase
      .from('personal_assets')
      .select('id, superseded_by_asset_id')
      .eq('id', currentId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data?.superseded_by_asset_id) break;
    newestId = data.superseded_by_asset_id;
    currentId = data.superseded_by_asset_id;
  }

  // Walk backward from the newest row, collecting every superseded ancestor.
  seen.clear();
  currentId = newestId;
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const { data: row, error } = await supabase
      .from('personal_assets')
      .select(DEFAULT_SELECT)
      .eq('id', currentId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !row) break;
    chain.push(row);

    const { data: predecessor } = await supabase
      .from('personal_assets')
      .select('id')
      .eq('superseded_by_asset_id', currentId)
      .eq('user_id', userId)
      .maybeSingle();
    currentId = predecessor?.id || null;
  }

  return chain;
}

// ── Calendar cross-link helper (LIBRARY_SPEC.md §7) ─────────────────────────

// Builds the path Library's "Schedule" action navigates to — opens
// PersonalCalendarPage with Quick Post pre-selected to this asset. The
// frontend builder's Library page should use this rather than constructing
// the query string inline, so the contract (param names) lives in one
// place. See PersonalCalendarPage.jsx's matching reader + DECISIONS_LOG.md
// 2026-06-25T10:35:00.
export function buildScheduleHandoffPath(assetId) {
  if (!assetId) return '/app/calendar?quickPost=1';
  return `/app/calendar?quickPost=1&prefillAssetId=${encodeURIComponent(assetId)}`;
}

// Shapes a personal_assets row into the { id, name, thumbnail_url,
// generation_id, media_type } object src/calendar/components/
// QuickPostComposer.jsx's libraryAssets/selectedAsset prop already expects
// (confirmed directly against that file's own prop-shape comment).
export function toQuickPostAssetShape(asset) {
  if (!asset) return null;
  return {
    id: asset.id,
    name: asset.title || 'Untitled asset',
    thumbnail_url: asset.thumbnail_url || asset.file_url || null,
    generation_id: asset.generation_id || null,
    media_type: asset.media_type || null,
  };
}
