import React, { useMemo, useRef, useState } from 'react';
import { Upload, FileImage, FileText, FileType, Film, File as FileIcon } from 'lucide-react';
import useBrandKitStore from '../../stores/BrandKitStore';
import { ASSET_STATUS } from '../../constants/statusEnums';
import { Button } from '../../ui-v2';
import styles from './BrandKit.module.css';

// First guess at an asset's ROLE, from its file format alone. It is only a
// guess and it is often wrong: a logo saved as JPEG lands here as 'image',
// which is why the asset list lets the user say "Use as logo" instead. Do not
// try to make this map smarter — format does not determine role.
const ASSET_TYPE_MAP = {
  'image/png': 'logo',
  'image/jpeg': 'image',
  'image/webp': 'image',
  'image/svg+xml': 'logo',
  'application/pdf': 'document',
  'application/msword': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/zip': 'document',
  'application/x-zip-compressed': 'document',
  'font/ttf': 'font',
  'font/otf': 'font',
  'application/x-font-ttf': 'font',
  'application/x-font-otf': 'font',
  'video/mp4': 'video',
  'video/webm': 'video',
};

// Anything visual can BE a logo; documents, fonts and video cannot.
const PROMOTABLE_TO_LOGO = new Set(['image', 'other']);

const ICON_BY_ASSET_TYPE = {
  logo: FileImage,
  font: FileType,
  document: FileText,
  video: Film,
  image: FileImage,
  other: FileIcon,
};

export default function AssetUploader({ userId, brandKitId }) {
  const uploadAsset = useBrandKitStore((state) => state.uploadAsset);
  const assets = useBrandKitStore((state) => state.assets);
  const updateAsset = useBrandKitStore((state) => state.updateAsset);
  const deleteAsset = useBrandKitStore((state) => state.deleteAsset);

  // Which logo the renderer will ACTUALLY pick. Mirrors resolveBrandLogo in
  // supabase/functions/generateImage/index.ts: newest ready 'logo' by
  // updated_at. Shown explicitly because a kit can hold several logos and
  // "which one am I getting?" should not be a guess.
  const activeLogoId = useMemo(() => {
    const logos = assets.filter(
      (a) => a.asset_type === 'logo' && a.status === ASSET_STATUS.READY,
    );
    if (!logos.length) return null;
    const stamp = (a) => new Date(a.updated_at || a.created_at || 0).getTime();
    return logos.reduce((best, a) => (stamp(a) > stamp(best) ? a : best)).id;
  }, [assets]);

  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [uploadError, setUploadError] = useState(null);
  const [uploadItems, setUploadItems] = useState([]);

  const setUploadItem = (id, patch) => {
    setUploadItems((items) => items.map((item) => (
      item.id === id ? { ...item, ...patch } : item
    )));
  };

  const handleFiles = async (fileList) => {
    if (!fileList?.length) return;

    const files = Array.from(fileList);
    const queue = files.map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      name: file.name,
      progress: 0,
      status: 'uploading',
    }));

    setUploading(true);
    setUploadError(null);
    setUploadItems(queue);

    try {
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const queueItem = queue[i];
        const assetType = ASSET_TYPE_MAP[file.type] ?? 'other';

        await uploadAsset(
          userId,
          brandKitId,
          file,
          { asset_type: assetType },
          { onProgress: (pct) => setUploadItem(queueItem.id, { progress: pct }) },
        );

        setUploadItem(queueItem.id, { progress: 100, status: 'done' });
      }
    } catch (error) {
      setUploadError(error.message || 'Upload failed');
      setUploadItems((items) => items.map((item) => (
        item.status === 'done' ? item : { ...item, status: 'failed' }
      )));
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    handleFiles(event.dataTransfer.files);
  };

  const startEdit = (asset) => {
    setEditingId(asset.id);
    setEditForm({
      name: asset.name ?? '',
      description: asset.description ?? '',
      usage_hints: asset.usage_hints ?? '',
      alt_text: asset.alt_text ?? '',
      tags: (asset.tags ?? []).join(', '),
    });
  };

  const saveEdit = async () => {
    await updateAsset(editingId, {
      ...editForm,
      tags: String(editForm.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean),
    });
    setEditingId(null);
  };

  return (
    <div>
      <div
        className={[styles.dropZone, dragging ? styles.dropZoneDragging : ''].filter(Boolean).join(' ')}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        aria-label="Upload brand assets"
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept=".png,.jpg,.jpeg,.webp,.svg,.gif,.pdf,.doc,.docx,.txt,.md,.ttf,.otf,.mp4,.webm,.zip"
          onChange={(event) => { handleFiles(event.target.files); event.target.value = ''; }}
        />
        <Upload size={20} className={styles.dropZoneIcon} />
        {uploading ? (
          <span className={styles.dropZoneTitle}>Uploading files…</span>
        ) : (
          <>
            <span className={styles.dropZoneTitle}>Drop files here or click to upload</span>
            <span className={styles.dropZoneSub}>Logos, fonts, brand docs, mood boards</span>
          </>
        )}
      </div>

      {uploadItems.length > 0 && (
        <div className={styles.uploadProgressList}>
          {uploadItems.map((item) => (
            <div key={item.id} className={[styles.progressItem, item.status === 'failed' ? styles.progressItemFailed : ''].filter(Boolean).join(' ')}>
              <div className={styles.progressItemHead}>
                <span className={styles.progressItemName} title={item.name}>{item.name}</span>
                <span className={styles.progressItemPct}>{item.progress}%</span>
              </div>
              <div className={styles.progressItemTrack}>
                <div className={styles.progressItemFill} style={{ width: `${item.progress}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {uploadError && <p className={styles.uploadErrorText} role="alert">{uploadError}</p>}

      {assets.length > 0 && (
        <div className={styles.assetListWrap}>
          <h4 className={styles.assetListTitle}>Uploaded assets ({assets.length})</h4>
          {assets.map((asset) => {
            const Icon = ICON_BY_ASSET_TYPE[asset.asset_type] || ICON_BY_ASSET_TYPE.other;
            return (
              <div key={asset.id} className={styles.assetRow}>
                <div className={styles.assetRowHeader}>
                  <span className={styles.assetIcon}><Icon size={14} /></span>
                  <span className={styles.assetName}>{asset.name}</span>
                  <span className={styles.assetTypeBadge}>{asset.asset_type}</span>
                  <span
                    className={[
                      styles.assetStatusDot,
                      asset.status === ASSET_STATUS.READY ? styles.assetStatusReady : '',
                      asset.status === ASSET_STATUS.UPLOADING ? styles.assetStatusUploading : '',
                      asset.status === ASSET_STATUS.FAILED ? styles.assetStatusFailed : '',
                    ].filter(Boolean).join(' ')}
                    title={asset.status}
                  />
                  {asset.id === activeLogoId && (
                    <span className={styles.assetTypeBadge} title="This is the logo stamped onto generated images">
                      on images
                    </span>
                  )}
                  {PROMOTABLE_TO_LOGO.has(asset.asset_type) && asset.status === ASSET_STATUS.READY && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => updateAsset(asset.id, { asset_type: 'logo' })}
                      title="Mark this file as your logo so it can be stamped onto generated images"
                    >
                      Use as logo
                    </Button>
                  )}
                  {asset.asset_type === 'logo' && asset.id !== activeLogoId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => updateAsset(asset.id, { asset_type: 'logo' })}
                      title="Use this logo instead of the current one"
                    >
                      Use this one
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => startEdit(asset)}>Edit</Button>
                  <Button variant="danger" size="sm" onClick={() => deleteAsset(asset.id)}>Delete</Button>
                </div>

                {asset.description && <p className={styles.assetMeta}>Description: {asset.description}</p>}
                {asset.usage_hints && <p className={styles.assetMeta}>Usage: {asset.usage_hints}</p>}

                {editingId === asset.id && (
                  <div className={styles.assetEditForm}>
                    {[
                      { label: 'Name', key: 'name', type: 'text' },
                      { label: 'Description', key: 'description', type: 'textarea' },
                      { label: 'Usage hints', key: 'usage_hints', type: 'textarea' },
                      { label: 'Alt text (images)', key: 'alt_text', type: 'text' },
                      { label: 'Tags (comma-separated)', key: 'tags', type: 'text' },
                    ].map(({ label, key, type }) => (
                      <label key={key} className={styles.field}>
                        <span className={styles.label}>{label}</span>
                        {type === 'textarea' ? (
                          <textarea
                            className={styles.textarea}
                            value={editForm[key] ?? ''}
                            onChange={(event) => setEditForm((form) => ({ ...form, [key]: event.target.value }))}
                          />
                        ) : (
                          <input
                            className={styles.input}
                            type="text"
                            value={editForm[key] ?? ''}
                            onChange={(event) => setEditForm((form) => ({ ...form, [key]: event.target.value }))}
                          />
                        )}
                      </label>
                    ))}
                    <div className={styles.assetEditActions}>
                      <Button onClick={saveEdit}>Save</Button>
                      <Button variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
