// src/stores/BrandKitStore.js

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

const useBrandKitStore = create((set, get) => ({
  // State
  brandKit: null,
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

  // Derived
  status: BRAND_KIT_STATUS.MISSING,

  // Load the brand kit for the current user.
  loadBrandKit: async (userId) => {
    const { isLoading, loadingUserId, loadedUserId, brandKit } = get();
    if (!userId) return;
    if (isLoading && loadingUserId === userId) return;
    if (loadedUserId === userId && brandKit?.user_id === userId) return;

    set({ isLoading: true, error: null, loadingUserId: userId });
    try {
      const { data: kit, error: kitErr } = await supabase
        .from('brand_kit')
        .upsert({ user_id: userId }, { onConflict: 'user_id' })
        .select('*')
        .single();

      if (kitErr) throw kitErr;

      const { data: assets, error: assetsErr } = await supabase
        .from('brand_assets')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (assetsErr) throw assetsErr;

      const status = deriveStatus(kit);

      set({
        brandKit: kit ?? null,
        assets: assets ?? [],
        status,
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

  // Upsert brand kit fields.
  saveBrandKit: async (userId, fields) => {
    set({ isSaving: true, error: null });
    try {
      const state = get();
      const merged = {
        ...(state.brandKit || {}),
        ...(fields || {}),
      };
      const payload = {
        ...fields,
        user_id: userId,
        last_updated_at: new Date().toISOString(),
        version_hash: computeVersionHash(merged),
      };

      const { data, error } = await supabase
        .from('brand_kit')
        .upsert(
          payload,
          { onConflict: 'user_id' },
        )
        .select()
        .single();

      if (error) throw error;

      const status = deriveStatus(data);
      set({
        brandKit: data,
        status,
        isSaving: false,
        loadedUserId: userId,
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

    const saved = await get().saveBrandKit(userId, mergedKit);
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

function deriveStatus(kit) {
  if (!kit) return BRAND_KIT_STATUS.MISSING;
  if (kit.setup_completed) return BRAND_KIT_STATUS.CONFIGURED;
  if (kit.brand_name) return BRAND_KIT_STATUS.PARTIAL;
  return BRAND_KIT_STATUS.MISSING;
}

export default useBrandKitStore;
