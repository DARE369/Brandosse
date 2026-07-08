// LibraryStore — Personal Content Library data layer (Zustand).
//
// Packet 2 (Personal Content Library) — Phase 3, feature-frontend-builder.
// Refactored in place (per AS_IS_AUDIT.md §3.5 — Refactor, not Remove) to
// read/write the new public.personal_assets table via
// src/services/assetLibraryService.js, instead of the old three-table
// (posts/media_assets/content_templates) client-side stitch. The previous
// status-changing methods (schedulePost/movePostToDraft/archivePost/etc.)
// are removed here because LIBRARY_SPEC.md's approved mockup has no
// drafts/scheduled/published/failed pipeline UI at all — that's Calendar's
// territory (Packet 1) now. This store's only remaining job is the asset
// library itself: list/filter/search, upload, metadata edit, archive,
// soft-delete/restore, version-supersede — all delegated to
// assetLibraryService.js, never querying Supabase directly here.
//
// Does NOT import or call ensureLibraryRowsForPosts()/contentLibraryService.js
// at all — that function and its six call sites remain completely untouched,
// per Master Brief §0 rule 2 and DECISIONS_LOG.md.
import { create } from 'zustand';
import {
  fetchPersonalAssets,
  fetchPersonalAssetCounts,
  fetchPersonalAssetById,
  fetchAssetUsedInPosts,
  uploadPersonalAsset,
  requestAssetAiTagging,
  updatePersonalAssetMetadata,
  duplicatePersonalAsset,
  archivePersonalAsset,
  unarchivePersonalAsset,
  softDeletePersonalAsset,
  restorePersonalAsset,
  fetchTrashedPersonalAssets,
  markAssetAsNewVersion,
  fetchVersionChain,
} from '../services/assetLibraryService';

const LIBRARY_STALE_MS = 5 * 60 * 1000;

const useLibraryStore = create((set, get) => ({
  assets: [],
  counts: { all: 0, upload: 0, generation: 0, post: 0, unused: 0, archived: 0 },
  loading: false,
  uploading: false,
  error: null,
  lastFetchedAt: null,

  fetchLibraryData: async ({ force = false } = {}) => {
    const { lastFetchedAt, assets } = get();
    if (
      !force
      && lastFetchedAt
      && assets.length > 0
      && Date.now() - lastFetchedAt < LIBRARY_STALE_MS
    ) return;

    try {
      set({ loading: true, error: null });

      const [assetRows, counts] = await Promise.all([
        fetchPersonalAssets({ includeArchived: true }),
        fetchPersonalAssetCounts(),
      ]);

      set({
        assets: assetRows,
        counts,
        loading: false,
        lastFetchedAt: Date.now(),
      });
    } catch (error) {
      console.error('fetchLibraryData failed:', error);
      set({ loading: false, error: error.message || 'Failed to load library' });
    }
  },

  refreshCounts: async () => {
    try {
      const counts = await fetchPersonalAssetCounts();
      set({ counts });
    } catch (error) {
      console.error('refreshCounts failed:', error);
    }
  },

  // Upload one file. Returns the inserted asset row (+ any duplicate_of hit)
  // so the caller (the Upload modal's per-file queue) can react per-file
  // without blocking the rest of a multi-file batch (LIBRARY_SPEC.md §11).
  uploadAsset: async ({ file, title, description, altText, tags, onProgress }) => {
    set({ uploading: true, error: null });
    try {
      const result = await uploadPersonalAsset({ file, title, description, altText, tags, onProgress });
      const asset = result?.asset || null;

      if (asset) {
        set((state) => ({ assets: [asset, ...state.assets] }));
        get().refreshCounts();

        // Fire-and-forget AI tagging — never awaited by the upload flow
        // itself (LIBRARY_SPEC.md §5 step 3). The card shows a shimmer
        // until this resolves and patches the row in place.
        if (asset.ai_tagging_status === 'pending') {
          requestAssetAiTagging(asset.id).then((tagResult) => {
            const updatedAsset = tagResult?.asset;
            if (updatedAsset) {
              set((state) => ({
                assets: state.assets.map((row) => (row.id === updatedAsset.id ? updatedAsset : row)),
              }));
            } else if (tagResult?.ai_tagging_status) {
              set((state) => ({
                assets: state.assets.map((row) => (
                  row.id === asset.id ? { ...row, ai_tagging_status: tagResult.ai_tagging_status } : row
                )),
              }));
            }
          }).catch((err) => {
            console.error('AI tagging request failed:', err);
          });
        }
      }

      return result;
    } finally {
      set({ uploading: false });
    }
  },

  updateAssetMetadata: async (assetId, updates) => {
    const updated = await updatePersonalAssetMetadata(assetId, updates);
    set((state) => ({
      assets: state.assets.map((row) => (row.id === assetId ? updated : row)),
    }));
    return updated;
  },

  archiveAsset: async (assetId) => {
    const updated = await archivePersonalAsset(assetId);
    set((state) => ({
      assets: state.assets.map((row) => (row.id === assetId ? updated : row)),
    }));
    get().refreshCounts();
    return updated;
  },

  duplicateAsset: async (assetId) => {
    const duplicate = await duplicatePersonalAsset(assetId);
    set((state) => ({ assets: [duplicate, ...state.assets] }));
    get().refreshCounts();
    return duplicate;
  },

  unarchiveAsset: async (assetId) => {
    const updated = await unarchivePersonalAsset(assetId);
    set((state) => ({
      assets: state.assets.map((row) => (row.id === assetId ? updated : row)),
    }));
    get().refreshCounts();
    return updated;
  },

  // Soft-delete (LIBRARY_SPEC.md §6 — recoverable trash, not a hard delete).
  // Removed from the active grid/table immediately; recoverable via Trash.
  softDeleteAsset: async (assetId) => {
    const updated = await softDeletePersonalAsset(assetId);
    set((state) => ({
      assets: state.assets.map((row) => (row.id === assetId ? updated : row)),
    }));
    get().refreshCounts();
    return updated;
  },

  restoreAsset: async (assetId) => {
    const updated = await restorePersonalAsset(assetId);
    set((state) => ({
      assets: state.assets.map((row) => (row.id === assetId ? updated : row)),
    }));
    get().refreshCounts();
    return updated;
  },

  fetchTrash: async () => fetchTrashedPersonalAssets(),

  fetchAssetById: async (assetId) => fetchPersonalAssetById(assetId),

  fetchUsedIn: async (assetId) => fetchAssetUsedInPosts(assetId),

  fetchVersionChainFor: async (assetId) => fetchVersionChain(assetId),

  markAsNewVersion: async ({ oldAssetId, newAssetId }) => {
    const updated = await markAssetAsNewVersion({ oldAssetId, newAssetId });
    set((state) => ({
      // The old row gets superseded_by_asset_id set — it's now excluded from
      // the default view by fetchPersonalAssets()'s own filter, so the
      // simplest correct client-side reaction is to drop it from the
      // in-memory active list (it remains independently fetchable by id).
      assets: state.assets.filter((row) => row.id !== oldAssetId),
    }));
    get().refreshCounts();
    return updated;
  },

  clearError: () => set({ error: null }),
}));

export default useLibraryStore;
