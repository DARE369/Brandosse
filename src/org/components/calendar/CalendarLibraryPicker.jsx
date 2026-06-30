import React, { useMemo, useState } from 'react';
import { Archive, CheckCircle2, Folder, Search, Star, Upload, X } from 'lucide-react';
import OrgAssetUploadModal from '../OrgAssetUploadModal';

const COLLECTIONS = [
  { id: 'all', label: 'All Assets', icon: Folder },
  { id: 'recent', label: 'Recently Added', icon: Search },
  { id: 'brand', label: 'Brand Assets', icon: Star },
  { id: 'pending', label: 'Pending Approval', icon: CheckCircle2 },
  { id: 'archived', label: 'Archived', icon: Archive },
];

export default function CalendarLibraryPicker({
  open = false,
  assets = [],
  onClose,
  onConfirmAssets,
  onUploaded,
}) {
  const [query, setQuery] = useState('');
  const [collection, setCollection] = useState('all');
  const [folderFilter, setFolderFilter] = useState('/');
  const [selectedIds, setSelectedIds] = useState([]);
  const [uploadOpen, setUploadOpen] = useState(false);

  const folderOptions = useMemo(() => {
    const folders = new Set(['/']);
    assets.forEach((asset) => folders.add(asset.folder_path || '/'));
    return [...folders].sort((left, right) => left.localeCompare(right));
  }, [assets]);

  const visibleAssets = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const recentCutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);

    return assets.filter((asset) => {
      if (folderFilter !== '/' && (asset.folder_path || '/') !== folderFilter) return false;

      const matchesSearch = !normalizedQuery || [
        asset.name,
        asset.description,
        asset.file_type,
        ...(Array.isArray(asset.tags) ? asset.tags : []),
      ].some((value) => String(value || '').toLowerCase().includes(normalizedQuery));

      if (!matchesSearch) return false;

      switch (collection) {
        case 'recent':
          return asset.created_at && new Date(asset.created_at).getTime() >= recentCutoff && !asset.is_archived;
        case 'brand':
          return Boolean(asset.is_brand_asset) && !asset.is_archived;
        case 'pending':
          return asset.approval_status === 'pending' && !asset.is_archived;
        case 'archived':
          return Boolean(asset.is_archived);
        case 'all':
        default:
          return !asset.is_archived;
      }
    });
  }, [assets, collection, folderFilter, query]);

  const selectedAssets = useMemo(() => (
    selectedIds
      .map((assetId) => assets.find((asset) => asset.id === assetId))
      .filter(Boolean)
  ), [assets, selectedIds]);

  if (!open) return null;

  const toggleAsset = (assetId) => {
    setSelectedIds((current) => (
      current.includes(assetId)
        ? current.filter((id) => id !== assetId)
        : [...current, assetId]
    ));
  };

  return (
    <>
      <div className="org-calendar-library-picker" role="dialog" aria-modal="true" aria-label="Browse org assets">
        <button
          type="button"
          className="org-calendar-library-backdrop"
          aria-label="Close library picker"
          onClick={onClose}
        />

        <section className="org-calendar-library-explorer">
          <header className="org-calendar-library-header">
            <div>
              <span className="org-calendar-drawer-eyebrow">Library Explorer</span>
              <h3>Select Assets for a New Draft</h3>
            </div>
            <button type="button" className="org-close-button" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          </header>

          <div className="org-calendar-library-explorer-layout">
            <aside className="org-calendar-library-nav">
              <label className="org-calendar-library-search">
                <Search size={14} />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by name, tag, or folder"
                />
              </label>

              <div className="org-calendar-library-nav-group">
                <span>Collections</span>
                <div className="org-calendar-library-nav-list">
                  {COLLECTIONS.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`org-calendar-library-nav-item ${collection === item.id ? 'active' : ''}`.trim()}
                        onClick={() => setCollection(item.id)}
                      >
                        <span>
                          <Icon size={14} />
                          {item.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="org-calendar-library-nav-group">
                <span>Folders</span>
                <div className="org-calendar-library-nav-list">
                  {folderOptions.map((folder) => (
                    <button
                      key={folder}
                      type="button"
                      className={`org-calendar-library-nav-item ${folderFilter === folder ? 'active' : ''}`.trim()}
                      onClick={() => setFolderFilter(folder)}
                    >
                      <span>
                        <Folder size={14} />
                        {folder}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </aside>

            <div className="org-calendar-library-main">
              <div className="org-calendar-library-main-header">
                <div>
                  <strong>{visibleAssets.length} visible assets</strong>
                  <span>Choose one or more assets to seed the next draft.</span>
                </div>
                <button type="button" className="org-text-button" onClick={() => setUploadOpen(true)}>
                  <Upload size={14} />
                  Upload
                </button>
              </div>

              <div className="org-calendar-library-grid explorer">
                {visibleAssets.length === 0 ? (
                  <div className="org-calendar-empty-inline">No assets matched this view.</div>
                ) : (
                  visibleAssets.map((asset) => {
                    const active = selectedIds.includes(asset.id);
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        className={`org-calendar-library-asset ${active ? 'active' : ''}`.trim()}
                        onClick={() => toggleAsset(asset.id)}
                      >
                        <div className="org-calendar-library-asset-copy">
                          <strong>{asset.name}</strong>
                          <span>{asset.description || asset.folder_path || 'Shared library asset'}</span>
                        </div>
                        <div className="org-calendar-library-asset-meta">
                          <span>{asset.file_type}</span>
                          <span>{asset.folder_path || '/'}</span>
                          {asset.is_brand_asset ? <span>Brand asset</span> : null}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <aside className="org-calendar-library-selection">
              {uploadOpen ? (
                <OrgAssetUploadModal
                  open={uploadOpen}
                  embedded
                  onClose={() => setUploadOpen(false)}
                  onUploaded={async (asset) => {
                    await onUploaded?.(asset);
                    if (asset?.id) {
                      setSelectedIds((current) => [...new Set([...current, asset.id])]);
                    }
                    setUploadOpen(false);
                  }}
                />
              ) : (
                <>
                  <div className="org-panel-header">
                    <div>
                      <h3>Selection Tray</h3>
                      <p>{selectedAssets.length} assets ready for the composer.</p>
                    </div>
                    <button type="button" className="org-text-button" onClick={() => setUploadOpen(true)}>
                      <Upload size={14} />
                      Upload
                    </button>
                  </div>

                  {selectedAssets.length === 0 ? (
                    <div className="org-calendar-empty-inline">Select assets to continue into the org composer.</div>
                  ) : (
                    <div className="org-calendar-library-selection-list">
                      {selectedAssets.map((asset) => (
                        <div key={asset.id} className="org-calendar-library-selection-item">
                          <strong>{asset.name}</strong>
                          <span>{asset.file_type} | {asset.folder_path || '/'}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="org-calendar-library-selection-actions">
                    <button type="button" className="org-text-button" onClick={() => setSelectedIds([])}>
                      Clear Selection
                    </button>
                    <button
                      type="button"
                      className="org-primary-button"
                      disabled={selectedAssets.length === 0}
                      onClick={() => onConfirmAssets?.(selectedAssets)}
                    >
                      Continue with {selectedAssets.length || 0} Asset{selectedAssets.length === 1 ? '' : 's'}
                    </button>
                  </div>
                </>
              )}
            </aside>
          </div>
        </section>
      </div>
    </>
  );
}
