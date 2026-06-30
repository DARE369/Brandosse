import React, { useEffect, useMemo, useState } from 'react';
import { FolderOpen, Search, Upload, X } from 'lucide-react';
import OrgAssetUploadModal from '../OrgAssetUploadModal';

export default function CommonRoomAssetPicker({
  open = false,
  assets = [],
  loading = false,
  canUpload = false,
  onClose,
  onSelectAsset,
  onUploaded,
}) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);

  const visibleAssets = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return assets.filter((asset) => {
      if (asset.is_archived) return false;

      if (!normalizedQuery) return true;

      return [
        asset.name,
        asset.description,
        asset.file_type,
        asset.folder_path,
        ...(Array.isArray(asset.tags) ? asset.tags : []),
      ].some((value) => String(value || '').toLowerCase().includes(normalizedQuery));
    });
  }, [assets, query]);

  const selectedAsset = useMemo(
    () => visibleAssets.find((asset) => asset.id === selectedId) || visibleAssets[0] || null,
    [selectedId, visibleAssets],
  );

  useEffect(() => {
    if (!open) return;
    setSelectedId((current) => {
      if (visibleAssets.some((asset) => asset.id === current)) {
        return current;
      }
      return visibleAssets[0]?.id || '';
    });
  }, [open, visibleAssets]);

  if (!open) return null;

  return (
    <div className="common-room-modal" role="dialog" aria-modal="true" aria-label="Choose an asset reference">
      <button type="button" className="common-room-modal-backdrop" aria-label="Close asset picker" onClick={onClose} />

      <section className="common-room-picker-panel">
        <header className="common-room-picker-header">
          <div>
            <span className="common-room-eyebrow">Asset Reference</span>
            <h3>Attach from the library</h3>
          </div>
          <div className="common-room-picker-actions">
            {canUpload ? (
              <button type="button" className="common-room-button ghost" onClick={() => setUploadOpen(true)}>
                <Upload size={14} />
                Upload
              </button>
            ) : null}
            <button type="button" className="common-room-icon-button subtle" aria-label="Close asset picker" onClick={onClose}>
              <X size={15} />
            </button>
          </div>
        </header>

        <div className="common-room-picker-layout">
          <div className="common-room-picker-list">
            <label className="common-room-search">
              <Search size={14} />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search assets, folders, or tags"
              />
            </label>

            {uploadOpen ? (
              <div className="common-room-picker-upload">
                <OrgAssetUploadModal
                  open={uploadOpen}
                  embedded
                  onClose={() => setUploadOpen(false)}
                  onUploaded={async (asset) => {
                    await onUploaded?.(asset);
                    setUploadOpen(false);
                    if (asset?.id) {
                      setSelectedId(asset.id);
                    }
                  }}
                />
              </div>
            ) : loading ? (
              <div className="common-room-picker-empty">Loading assets...</div>
            ) : visibleAssets.length === 0 ? (
              <div className="common-room-picker-empty">No assets matched this search.</div>
            ) : (
              <div className="common-room-picker-items">
                {visibleAssets.map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    className={`common-room-picker-item ${selectedAsset?.id === asset.id ? 'active' : ''}`}
                    onClick={() => setSelectedId(asset.id)}
                  >
                    <strong>{asset.name}</strong>
                    <span>{asset.description || asset.file_type || 'Shared library asset'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <aside className="common-room-picker-preview">
            {selectedAsset ? (
              <>
                <div className="common-room-picker-preview-card">
                  <div className="common-room-picker-thumbnail">
                    {selectedAsset.thumbnail_url || selectedAsset.file_url ? (
                      <img
                        src={selectedAsset.thumbnail_url || selectedAsset.file_url}
                        alt={selectedAsset.name}
                      />
                    ) : (
                      <FolderOpen size={22} />
                    )}
                  </div>

                  <div className="common-room-picker-preview-copy">
                    <strong>{selectedAsset.name}</strong>
                    <p>{selectedAsset.description || 'Reusable library asset.'}</p>
                  </div>
                </div>

                <div className="common-room-picker-stat-grid">
                  <div>
                    <span>Type</span>
                    <strong>{selectedAsset.file_type || 'Asset'}</strong>
                  </div>
                  <div>
                    <span>Folder</span>
                    <strong>{selectedAsset.folder_path || '/'}</strong>
                  </div>
                  <div>
                    <span>Tags</span>
                    <strong>{Array.isArray(selectedAsset.tags) && selectedAsset.tags.length > 0 ? selectedAsset.tags.join(', ') : 'None'}</strong>
                  </div>
                  <div>
                    <span>Status</span>
                    <strong>{selectedAsset.approval_status || 'approved'}</strong>
                  </div>
                </div>

                <div className="common-room-modal-actions">
                  <button type="button" className="common-room-button ghost" onClick={onClose}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="common-room-button primary"
                    onClick={() => selectedAsset && onSelectAsset?.(selectedAsset)}
                  >
                    Send Asset Reference
                  </button>
                </div>
              </>
            ) : (
              <div className="common-room-picker-empty">Choose an asset to preview it here.</div>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}
