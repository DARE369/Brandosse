"use client";

// Personal Content Library — refactored in place per AS_IS_AUDIT.md §3.1
// (Refactor: the unified filterable grid/table + bulk-select interaction
// shape was right; the data model underneath moves from a 3-table
// client-side stitch to the new public.personal_assets table). Built
// strictly against the approved mockup
// (docs/calendar-library-rebuild/packet-2-personal-library/mockups/mockup-gallery.html)
// — grid view (source badges, no approval pill, hover/tap quick actions),
// table view, "Unused" filter chip, mobile filter rail bottom sheet,
// upload flow, asset detail drawer, soft-delete with recovery banner, and
// the real Schedule hand-off into Calendar's Quick Post composer (spec §7).
import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  FileImage,
  Filter,
  Grid3X3,
  List,
  Plus,
  RefreshCw,
  Search,
  Upload,
} from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';
import UserNavbar from '../../components/User/UserNavbar';
import UserSidebar from '../../components/User/UserSidebar';
import { useAppNavigation } from '../../Context/AppNavigationContext';
import {
  UiBottomSheet,
  UiButton,
  UiEmptyState,
  UiIconButton,
  UiPageHeader,
} from '../../components/Shared/ui';
import LibraryCard from './components/LibraryCard';
import LibraryBulkActionBar from './components/LibraryBulkActionBar';
import AssetUploadModal from './components/AssetUploadModal';
import AssetDetailDrawer from './components/AssetDetailDrawer';
import SoftDeleteConfirmModal from './components/SoftDeleteConfirmModal';
import TrashModal from './components/TrashModal';
import {
  getItemTitle,
  getSourceLabel,
  getMetaLeftLabel,
  getMetaRightLabel,
  getFormatLabel,
  isUnused,
  formatDate,
} from './libraryItemUtils';
import useLibraryStore from '../../stores/LibraryStore';
import { buildScheduleHandoffPath } from '../../services/assetLibraryService';

const LIBRARY_FILTER_PREFS_KEY = 'socialai:library-filter-prefs-v2';

const SOURCE_RAIL_ITEMS = [
  { value: 'all', label: 'All' },
  { value: 'upload', label: 'Uploads' },
  { value: 'generation', label: 'Generations' },
  { value: 'post', label: 'Post-linked' },
];
const STATUS_RAIL_ITEMS = [
  { value: 'unused', label: 'Unused' },
  { value: 'archived', label: 'Archived' },
];

function readStoredLibraryFilterPrefs() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    return JSON.parse(window.localStorage.getItem(LIBRARY_FILTER_PREFS_KEY) || 'null');
  } catch (_err) {
    return null;
  }
}

function LibraryTableThumb({ asset }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="library-table-thumb">
      {asset.thumbnail_url && !failed ? (
        <img src={asset.thumbnail_url} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <FileImage size={16} />
      )}
    </span>
  );
}

export default function LibraryPageV2() {
  const { navigate } = useAppNavigation();
  const {
    assets,
    counts,
    loading,
    error,
    fetchLibraryData,
    uploadAsset,
    updateAssetMetadata,
    archiveAsset,
    softDeleteAsset,
    fetchAssetById,
    fetchUsedIn,
    fetchVersionChainFor,
    markAsNewVersion,
    fetchTrash,
    restoreAsset,
    clearError,
  } = useLibraryStore();

  const [cachedPrefs] = useState(readStoredLibraryFilterPrefs);
  const [rememberFilters, setRememberFilters] = useState(Boolean(cachedPrefs?.remember));
  const [search, setSearch] = useState(cachedPrefs?.remember ? (cachedPrefs?.search || '') : '');
  const [sourceFilter, setSourceFilter] = useState(cachedPrefs?.remember ? (cachedPrefs?.sourceFilter || 'all') : 'all');
  const [statusRail, setStatusRail] = useState(null); // null | 'unused' | 'archived'
  const [typeFilter, setTypeFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [unusedChipActive, setUnusedChipActive] = useState(false);
  const [viewMode, setViewMode] = useState('grid');
  const [mobileRailOpen, setMobileRailOpen] = useState(false);

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [drawerAsset, setDrawerAsset] = useState(null);
  const [drawerUsedIn, setDrawerUsedIn] = useState([]);
  const [versionChain, setVersionChain] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Phase 4 QA fix (DECISIONS_LOG.md, QA item 4 — Trash/restore UI).
  const [showTrashModal, setShowTrashModal] = useState(false);
  const [trashedAssets, setTrashedAssets] = useState([]);
  const [trashLoading, setTrashLoading] = useState(false);

  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    fetchLibraryData();
  }, [fetchLibraryData]);

  useEffect(() => {
    const handler = () => fetchLibraryData({ force: true });
    window.addEventListener('socialai:data-sync', handler);
    return () => window.removeEventListener('socialai:data-sync', handler);
  }, [fetchLibraryData]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (!rememberFilters) {
      window.localStorage.removeItem(LIBRARY_FILTER_PREFS_KEY);
      return;
    }
    window.localStorage.setItem(LIBRARY_FILTER_PREFS_KEY, JSON.stringify({
      remember: true,
      search,
      sourceFilter,
    }));
  }, [rememberFilters, search, sourceFilter]);

  useEffect(() => {
    if (error) {
      toast.error(error);
      clearError();
    }
  }, [error, clearError]);

  const availableTags = useMemo(() => {
    const tagSet = new Set();
    assets.forEach((asset) => {
      (asset.tags || []).forEach((tag) => tag && tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [assets]);

  const filteredAssets = useMemo(() => {
    const query = search.trim().toLowerCase();

    return assets
      .filter((asset) => {
        // Default view excludes archived/trashed unless the rail explicitly
        // selects them — matches the mockup's left-rail "Status" group.
        if (statusRail === 'archived') return asset.status === 'archived';
        if (asset.status !== 'active') return false;
        if (statusRail === 'unused') return isUnused(asset);
        return true;
      })
      .filter((asset) => (sourceFilter === 'all' ? true : asset.source === sourceFilter))
      .filter((asset) => (typeFilter === 'all' ? true : asset.media_type === typeFilter))
      .filter((asset) => (tagFilter === 'all' ? true : (asset.tags || []).includes(tagFilter)))
      .filter((asset) => (unusedChipActive ? isUnused(asset) : true))
      .filter((asset) => {
        if (!query) return true;
        return (
          (asset.title || '').toLowerCase().includes(query)
          || (asset.description || '').toLowerCase().includes(query)
          || (asset.alt_text || '').toLowerCase().includes(query)
          || (asset.tags || []).join(' ').toLowerCase().includes(query)
          || (asset.ai_tags || []).join(' ').toLowerCase().includes(query)
        );
      })
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  }, [assets, search, sourceFilter, statusRail, typeFilter, tagFilter, unusedChipActive]);

  const railCounts = useMemo(() => ({
    all: counts.all,
    upload: counts.upload,
    generation: counts.generation,
    post: counts.post,
    unused: counts.unused,
    archived: counts.archived,
  }), [counts]);

  // ── Schedule hand-off (LIBRARY_SPEC.md §7) — navigates to the real
  // Calendar route with ?quickPost=1&prefillAssetId=<id>, exactly the
  // contract PersonalCalendarPage.jsx/QuickPostComposer.jsx already read.
  const handleSchedule = (asset) => {
    navigate(buildScheduleHandoffPath(asset.id));
  };

  const openDrawer = async (asset) => {
    setDrawerAsset(asset);
    setDrawerUsedIn([]);
    setVersionChain([]);
    try {
      const [usedIn, chain] = await Promise.all([
        fetchUsedIn(asset.id),
        fetchVersionChainFor(asset.id),
      ]);
      setDrawerUsedIn(usedIn);
      setVersionChain(chain);
    } catch (err) {
      console.error('Failed to load asset detail:', err);
    }
  };

  const handleSaveMetadata = async (assetId, updates) => {
    try {
      const updated = await updateAssetMetadata(assetId, updates);
      setDrawerAsset(updated);
      toast.success('Changes saved');
    } catch (err) {
      console.error('Save metadata failed:', err);
      toast.error('Could not save changes');
    }
  };

  const handleUploadOne = async ({ file, onProgress }) => uploadAsset({
    file,
    title: file.name,
    onProgress,
  });

  // Upload flow's duplicate-warning "This is a new version" action
  // (LIBRARY_SPEC.md §6.2) — actually links the old asset's
  // superseded_by_asset_id to the new upload via the real store/service
  // call, then refreshes the grid/table so the old row drops out of the
  // default view immediately rather than waiting for the next full fetch.
  const handleMarkAsVersion = async ({ oldAssetId, newAssetId }) => {
    // Phase 4 QA fix (DECISIONS_LOG.md, QA item 5): this previously had no
    // try/catch of its own — AssetUploadModal.jsx's own try/catch around
    // its `await onMarkAsVersion?.(...)` call already surfaces a failure
    // as inline `versionLinkError` text, but that's easy to miss (small
    // text under a dismissed warning row) and gives no page-level signal
    // once the upload modal is closed. Re-throwing here (not swallowing)
    // so the modal's own existing inline-error handling still fires
    // exactly as before — this toast is additive, not a replacement.
    try {
      await markAsNewVersion({ oldAssetId, newAssetId });
      toast.success('Linked as a new version');
    } catch (err) {
      toast.error(err?.message || 'Could not link this as a new version — the previous upload was not updated.');
      throw err;
    }
  };

  const handleArchive = async (asset) => {
    try {
      await archiveAsset(asset.id);
      toast.success('Archived');
    } catch (err) {
      console.error('Archive failed:', err);
      toast.error('Failed to archive');
    }
  };

  const confirmDelete = async (asset) => {
    setDeleteBusy(true);
    try {
      await softDeleteAsset(asset.id);
      toast.success('Moved to Trash — recoverable for 30 days');
      setDeleteTarget(null);
      if (drawerAsset?.id === asset.id) setDrawerAsset(null);
    } catch (err) {
      console.error('Delete failed:', err);
      toast.error('Failed to delete');
    } finally {
      setDeleteBusy(false);
    }
  };

  // Phase 4 QA fix (DECISIONS_LOG.md, QA item 4) — the soft-delete modal's
  // own copy promises a 30-day recovery window; these two handlers are the
  // missing UI-side connection to the already-working
  // fetchTrash()/restoreAsset() store actions.
  const openTrash = async () => {
    setShowTrashModal(true);
    setTrashLoading(true);
    try {
      const rows = await fetchTrash();
      setTrashedAssets(rows);
    } catch (err) {
      console.error('Failed to load Trash:', err);
      toast.error('Could not load Trash');
    } finally {
      setTrashLoading(false);
    }
  };

  const handleRestore = async (asset) => {
    try {
      await restoreAsset(asset.id);
      setTrashedAssets((current) => current.filter((row) => row.id !== asset.id));
      toast.success(`Restored "${getItemTitle(asset)}"`);
      // The main grid's counts/list are stale relative to this restore
      // (the restored row needs to reappear there too) — force a refetch
      // rather than leaving fetchLibraryData's normal staleness window in
      // place, so the asset is immediately visible back in the Library.
      fetchLibraryData({ force: true });
    } catch (err) {
      console.error('Restore failed:', err);
      toast.error(err?.message || 'Could not restore this asset');
    }
  };

  const handleNavigateToPost = (post) => {
    navigate(`/app/calendar?postId=${encodeURIComponent(post.id)}`);
  };

  const handleOpenVersion = async (version) => {
    const full = await fetchAssetById(version.id);
    if (full) openDrawer(full);
  };

  const resetFilters = () => {
    setSearch('');
    setSourceFilter('all');
    setStatusRail(null);
    setTypeFilter('all');
    setTagFilter('all');
    setUnusedChipActive(false);
  };

  // ── Bulk select ────────────────────────────────────────────────────────
  const toggleItemSelected = (asset) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(asset.id)) next.delete(asset.id);
      else next.add(asset.id);
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());
  const toggleBulkMode = () => {
    setBulkMode((current) => {
      if (current) clearSelection();
      return !current;
    });
  };
  const selectedAssets = filteredAssets.filter((asset) => selectedIds.has(asset.id));

  const runBulkAction = async (actionFn, successMessage) => {
    if (selectedAssets.length === 0) return;
    setBulkBusy(true);
    const results = await Promise.allSettled(selectedAssets.map((asset) => actionFn(asset)));
    setBulkBusy(false);
    const failures = results.filter((r) => r.status === 'rejected').length;
    if (failures > 0) toast.error(`${failures} of ${selectedAssets.length} failed`);
    else toast.success(successMessage);
    clearSelection();
  };

  const handleBulkArchive = () => runBulkAction((asset) => archiveAsset(asset.id), 'Assets archived');
  const handleBulkDelete = () => runBulkAction((asset) => softDeleteAsset(asset.id), 'Assets moved to Trash');

  const activeStatusLabel = statusRail
    ? STATUS_RAIL_ITEMS.find((i) => i.value === statusRail)?.label
    : SOURCE_RAIL_ITEMS.find((i) => i.value === sourceFilter)?.label;
  const activeRailCount = statusRail ? railCounts[statusRail] : railCounts[sourceFilter];

  const railContent = (onSelect) => (
    <>
      <p className="lib-rail__label">Source</p>
      {SOURCE_RAIL_ITEMS.map((item) => (
        <button
          key={item.value}
          type="button"
          className={`lib-rail__item${!statusRail && sourceFilter === item.value ? ' is-active' : ''}`}
          onClick={() => { setSourceFilter(item.value); setStatusRail(null); onSelect?.(); }}
        >
          <span className="lib-rail__item-text">{item.label}</span>
          <span className="lib-rail__item-count">{railCounts[item.value]}</span>
        </button>
      ))}
      <p className="lib-rail__label">Status</p>
      {STATUS_RAIL_ITEMS.map((item) => (
        <button
          key={item.value}
          type="button"
          className={`lib-rail__item${statusRail === item.value ? ' is-active' : ''}`}
          onClick={() => { setStatusRail(item.value); onSelect?.(); }}
        >
          <span className="lib-rail__item-text">{item.label}</span>
          <span className="lib-rail__item-count">{railCounts[item.value]}</span>
        </button>
      ))}
      {/* Phase 4 QA fix (DECISIONS_LOG.md, QA item 4 — "no live UI path to
          Trash/restore"). Deliberately NOT another STATUS_RAIL_ITEMS entry:
          Unused/Archived are client-side filters over the already-loaded
          `assets` array (which never contains trashed rows — fetchLibraryData
          always calls fetchPersonalAssets() without includeTrashed), so
          reusing that exact mechanism would require either fetching trashed
          rows into the same array (risking them leaking into the main
          grid/counts) or a parallel filteredAssets branch. A separate modal,
          opened from this same rail (matching the mockup's own toast copy —
          "Recoverable for 30 days from the Trash section of the left rail,"
          mockups/mockup-gallery.html:1017 — the strongest available signal
          for where this should live), keeps the fix additive and isolated. */}
      <button
        type="button"
        className="lib-rail__item"
        onClick={() => { onSelect?.(); openTrash(); }}
      >
        <span className="lib-rail__item-text">Trash</span>
      </button>
    </>
  );

  const isEmptyLibrary = !loading && assets.length === 0;

  return (
    <div className="dashboard-shell">
      <Toaster position="top-center" />
      <UserNavbar />
      <UserSidebar />

      <main className="library-shell">
        <UiPageHeader
          className="library-topbar"
          title="Library"
          description="Every upload, generation, and post-linked asset in one place."
          actions={(
            <div className="library-topbar-actions">
              <UiButton type="button" variant={bulkMode ? 'primary' : 'secondary'} onClick={toggleBulkMode}>
                {bulkMode ? 'Done selecting' : 'Select'}
              </UiButton>
              <UiButton type="button" variant="secondary" onClick={() => fetchLibraryData({ force: true })} title="Refresh library">
                <RefreshCw size={14} />
                Refresh
              </UiButton>
              <UiButton type="button" variant="primary" onClick={() => setShowUploadModal(true)}>
                <Upload size={14} />
                Upload
              </UiButton>
              <div className="library-view-toggle">
                <UiIconButton type="button" className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')} ariaLabel="Grid view">
                  <Grid3X3 size={14} />
                </UiIconButton>
                <UiIconButton type="button" className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')} ariaLabel="Table view">
                  <List size={14} />
                </UiIconButton>
              </div>
            </div>
          )}
        />

        <div className="library-filters">
          <button
            type="button"
            className="lib-mobile-rail-toggle"
            onClick={() => setMobileRailOpen(true)}
            aria-haspopup="dialog"
          >
            <span className="lib-mobile-rail-toggle__icon"><Filter size={14} /></span>
            <span className="lib-mobile-rail-toggle__label">
              {activeStatusLabel} <span className="lib-mobile-rail-toggle__count">{activeRailCount}</span>
            </span>
          </button>

          <label className="library-search">
            <Search size={14} />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search title, description, tags…"
            />
          </label>

          <div className="library-filter">
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Filter by type">
              <option value="all">All types</option>
              <option value="image">Image</option>
              <option value="video">Video</option>
              <option value="document">Document</option>
            </select>
          </div>

          <button
            type="button"
            className={`lib-filter-chip${unusedChipActive ? ' is-active' : ''}`}
            onClick={() => setUnusedChipActive((v) => !v)}
          >
            <span className="lib-filter-chip__icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><path d="M8 12h8" /></svg></span>
            Unused only
          </button>

          {availableTags.length > 0 ? (
            <div className="library-filter">
              <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} aria-label="Filter by tag">
                <option value="all">All tags</option>
                {availableTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
              </select>
            </div>
          ) : null}

          <label className="library-filter library-filter-remember">
            <input type="checkbox" checked={rememberFilters} onChange={(event) => setRememberFilters(event.target.checked)} />
            Keep filters
          </label>

          <button type="button" className="btn-secondary btn-sm" onClick={resetFilters}>
            Reset Filters
          </button>
        </div>

        <div className="library-layout">
          <aside className="library-left-rail">
            {railContent()}
          </aside>

          <section className="library-content">
            {loading ? (
              <div className="library-grid">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="library-card">
                    <div className="library-card-media" />
                  </div>
                ))}
              </div>
            ) : isEmptyLibrary ? (
              <UiEmptyState
                className="library-empty-state"
                icon={<FileImage size={28} />}
                title="Nothing in your Library yet"
                description="Upload your first asset — logos, brand photography, anything you'll want to post later."
                actions={(
                  <>
                    <UiButton type="button" variant="primary" onClick={() => setShowUploadModal(true)}>
                      Upload your first asset
                    </UiButton>
                    <UiButton as="a" variant="ghost" href="/app/generate">
                      or generate something in AI Studio
                    </UiButton>
                  </>
                )}
              />
            ) : filteredAssets.length === 0 ? (
              <UiEmptyState
                className="library-empty-state"
                icon={<FileImage size={28} />}
                title="No assets found"
                description="Try changing filters or upload new content."
              />
            ) : viewMode === 'grid' ? (
              <div className="library-grid lib-grid">
                {filteredAssets.map((asset) => (
                  <LibraryCard
                    key={asset.id}
                    asset={asset}
                    selectable={bulkMode}
                    isSelected={selectedIds.has(asset.id)}
                    onToggleSelect={toggleItemSelected}
                    onOpenDrawer={openDrawer}
                    onSchedule={handleSchedule}
                    secondaryActions={[
                      { key: 'archive', label: 'Archive', onSelect: () => handleArchive(asset) },
                      { key: 'delete', label: 'Delete', danger: true, onSelect: () => setDeleteTarget(asset) },
                    ]}
                  />
                ))}
              </div>
            ) : (
              <div className="lib-table-wrap">
                <table className="lib-table">
                  <thead>
                    <tr>
                      <th className="lib-table-checkbox-cell"><input type="checkbox" aria-label="Select all" /></th>
                      <th>Name</th>
                      <th>Source</th>
                      <th>Type</th>
                      <th>Size</th>
                      <th>Used in</th>
                      <th>Added</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAssets.map((asset) => (
                      <tr key={asset.id}>
                        <td className="lib-table-checkbox-cell">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(asset.id)}
                            onChange={() => toggleItemSelected(asset)}
                            aria-label={`Select ${getItemTitle(asset)}`}
                          />
                        </td>
                        <td>
                          <div className="library-table-item" style={{ gridTemplateColumns: '40px minmax(0,1fr)' }}>
                            <LibraryTableThumb asset={asset} />
                            <span>
                              <strong>{getItemTitle(asset)}</strong>
                              <small>{(asset.tags || []).join(', ') || (asset.ai_tags || []).join(', ')}</small>
                            </span>
                          </div>
                        </td>
                        <td><span className={`asset-card__source-badge source-${asset.source}`} style={{ position: 'static' }}>{getSourceLabel(asset)}</span></td>
                        <td>{getFormatLabel(asset)}</td>
                        <td>{getMetaLeftLabel(asset).split('·')[1]?.trim() || ''}</td>
                        <td><span className="ui-field-hint">{getMetaRightLabel(asset)}</span></td>
                        <td>{formatDate(asset.created_at)}</td>
                        <td>
                          <div className="library-table-actions">
                            <button type="button" className="btn-secondary btn-sm" onClick={() => openDrawer(asset)}>View</button>
                            <button type="button" className="btn-secondary btn-sm" onClick={() => handleSchedule(asset)}>
                              <Calendar size={14} aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <LibraryBulkActionBar
            count={selectedAssets.length}
            busy={bulkBusy}
            onArchive={handleBulkArchive}
            onDelete={handleBulkDelete}
            onClear={clearSelection}
          />
        </div>
      </main>

      <UiBottomSheet open={mobileRailOpen} onClose={() => setMobileRailOpen(false)} title="Filter Library">
        {railContent(() => setMobileRailOpen(false))}
      </UiBottomSheet>

      <AssetUploadModal
        open={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onUploadOne={handleUploadOne}
        onMarkAsVersion={handleMarkAsVersion}
      />

      <AssetDetailDrawer
        asset={drawerAsset}
        open={Boolean(drawerAsset)}
        onClose={() => setDrawerAsset(null)}
        onSaveMetadata={handleSaveMetadata}
        onSchedule={handleSchedule}
        onDelete={(asset) => setDeleteTarget(asset)}
        onDuplicate={() => toast('Duplicate is coming soon')}
        usedInPosts={drawerUsedIn}
        versionChain={versionChain}
        onOpenVersion={handleOpenVersion}
        onNavigateToPost={handleNavigateToPost}
      />

      <SoftDeleteConfirmModal
        asset={deleteTarget}
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        busy={deleteBusy}
      />

      <TrashModal
        open={showTrashModal}
        onClose={() => setShowTrashModal(false)}
        trashedAssets={trashedAssets}
        loading={trashLoading}
        onRestore={handleRestore}
      />
    </div>
  );
}
