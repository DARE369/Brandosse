// src/stores/BrandKitStore.js
//
// Multi-kit refactor (docs/brand-kit-rebuild/AS_IS_AUDIT.md +
// DECISIONS_LOG.md). An account can now hold multiple brand kits; exactly
// one is ever `is_active` (enforced by a partial unique index on
// public.brand_kit — see supabase/migrations/20260708140000_brand_kit_multi_kit.sql).
// Studio's generation pipeline (src/services/brandKitLoader.js) always
// reads the active kit, independent of whichever kit the user happens to
// be *viewing* here (`currentKitId`).
//
// Backward-compat note: `loadBrandKit` and `brandKit` are kept as aliases
// for `loadKits`/the active kit so existing consumers that only care about
// kit-completeness status (UserSidebar's nav badge, BrandKitOnboardingModal)
// keep working unchanged.

import { create } from 'zustand';
import { supabase } from '../services/supabaseClient';
import { BRAND_KIT_STATUS, ASSET_STATUS } from '../constants/statusEnums';
import { computeBrandKitHash } from '../utils/brandKitHash';
import { getRuntimeEnvValue } from '../utils/runtimeEnv';

const SUPABASE_URL = getRuntimeEnvValue('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '');
const SUPABASE_ANON_KEY = getRuntimeEnvValue('NEXT_PUBLIC_SUPABASE_ANON_KEY');

const encodeStoragePath = (value) => value.split('/').map(encodeURIComponent).join('/');

const toReadableUploadError = (error) => {
  const message = String(error?.message || error || 'Upload failed');
  const lower = message.toLowerCase();
  if (lower.includes('bucket') && lower.includes('not found')) {
    return 'Storage bucket "brand_assets" was not found. Run the Supabase setup migration and redeploy.';
  }
  return message;
};

function computeVersionHash(value) {
  try {
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(value || {}))));
    return encoded.slice(0, 16);
  } catch (_error) {
    return computeBrandKitHash(value);
  }
}

async function uploadWithProgress(bucket, storagePath, file, onProgress) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Session expired. Please sign in again.');
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Missing Supabase URL or anon key in frontend environment.');
  }

  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${bucket}/${encodeStoragePath(storagePath)}`;

  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl, true);
    xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
    xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const pct = Math.round((event.loaded / event.total) * 100);
      if (typeof onProgress === 'function') onProgress(pct);
    };

    xhr.onerror = () => reject(new Error('Network error during upload.'));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(null);
        return;
      }

      let responseError = xhr.responseText || 'Upload failed';
      try {
        const parsed = JSON.parse(xhr.responseText || '{}');
        responseError = parsed.message || parsed.error || responseError;
      } catch (_err) {
        // Keep raw response text.
      }

      reject(new Error(responseError));
    };

    xhr.send(file);
  });
}

function deriveStatus(kit) {
  if (!kit) return BRAND_KIT_STATUS.MISSING;
  if (kit.setup_completed) return BRAND_KIT_STATUS.CONFIGURED;
  if (kit.brand_name) return BRAND_KIT_STATUS.PARTIAL;
  return BRAND_KIT_STATUS.MISSING;
}

function pickActiveKit(kits = []) {
  return kits.find((kit) => kit.is_active) || kits[0] || null;
}

// Recomputes the plain `brandKit`/`activeKit`/`status` fields from
// `kits`/`currentKitId`. Call this inside every `set()` that changes
// either of those two, since they are not live getters (see the note
// above `status:` in the store's initial state).
function deriveViewFields(kits, currentKitId) {
  const activeKit = pickActiveKit(kits);
  const brandKit = kits.find((kit) => kit.id === currentKitId) || activeKit;
  return { brandKit, activeKit, status: deriveStatus(brandKit) };
}

const useBrandKitStore = create((set, get) => ({
  // State
  kits: [],
  currentKitId: null,
  assets: [],
  isLoading: false,
  loadingUserId: null,
  loadedUserId: null,
  isSaving: false,
  error: null,
  extractedDraft: null,
  setupPath: null,
  diffData: null,
  isDiffModalOpen: false,

  // Derived — NOT Zustand getters. `set()` shallow-merges via object
  // spread, which would evaluate a `get x() {...}` accessor once and
  // freeze the result as a plain stale property on the very next update.
  // These are instead plain fields, recomputed explicitly by every action
  // that touches `kits`/`currentKitId` (see `deriveViewFields` below).
  status: BRAND_KIT_STATUS.MISSING,
  // The kit currently being viewed/edited (dashboard/review form) — not
  // necessarily the same kit Studio generates from (see `activeKit`).
  brandKit: null,
  // The one kit Studio's generation pipeline reads from.
  activeKit: null,

  // Fetch every kit for this account. Does NOT auto-create an empty kit on
  // first load anymore (the mockup's empty/landing state now owns that
  // decision — see BrandKitPage.jsx's 'empty' screen).
  loadKits: async (userId) => {
    const { isLoading, loadingUserId, loadedUserId, kits } = get();
    if (!userId) return;
    if (isLoading && loadingUserId === userId) return;
    if (loadedUserId === userId && kits.length > 0) return;

    set({ isLoading: true, error: null, loadingUserId: userId });
    try {
      const { data: kitRows, error: kitErr } = await supabase
        .from('brand_kit')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (kitErr) throw kitErr;

      const active = pickActiveKit(kitRows || []);
      const currentKitId = active?.id || null;

      let assetRows = [];
      if (currentKitId) {
        const { data: assets, error: assetsErr } = await supabase
          .from('brand_assets')
          .select('*')
          .eq('brand_kit_id', currentKitId)
          .order('created_at', { ascending: false });
        if (assetsErr) throw assetsErr;
        assetRows = assets ?? [];
      }

      set({
        kits: kitRows ?? [],
        currentKitId,
        assets: assetRows,
        ...deriveViewFields(kitRows ?? [], currentKitId),
        isLoading: false,
        loadingUserId: null,
        loadedUserId: userId,
      });
    } catch (err) {
      const message = err?.message ?? 'Failed to load Brand Kit';
      const missingSchema =
        err?.code === 'PGRST205' ||
        err?.code === '42P01' ||
        err?.status === 404;

      set({
        error: missingSchema
          ? 'Brand Kit tables are missing in Supabase. Run the brand kit migration script.'
          : message,
        isLoading: false,
        loadingUserId: null,
        loadedUserId: missingSchema ? userId : get().loadedUserId,
        status: missingSchema ? BRAND_KIT_STATUS.MISSING : get().status,
      });
    }
  },

  // Backward-compat alias — existing call sites (UserSidebar,
  // BrandKitOnboardingModal) only need kit-completeness status.
  loadBrandKit: async (userId) => get().loadKits(userId),

  // Switch which kit is being viewed/edited (dashboard's kit switcher).
  // Does NOT change which kit Studio generates from — see setActiveKit.
  selectKit: async (kitId) => {
    const { kits } = get();
    const kit = kits.find((k) => k.id === kitId);
    if (!kit) return;

    set((state) => ({ currentKitId: kitId, isLoading: true, ...deriveViewFields(state.kits, kitId) }));
    try {
      const { data: assets, error } = await supabase
        .from('brand_assets')
        .select('*')
        .eq('brand_kit_id', kitId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      set({ assets: assets ?? [], isLoading: false });
    } catch (err) {
      set({ error: err.message, isLoading: false });
    }
  },

  // Mark one kit as the single active kit for the account (deactivate
  // others first so the partial unique index never sees two active rows
  // for the same user at once).
  setActiveKit: async (userId, kitId) => {
    set({ isSaving: true, error: null });
    try {
      const { error: deactivateErr } = await supabase
        .from('brand_kit')
        .update({ is_active: false })
        .eq('user_id', userId)
        .neq('id', kitId);
      if (deactivateErr) throw deactivateErr;

      const { data, error: activateErr } = await supabase
        .from('brand_kit')
        .update({ is_active: true })
        .eq('id', kitId)
        .select()
        .single();
      if (activateErr) throw activateErr;

      set((state) => {
        const kits = state.kits.map((kit) => ({ ...kit, is_active: kit.id === kitId }));
        return { kits, isSaving: false, ...deriveViewFields(kits, state.currentKitId) };
      });
      return data;
    } catch (err) {
      set({ error: err.message, isSaving: false });
      throw err;
    }
  },

  // Create a new, empty kit (mockup's "New brand kit" action / empty
  // state's "Start from scratch"). The first kit an account ever creates
  // becomes active by default; subsequent ones start inactive so the
  // partial unique index never conflicts silently.
  createKit: async (userId, fields = {}) => {
    set({ isSaving: true, error: null });
    try {
      const isFirstKit = get().kits.length === 0;
      const { data, error } = await supabase
        .from('brand_kit')
        .insert({
          user_id: userId,
          kit_name: fields.kit_name || 'New Brand Kit',
          is_active: isFirstKit,
          ...fields,
        })
        .select()
        .single();
      if (error) throw error;

      set((state) => {
        const kits = [data, ...state.kits];
        return { kits, currentKitId: data.id, assets: [], isSaving: false, ...deriveViewFields(kits, data.id) };
      });
      return data;
    } catch (err) {
      set({ error: err.message, isSaving: false });
      throw err;
    }
  },

  deleteKit: async (kitId) => {
    const { error } = await supabase.from('brand_kit').delete().eq('id', kitId);
    if (error) throw error;

    set((state) => {
      const remaining = state.kits.filter((kit) => kit.id !== kitId);
      const nextCurrent = state.currentKitId === kitId
        ? (pickActiveKit(remaining)?.id || null)
        : state.currentKitId;
      return { kits: remaining, currentKitId: nextCurrent, ...deriveViewFields(remaining, nextCurrent) };
    });
  },

  // Upsert brand kit fields onto a specific kit (defaults to whichever kit
  // is currently being viewed/edited). Upserts by `id`, not `user_id` —
  // the single-kit-per-user upsert this replaced no longer makes sense
  // once an account can hold multiple kits.
  saveBrandKit: async (userId, fields, kitIdOverride = null) => {
    set({ isSaving: true, error: null });
    try {
      const state = get();
      const kitId = kitIdOverride || state.currentKitId;
      const existing = state.kits.find((kit) => kit.id === kitId) || {};
      const merged = { ...existing, ...(fields || {}) };

      const payload = {
        ...fields,
        user_id: userId,
        last_updated_at: new Date().toISOString(),
        version_hash: computeVersionHash(merged),
      };

      let data;
      if (kitId) {
        const { data: updated, error } = await supabase
          .from('brand_kit')
          .update(payload)
          .eq('id', kitId)
          .select()
          .single();
        if (error) throw error;
        data = updated;
      } else {
        // No kit selected yet — create one (covers the manual/"Fill it
        // myself" and conversational first-save paths).
        const { data: inserted, error } = await supabase
          .from('brand_kit')
          .insert({ ...payload, is_active: state.kits.length === 0 })
          .select()
          .single();
        if (error) throw error;
        data = inserted;
      }

      set((prevState) => {
        const exists = prevState.kits.some((kit) => kit.id === data.id);
        const kits = exists
          ? prevState.kits.map((kit) => (kit.id === data.id ? data : kit))
          : [data, ...prevState.kits];
        return {
          kits,
          currentKitId: data.id,
          isSaving: false,
          loadedUserId: userId,
          ...deriveViewFields(kits, data.id),
        };
      });
      return data;
    } catch (err) {
      set({ error: err.message, isSaving: false });
      throw err;
    }
  },

  // Mark setup complete.
  markSetupComplete: async (userId) => {
    return get().saveBrandKit(userId, { setup_completed: true, setup_skipped: false });
  },

  // Skip setup.
  skipSetup: async (userId) => {
    return get().saveBrandKit(userId, { setup_skipped: true });
  },

  // Draft flow helpers.
  setExtractedDraft: (brandKit, confidenceMap = {}, missingTier1Fields = []) => {
    set({
      extractedDraft: {
        brandKit: brandKit || {},
        confidenceMap: confidenceMap || {},
        missingTier1Fields: missingTier1Fields || [],
      },
    });
  },

  clearExtractedDraft: () => {
    set({ extractedDraft: null });
  },

  setSetupPath: (path) => {
    set({ setupPath: path || null });
  },

  startDocumentExtraction: async () => {
    set({ setupPath: 'upload' });
  },

  openDiffModal: (existingKit, newKit, newConfidenceMap = {}) => {
    set({
      diffData: { existingKit, newKit, newConfidenceMap },
      isDiffModalOpen: true,
    });
  },

  closeDiffModal: () => {
    set({ isDiffModalOpen: false, diffData: null });
  },

  applyDiff: async (mergedKit, userIdOverride = null) => {
    const state = get();
    let userId = userIdOverride || state.brandKit?.user_id || state.loadedUserId;

    if (!userId) {
      const { data: { user } } = await supabase.auth.getUser();
      userId = user?.id || null;
    }

    if (!userId) throw new Error('Missing user id for Brand Kit update');

    const saved = await get().saveBrandKit(userId, mergedKit, state.currentKitId);
    set({ isDiffModalOpen: false, diffData: null });
    return saved;
  },

  // Upload an asset file and insert DB row.
  uploadAsset: async (userId, brandKitId, file, metadata = {}, options = {}) => {
    const timestamp = Date.now();
    const assetType = metadata.asset_type ?? 'other';
    const storagePath = `${userId}/${assetType}/${timestamp}_${file.name}`;
    const onProgress = options?.onProgress;

    const { data: assetRow, error: insertErr } = await supabase
      .from('brand_assets')
      .insert({
        user_id: userId,
        brand_kit_id: brandKitId,
        name: metadata.name ?? file.name,
        asset_type: assetType,
        file_name: file.name,
        mime_type: file.type,
        file_size_bytes: file.size,
        storage_path: storagePath,
        status: ASSET_STATUS.UPLOADING,
        description: metadata.description ?? '',
        usage_hints: metadata.usage_hints ?? '',
        alt_text: metadata.alt_text ?? '',
        tags: metadata.tags ?? [],
        font_family: metadata.font_family ?? null,
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    let uploadErr = null;
    try {
      await uploadWithProgress('brand_assets', storagePath, file, onProgress);
    } catch (error) {
      uploadErr = error;
    }

    if (uploadErr) {
      await supabase.from('brand_assets').update({ status: ASSET_STATUS.FAILED }).eq('id', assetRow.id);
      throw new Error(toReadableUploadError(uploadErr));
    }

    const { data: { publicUrl } } = supabase.storage
      .from('brand_assets')
      .getPublicUrl(storagePath);

    const { data: updated } = await supabase
      .from('brand_assets')
      .update({
        status: ASSET_STATUS.READY,
        public_url: publicUrl || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', assetRow.id)
      .select()
      .single();

    set((state) => ({ assets: [updated, ...state.assets.filter((asset) => asset.id !== updated.id)] }));
    return updated;
  },

  // Update asset metadata.
  updateAsset: async (assetId, fields) => {
    const { data, error } = await supabase
      .from('brand_assets')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', assetId)
      .select()
      .single();

    if (error) throw error;
    set((state) => ({ assets: state.assets.map((asset) => (asset.id === assetId ? data : asset)) }));
    return data;
  },

  // Delete an asset row and storage object.
  deleteAsset: async (assetId) => {
    const asset = get().assets.find((entry) => entry.id === assetId);
    if (!asset) return;

    if (asset.storage_path) {
      await supabase.storage.from('brand_assets').remove([asset.storage_path]);
    }

    const { error } = await supabase.from('brand_assets').delete().eq('id', assetId);
    if (error) throw error;

    set((state) => ({ assets: state.assets.filter((entry) => entry.id !== assetId) }));
  },

  resetBrandKitFlow: () => {
    set({
      extractedDraft: null,
      setupPath: null,
      diffData: null,
      isDiffModalOpen: false,
    });
  },
}));

export default useBrandKitStore;
