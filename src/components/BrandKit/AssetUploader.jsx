import React, { useRef, useState } from 'react';
import useBrandKitStore from '../../stores/BrandKitStore';
import { ASSET_STATUS } from '../../constants/statusEnums';

const ASSET_TYPE_MAP = {
  'image/png': 'logo',
  'image/jpeg': 'image',
  'image/webp': 'image',
  'image/svg+xml': 'logo',
  'application/pdf': 'document',
  'application/msword': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'font/ttf': 'font',
  'font/otf': 'font',
  'application/x-font-ttf': 'font',
  'application/x-font-otf': 'font',
  'video/mp4': 'video',
  'video/webm': 'video',
};

const iconByAssetType = {
  logo: '[LOGO]',
  font: '[FONT]',
  document: '[DOC]',
  video: '[VIDEO]',
  image: '[IMG]',
  other: '[FILE]',
};

export default function AssetUploader({ userId, brandKitId }) {
  const uploadAsset = useBrandKitStore((state) => state.uploadAsset);
  const assets = useBrandKitStore((state) => state.assets);
  const updateAsset = useBrandKitStore((state) => state.updateAsset);
  const deleteAsset = useBrandKitStore((state) => state.deleteAsset);

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
          {
            onProgress: (pct) => setUploadItem(queueItem.id, { progress: pct }),
          },
        );

        setUploadItem(queueItem.id, { progress: 100, status: 'done' });
      }
    } catch (error) {
      setUploadError(error.message || 'Upload failed');
      setUploadItems((items) => items.map((item) => (
        item.status === 'done'
          ? item
          : { ...item, status: 'failed' }
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
      tags: String(editForm.tags || '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    });
    setEditingId(null);
  };

  return (
    <div className="asset-uploader">
      <div
        className={`asset-drop-zone${dragging ? ' dragging' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
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
          accept=".png,.jpg,.jpeg,.webp,.svg,.gif,.pdf,.doc,.docx,.txt,.md,.ttf,.otf,.mp4,.webm"
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = '';
          }}
        />
        {uploading ? (
          <span>Uploading files...</span>
        ) : (
          <span>
            Drop files here or click to upload
            <br />
            <small>Logos, Fonts, Brand Docs, Mood Boards</small>
          </span>
        )}
      </div>

      {uploadItems.length > 0 && (
        <div className="asset-upload-progress-list">
          {uploadItems.map((item) => (
            <div key={item.id} className={`asset-upload-progress-item ${item.status}`}>
              <div className="asset-upload-progress-head">
                <span className="asset-upload-progress-name" title={item.name}>{item.name}</span>
                <span className="asset-upload-progress-pct">{item.progress}%</span>
              </div>
              <div className="asset-upload-progress-track">
                <div className="asset-upload-progress-fill" style={{ width: `${item.progress}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {uploadError && (
        <p className="asset-upload-error" role="alert">{uploadError}</p>
      )}

      {assets.length > 0 && (
        <div className="asset-list">
          <h4>Uploaded assets ({assets.length})</h4>
          {assets.map((asset) => (
            <div key={asset.id} className="asset-row">
              <div className="asset-row-header">
                <span className="asset-icon">{iconByAssetType[asset.asset_type] || iconByAssetType.other}</span>
                <span className="asset-name">{asset.name}</span>
                <span className="asset-type-badge">{asset.asset_type}</span>
                <span className={`asset-status-dot ${asset.status}`} title={asset.status} />
                <button className="asset-btn" onClick={() => startEdit(asset)}>Edit</button>
                <button className="asset-btn danger" onClick={() => deleteAsset(asset.id)}>Delete</button>
              </div>

              {asset.description && <p className="asset-meta">Description: {asset.description}</p>}
              {asset.usage_hints && <p className="asset-meta">Usage: {asset.usage_hints}</p>}
              {asset.status === ASSET_STATUS.READY && asset.extracted_text && (
                <p className="asset-meta extracted-ok">Text extracted</p>
              )}

              {editingId === asset.id && (
                <div className="asset-edit-form">
                  {[
                    { label: 'Name', key: 'name', type: 'text' },
                    { label: 'Description', key: 'description', type: 'textarea' },
                    { label: 'Usage hints', key: 'usage_hints', type: 'textarea' },
                    { label: 'Alt text (images)', key: 'alt_text', type: 'text' },
                    { label: 'Tags (comma-separated)', key: 'tags', type: 'text' },
                  ].map(({ label, key, type }) => (
                    <label key={key}>
                      {label}
                      {type === 'textarea' ? (
                        <textarea
                          value={editForm[key] ?? ''}
                          onChange={(event) => setEditForm((form) => ({ ...form, [key]: event.target.value }))}
                        />
                      ) : (
                        <input
                          type="text"
                          value={editForm[key] ?? ''}
                          onChange={(event) => setEditForm((form) => ({ ...form, [key]: event.target.value }))}
                        />
                      )}
                    </label>
                  ))}
                  <div className="asset-edit-actions">
                    <button className="bk-btn-primary" onClick={saveEdit}>Save</button>
                    <button className="bk-btn-secondary" onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
