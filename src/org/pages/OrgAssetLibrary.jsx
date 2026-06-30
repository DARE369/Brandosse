"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { useAppNavigation } from '../../Context/AppNavigationContext';
import { useMutableSearchParams } from '../../next/useMutableSearchParams';
import { Archive, CheckCircle2, Download, FileText, Folder, FolderInput, Search, ShieldAlert, Star, Tag, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../Context/AuthContext';
import FolderCreateModal from '../components/FolderCreateModal';
import FolderTree from '../components/FolderTree';
import MoveAssetModal from '../components/MoveAssetModal';
import OrgAssetUploadModal from '../components/OrgAssetUploadModal';
import OrgEmptyState from '../components/OrgEmptyState';
import OrgScheduleModal from '../components/calendar/OrgScheduleModal';
import BrandProjectSelector from '../components/BrandProjectSelector';
import useOrgAssets from '../hooks/useOrgAssets';
import useOrgContext from '../hooks/useOrgContext';
import { createOrgAssetFolder, deleteOrgAssetFolder, updateOrgAsset, updateOrgAssetFolder } from '../services/assetLibraryService';
import { buildDeepLink } from '../../utils/buildDeepLink';
import { buildFolderLookup, formatFolderBreadcrumb, getAssetFolderPath, getFolderBreadcrumbs } from '../utils/assetFolders';
const COLLECTIONS = [
  { id: 'all', label: 'All Assets', icon: Folder },
  { id: 'recent', label: 'Recently Added', icon: Search },
  { id: 'mine', label: 'My Uploads', icon: Upload },
  { id: 'brand', label: 'Brand Assets', icon: Star },
  { id: 'pending', label: 'Pending Approval', icon: CheckCircle2 },
  { id: 'archived', label: 'Archived', icon: Archive },
];

const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown');
const formatLabel = (value, fallback = 'Unknown') => String(value || '').trim()
  ? String(value).trim().split(/[_\s-]+/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(' ')
  : fallback;
const safeTags = (value) => (Array.isArray(value) ? value.map((entry) => String(entry || '').trim()).filter(Boolean) : []);
const normalizeTagInput = (value) => String(value || '').split(',').map((entry) => entry.trim()).filter(Boolean);
const buildMetadataDraft = (asset) => ({ name: String(asset?.name || ''), description: String(asset?.description || ''), tags: safeTags(asset?.tags).join(', '), folderId: String(asset?.folder_id || '') });
const getPreviewSource = (asset) => asset?.thumbnail_url || asset?.file_url || '';
const getInitials = (value) => String(value || '').trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('') || 'AS';

function AssetPreview({ asset, detail = false }) {
  const source = getPreviewSource(asset);
  const isImage = String(asset?.mime_type || '').startsWith('image/') || asset?.file_type === 'image';
  if (isImage && source) return <img src={source} alt={asset?.name || 'Asset'} />;
  if (detail && asset?.file_url && (String(asset?.mime_type || '').startsWith('video/') || asset?.file_type === 'video')) {
    return <video controls preload="metadata" playsInline><source src={asset.file_url} type={asset.mime_type || undefined} /></video>;
  }
  return <div className={`org-asset-file-fallback ${detail ? 'detail' : ''}`}><span className="org-asset-file-fallback-icon"><FileText size={detail ? 28 : 18} /></span><strong>{formatLabel(asset?.file_type, 'Asset')}</strong><span>{asset?.mime_type || 'Library file'}</span></div>;
}

export default function OrgAssetLibrary() {
  const { navigate } = useAppNavigation();
  const [searchParams] = useMutableSearchParams();
  const { user } = useAuth();
  const { assets, folders, loading, refresh } = useOrgAssets({ includeArchived: true });
  const { organizationId, organization, brandProjects, activeBrandProject, setActiveBrandProjectId, hasPermission, isAgency } = useOrgContext();
  const [collection, setCollection] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState('');
  const [expandedFolderIds, setExpandedFolderIds] = useState([]);
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [density, setDensity] = useState('default');
  const [busyAction, setBusyAction] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [moveAssetOpen, setMoveAssetOpen] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [folderCreateParentId, setFolderCreateParentId] = useState('');
  const [metadataDraft, setMetadataDraft] = useState(() => buildMetadataDraft(null));
  const [colorPickerId, setColorPickerId] = useState('');
  const canManageLibrary = hasPermission('can_manage_library');
  const canApproveAssets = hasPermission('can_approve_library_uploads') || canManageLibrary;
  const folderLookup = useMemo(() => buildFolderLookup(folders), [folders]);
  const selectedFolder = selectedFolderId ? folderLookup.get(selectedFolderId) || null : null;
  const selectedFolderBreadcrumbs = useMemo(() => getFolderBreadcrumbs(selectedFolder, folderLookup), [folderLookup, selectedFolder]);
  const assetCountsByFolderId = useMemo(() => assets.reduce((map, asset) => {
    if (!asset.is_archived && asset.folder_id) map.set(asset.folder_id, (map.get(asset.folder_id) || 0) + 1);
    return map;
  }, new Map()), [assets]);
  const childCountsByFolderId = useMemo(() => folders.reduce((map, folder) => {
    if (folder.parent_folder_id) map.set(folder.parent_folder_id, (map.get(folder.parent_folder_id) || 0) + 1);
    return map;
  }, new Map()), [folders]);
  const pageScopeLabel = activeBrandProject?.name ? `${organization?.name || 'Org'} / ${activeBrandProject.name}` : `${organization?.name || 'Organization'} / Org-wide assets`;

  useEffect(() => {
    const requestedAssetId = String(searchParams.get('assetId') || '').trim();
    const requestedSearch = String(searchParams.get('search') || '').trim();
    if (requestedAssetId || requestedSearch) {
      setCollection('all');
      setSelectedFolderId('');
    }
    if (requestedAssetId) {
      setSelectedAssetId(requestedAssetId);
    }
    if (requestedSearch) {
      setSearch(requestedSearch);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!selectedFolder) return;
    setExpandedFolderIds((current) => [...new Set([...current, ...getFolderBreadcrumbs(selectedFolder, folderLookup).map((folder) => folder.id).slice(0, -1)])]);
  }, [folderLookup, selectedFolder]);

  const visibleAssets = useMemo(() => {
    const query = search.trim().toLowerCase();
    const recentCutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
    return assets.filter((asset) => {
      if (selectedFolderId && asset.folder_id !== selectedFolderId) return false;
      const matchesSearch = !query || [asset.name, asset.description, asset.file_type, asset.mime_type, asset.origin?.pipeline_title, asset.origin?.task_title, getAssetFolderPath(asset, folderLookup), ...safeTags(asset.tags)].some((value) => String(value || '').toLowerCase().includes(query));
      if (!matchesSearch) return false;
      if (collection === 'recent') return asset.created_at && new Date(asset.created_at).getTime() >= recentCutoff && !asset.is_archived;
      if (collection === 'mine') return user?.id ? asset.uploaded_by === user.id : false;
      if (collection === 'brand') return Boolean(asset.is_brand_asset) && !asset.is_archived;
      if (collection === 'pending') return asset.approval_status === 'pending' && !asset.is_archived;
      if (collection === 'archived') return Boolean(asset.is_archived);
      return !asset.is_archived;
    });
  }, [assets, collection, folderLookup, search, selectedFolderId, user?.id]);

  useEffect(() => {
    setSelectedAssetId((current) => (visibleAssets.some((asset) => asset.id === current) ? current : (visibleAssets[0]?.id || '')));
  }, [visibleAssets]);

  const selectedAsset = useMemo(() => assets.find((asset) => asset.id === selectedAssetId) || null, [assets, selectedAssetId]);
  const selectedAssetScheduleRecord = useMemo(() => {
    if (!selectedAsset) return null;
    return {
      id: `asset:${selectedAsset.id}`,
      postId: selectedAsset.origin?.linked_post_id || null,
      pipelineItemId: selectedAsset.origin?.pipeline_item_id || null,
      title: selectedAsset.name || 'Asset',
      ownerName: selectedAsset.uploader_profile?.full_name || selectedAsset.uploader_profile?.email || 'Team member',
      statusLabel: 'Content',
      tone: 'draft',
      previewText: selectedAsset.description || '',
      mediaPreviewUrl: getPreviewSource(selectedAsset),
      attachedAssets: [selectedAsset],
      rawPost: null,
      rawPipelineItem: null,
    };
  }, [selectedAsset]);
  useEffect(() => setMetadataDraft(buildMetadataDraft(selectedAsset)), [selectedAsset]);
  const selectedAssetFolder = selectedAsset?.folder_id ? folderLookup.get(selectedAsset.folder_id) || null : null;
  const selectedAssetFolderPath = selectedAsset ? getAssetFolderPath(selectedAsset, folderLookup) : '/';
  const selectedAssetFolderBreadcrumbs = useMemo(() => getFolderBreadcrumbs(selectedAssetFolder, folderLookup), [folderLookup, selectedAssetFolder]);
  const metadataDirty = Boolean(selectedAsset) && (
    metadataDraft.name.trim() !== String(selectedAsset?.name || '').trim()
    || metadataDraft.description.trim() !== String(selectedAsset?.description || '').trim()
    || metadataDraft.folderId !== String(selectedAsset?.folder_id || '')
    || normalizeTagInput(metadataDraft.tags).join('|') !== safeTags(selectedAsset?.tags).join('|')
  );

  const updateAsset = async (assetId, key, updates, successMessage) => {
    setBusyAction(`${assetId}:${key}`);
    try {
      await updateOrgAsset(assetId, updates);
      await refresh();
      toast.success(successMessage);
    } catch (error) {
      toast.error(error?.message || 'Could not update this asset.');
    } finally {
      setBusyAction('');
    }
  };

  const saveMetadata = async () => {
    if (!selectedAsset?.id) return;
    const nextFolder = metadataDraft.folderId ? folderLookup.get(metadataDraft.folderId) || null : null;
    await updateAsset(selectedAsset.id, 'metadata', {
      name: metadataDraft.name.trim() || selectedAsset.name || 'Untitled asset',
      description: metadataDraft.description.trim(),
      tags: normalizeTagInput(metadataDraft.tags),
      folder_id: nextFolder?.id || null,
      folder_path: nextFolder?.folder_path || '/',
    }, 'Asset metadata updated.');
  };

  const createFolder = async ({ name, description, visibility, color, parentFolderId }) => {
    try {
      const parentFolder = parentFolderId ? folderLookup.get(parentFolderId) || null : null;
      const nextBrandProjectId = parentFolder
        ? (parentFolder.brand_project_id || null)
        : (isAgency ? (activeBrandProject?.id || null) : null);
      const created = await createOrgAssetFolder({ organizationId, brandProjectId: nextBrandProjectId, name, description, visibility, color, parentFolderId, createdBy: user?.id });
      await refresh();
      setCreateFolderOpen(false);
      setSelectedFolderId(created?.id || '');
      setFolderCreateParentId('');
      toast.success('Folder created.');
    } catch (error) {
      toast.error(error?.message || 'Could not create this folder.');
    }
  };

  const deleteFolder = async (folder) => {
    if (!folder?.id) return;
    if (folder.is_system) return toast.error('System folders cannot be deleted.');
    if ((assetCountsByFolderId.get(folder.id) || 0) > 0 || (childCountsByFolderId.get(folder.id) || 0) > 0) {
      return toast.error('Move assets and subfolders out of this folder before deleting it.');
    }
    if (!window.confirm(`Delete \"${folder.name}\"?`)) return;
    try {
      await deleteOrgAssetFolder(folder.id);
      if (selectedFolderId === folder.id) setSelectedFolderId('');
      await refresh();
      toast.success('Folder deleted.');
    } catch (error) {
      toast.error(error?.message || 'Could not delete this folder.');
    }
  };

  const selectedAssetBusy = Boolean(selectedAsset?.id) && busyAction.startsWith(`${selectedAsset.id}:`);

  return (
    <section className="org-page org-asset-library-page">
      <div className="org-page-header org-library-page-header">
        <div><h1>Shared Asset Library</h1><p>Review, organize, and reuse the files that support drafts, approvals, calendar work, and brand consistency across the org.</p></div>
        <div className="org-library-page-actions">
          {isAgency ? <BrandProjectSelector projects={brandProjects} activeProject={activeBrandProject} onSelect={setActiveBrandProjectId} /> : null}
          {canManageLibrary ? <button type="button" className="org-primary-button" onClick={() => setUploadOpen(true)}><Upload size={14} />Upload</button> : <div className="org-library-permission-note"><ShieldAlert size={14} />Uploads require library manager access.</div>}
        </div>
      </div>
      <div className="org-library-layout">
        <aside className="org-panel org-library-sidebar">
          <div className="org-library-scope-card"><span className="org-library-kicker">Workspace Scope</span><strong>{pageScopeLabel}</strong><p>{canManageLibrary ? 'You can upload, update, archive, and organize library assets.' : 'You can browse and reference approved assets, but library changes require manager access.'}</p></div>
          <label className="org-library-search"><Search size={14} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search assets, tags, or file types..." /></label>
          <div className="org-library-section"><span className="org-library-section-title">Smart Collections</span><div className="org-library-nav">{COLLECTIONS.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" className={`org-library-nav-item ${collection === item.id ? 'active' : ''}`} onClick={() => setCollection(item.id)}><span><Icon size={14} />{item.label}</span><small>{(() => { const recentCutoff = Date.now() - (7 * 24 * 60 * 60 * 1000); return assets.filter((asset) => { if (item.id === 'recent') return asset.created_at && new Date(asset.created_at).getTime() >= recentCutoff && !asset.is_archived; if (item.id === 'mine') return user?.id ? asset.uploaded_by === user.id : false; if (item.id === 'brand') return Boolean(asset.is_brand_asset) && !asset.is_archived; if (item.id === 'pending') return asset.approval_status === 'pending' && !asset.is_archived; if (item.id === 'archived') return Boolean(asset.is_archived); return !asset.is_archived; }).length; })()}</small></button>; })}</div></div>
          <div className="org-library-section">
            <div className="org-library-section-header"><span className="org-library-section-title">Folders</span>{canManageLibrary ? <button type="button" className="org-text-button" onClick={() => { setFolderCreateParentId(selectedFolderId || ''); setCreateFolderOpen(true); }}>+ New Folder</button> : null}</div>
            <FolderTree folders={folders} selectedFolderId={selectedFolderId} expandedFolderIds={expandedFolderIds} assetCountsByFolderId={assetCountsByFolderId} canManageLibrary={canManageLibrary} colorPickerId={colorPickerId} onSelectFolder={(folder) => { setSelectedFolderId(folder?.id || ''); setColorPickerId(''); }} onToggleFolder={(folderId) => setExpandedFolderIds((current) => current.includes(folderId) ? current.filter((id) => id !== folderId) : [...current, folderId])} onOpenCreateFolder={(folder) => { setFolderCreateParentId(folder?.id || ''); setCreateFolderOpen(true); }} onOpenDeleteFolder={(folder) => void deleteFolder(folder)} onChangeFolderColor={(folder, color, openOnly) => openOnly ? setColorPickerId((current) => current === folder.id ? '' : folder.id) : updateOrgAssetFolder(folder.id, { color }).then(refresh).then(() => setColorPickerId('')).catch((error) => toast.error(error?.message || 'Could not update folder color.'))} onToggleFolderVisibility={(folder) => updateOrgAssetFolder(folder.id, { visibility: folder.visibility === 'private' ? 'team' : 'private' }).then(refresh).then(() => toast.success(folder.visibility === 'private' ? 'Folder shared with the team.' : 'Folder marked private.')).catch((error) => toast.error(error?.message || 'Could not update folder visibility.'))} />
          </div>
        </aside>
        <div className="org-panel org-library-content">
          <div className="org-library-toolbar"><div className="org-library-toolbar-copy"><strong>{visibleAssets.length} assets</strong><span>{selectedFolder ? formatFolderBreadcrumb(selectedFolder.folder_path) : (collection === 'all' ? 'Visible to this workspace' : formatLabel(collection))}</span></div><div className="org-library-density">{['compact', 'default', 'large'].map((value) => <button key={value} type="button" className={density === value ? 'active' : ''} onClick={() => setDensity(value)}>{value}</button>)}</div></div>
          <div className={`org-library-breadcrumb ${selectedFolderBreadcrumbs.length ? '' : 'root'}`}>{selectedFolderBreadcrumbs.length ? selectedFolderBreadcrumbs.map((folder, index) => <React.Fragment key={folder.id}>{index > 0 ? <span>/</span> : null}<button type="button" onClick={() => setSelectedFolderId(folder.id)}>{folder.name}</button></React.Fragment>) : <span>Root</span>}</div>
          {loading ? (
            <div className="org-panel-loading">Loading assets...</div>
          ) : visibleAssets.length === 0 ? (
            <OrgEmptyState
              eyebrow="Library"
              title="No assets match this view"
              description={canManageLibrary
                ? 'Try another collection, another folder, or upload the next asset for this workspace.'
                : 'Try another collection or ask a library manager to add the needed file.'}
            />
          ) : (
            <div className={`org-asset-grid density-${density}`}>
              {visibleAssets.map((asset) => {
                const folderPath = getAssetFolderPath(asset, folderLookup);
                const tone = asset.is_archived
                  ? 'archived'
                  : (asset.approval_status === 'pending'
                    ? 'pending'
                    : (asset.approval_status === 'rejected' ? 'rejected' : 'approved'));

                const handleSelectAsset = () => setSelectedAssetId(asset.id);
                const handleSelectAssetKeyDown = (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleSelectAsset();
                  }
                };

                return (
                  <article
                    key={asset.id}
                    role="button"
                    tabIndex={0}
                    className={`org-asset-card ${selectedAssetId === asset.id ? 'active' : ''}`}
                    onClick={handleSelectAsset}
                    onKeyDown={handleSelectAssetKeyDown}
                  >
                    <div className="org-asset-preview">
                      <AssetPreview asset={asset} />
                      <div className="org-asset-badges">
                        <span className="org-asset-type-chip">{formatLabel(asset.file_type, 'File')}</span>
                        {asset.is_brand_asset ? <span className="org-asset-brand-chip">Brand</span> : null}
                      </div>
                      {canManageLibrary ? (
                        <button
                          type="button"
                          className="org-asset-card-action"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedAssetId(asset.id);
                            setMoveAssetOpen(true);
                          }}
                        >
                          <FolderInput size={13} />
                          Move
                        </button>
                      ) : null}
                    </div>
                    <div className="org-asset-body">
                      <strong>{asset.name || 'Untitled asset'}</strong>
                      <div className="org-asset-meta-line">
                        <span>{formatFolderBreadcrumb(folderPath)}</span>
                        <span>{formatLabel(asset.approval_status, 'Approved')}</span>
                      </div>
                      <div className="org-asset-meta-line">
                        <span>{formatDate(asset.created_at)}</span>
                        <span className={`org-asset-status-dot ${tone}`} />
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
        <aside className="org-panel org-library-detail">
          {selectedAsset ? (
            <>
              <div className="org-panel-header org-library-detail-header"><div><h3>{selectedAsset.name || 'Untitled asset'}</h3><p>{formatLabel(selectedAsset.file_type, 'File')} / added {formatDate(selectedAsset.created_at)}</p></div><span className={`org-library-status-chip ${selectedAsset.is_archived ? 'archived' : (selectedAsset.approval_status === 'pending' ? 'pending' : (selectedAsset.approval_status === 'rejected' ? 'rejected' : 'approved'))}`}>{selectedAsset.is_archived ? 'Archived' : formatLabel(selectedAsset.approval_status, 'Approved')}</span></div>
              <div className="org-library-detail-preview"><AssetPreview asset={selectedAsset} detail /></div>
              <div className="org-library-detail-stat-grid"><div><span>Type</span><strong>{formatLabel(selectedAsset.file_type, 'File')}</strong></div><div><span>Size</span><strong>{Number(selectedAsset.file_size_bytes || 0) ? `${(Number(selectedAsset.file_size_bytes || 0) / (1024 * 1024)).toFixed(1)} MB` : 'Unknown size'}</strong></div><div><span>Version</span><strong>v{selectedAsset.current_version || 1}</strong></div><div><span>Usage</span><strong>{selectedAsset.usage_count || 0} linked items</strong></div></div>
              <div className="org-library-detail-section">
                <div className="org-library-detail-section-header"><strong>Metadata</strong><span>{canManageLibrary ? (metadataDirty ? 'Unsaved changes' : 'Saved') : 'Read only'}</span></div>
                <label className="org-library-field"><span>Name</span><input type="text" value={metadataDraft.name} onChange={(event) => setMetadataDraft((current) => ({ ...current, name: event.target.value }))} disabled={!canManageLibrary || selectedAssetBusy} /></label>
                <label className="org-library-field"><span>Description</span><textarea rows={4} value={metadataDraft.description} onChange={(event) => setMetadataDraft((current) => ({ ...current, description: event.target.value }))} disabled={!canManageLibrary || selectedAssetBusy} placeholder="Add context for the team." /></label>
                <label className="org-library-field"><span>Tags</span><input type="text" value={metadataDraft.tags} onChange={(event) => setMetadataDraft((current) => ({ ...current, tags: event.target.value }))} disabled={!canManageLibrary || selectedAssetBusy} placeholder="campaign, launch, product" /></label>
                <label className="org-library-field"><span>Folder</span><select value={metadataDraft.folderId} onChange={(event) => setMetadataDraft((current) => ({ ...current, folderId: event.target.value }))} disabled={!canManageLibrary || selectedAssetBusy}><option value="">Root</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{formatFolderBreadcrumb(folder.folder_path)}</option>)}</select></label>
                <div className="org-library-meta-actions"><button type="button" className="org-primary-button" onClick={() => void saveMetadata()} disabled={!canManageLibrary || !metadataDirty || selectedAssetBusy}>{busyAction === `${selectedAsset.id}:metadata` ? 'Saving...' : 'Save Metadata'}</button><button type="button" className="org-text-button" onClick={() => setMetadataDraft(buildMetadataDraft(selectedAsset))} disabled={!canManageLibrary || !metadataDirty || selectedAssetBusy}>Cancel</button></div>
              </div>
              <div className="org-library-detail-section"><div className="org-library-detail-section-header"><strong>Origin</strong><span>Traceability and provenance</span></div><div className="org-library-origin-card"><div className="org-library-origin-user">{selectedAsset.uploader_profile?.avatar_url ? <img src={selectedAsset.uploader_profile.avatar_url} alt={selectedAsset.uploader_profile?.full_name || 'Member'} /> : <span>{getInitials(selectedAsset.uploader_profile?.full_name || selectedAsset.uploader_profile?.email || selectedAsset.uploaded_by)}</span>}<div><strong>{selectedAsset.uploader_profile?.full_name || selectedAsset.uploader_profile?.email || selectedAsset.uploaded_by || 'Unknown member'}</strong><small>Uploaded {formatDate(selectedAsset.created_at)}</small></div></div><div className="org-library-origin-row"><span>Folder Path</span><div className="org-library-origin-breadcrumb">{selectedAssetFolderBreadcrumbs.length ? selectedAssetFolderBreadcrumbs.map((folder, index) => <React.Fragment key={folder.id}>{index > 0 ? <span>/</span> : null}<button type="button" onClick={() => setSelectedFolderId(folder.id)}>{folder.name}</button></React.Fragment>) : <button type="button" onClick={() => setSelectedFolderId('')}>Root</button>}</div></div><div className="org-library-origin-links">{selectedAsset.origin?.pipeline_item_id ? <button type="button" className="org-library-origin-badge" onClick={() => { const target = buildDeepLink({ path: `/app/org/${organizationId}/pipeline`, source: 'org_asset_library', target: 'org_pipeline_item', params: { pipelineItemId: selectedAsset.origin.pipeline_item_id } }); navigate(target.path, { state: target.state }); }}><Tag size={12} />Via Pipeline {String(selectedAsset.origin.pipeline_item_id).slice(0, 8).toUpperCase()}</button> : null}{selectedAsset.origin?.task_title ? <button type="button" className="org-library-origin-badge" onClick={() => navigate(`/app/org/${organizationId}/calendar?taskId=${selectedAsset.origin.task_id}`)}><Tag size={12} />Task: {selectedAsset.origin.task_title}</button> : null}{!selectedAsset.origin?.pipeline_item_id && !selectedAsset.origin?.task_title ? <span className="org-library-origin-empty">No pipeline or task linkage has been recorded yet.</span> : null}</div></div></div>
              <div className="org-library-detail-section"><div className="org-library-detail-section-header"><strong>Actions</strong><span>{canManageLibrary ? 'Library manager controls' : 'Reference and review only'}</span></div><div className="org-library-detail-actions">{canApproveAssets && selectedAsset.approval_status === 'pending' ? <><button type="button" className="org-primary-button" disabled={selectedAssetBusy} onClick={() => updateAsset(selectedAsset.id, 'approve', { approval_status: 'approved', approved_by: user?.id || null, approved_at: new Date().toISOString() }, 'Asset approved.')}>{busyAction === `${selectedAsset.id}:approve` ? 'Approving...' : 'Approve'}</button><button type="button" className="org-text-button danger" disabled={selectedAssetBusy} onClick={() => updateAsset(selectedAsset.id, 'reject', { approval_status: 'rejected', approved_by: null, approved_at: null }, 'Asset rejected.')}>{busyAction === `${selectedAsset.id}:reject` ? 'Rejecting...' : 'Reject'}</button></> : null}<button type="button" className="org-text-button" onClick={() => { const link = document.createElement('a'); link.href = selectedAsset.file_url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.download = selectedAsset.name || 'asset'; document.body.appendChild(link); link.click(); document.body.removeChild(link); }}><Download size={14} />Download</button>{selectedAsset.origin?.linked_post_id || selectedAsset.origin?.pipeline_item_id ? <button type="button" className="org-text-button" onClick={() => setScheduleModalOpen(true)}><Tag size={14} />Open Schedule</button> : null}{canManageLibrary ? <button type="button" className="org-text-button" disabled={selectedAssetBusy} onClick={() => setMoveAssetOpen(true)}><FolderInput size={14} />Move to Folder</button> : null}{canManageLibrary ? <button type="button" className="org-text-button" disabled={selectedAssetBusy} onClick={() => updateAsset(selectedAsset.id, 'brand-flag', { is_brand_asset: !selectedAsset.is_brand_asset }, selectedAsset.is_brand_asset ? 'Removed from brand assets.' : 'Marked as brand asset.')}><Star size={14} />{selectedAsset.is_brand_asset ? 'Remove Brand Flag' : 'Mark Brand Asset'}</button> : null}{canManageLibrary ? <button type="button" className="org-text-button danger" disabled={selectedAssetBusy} onClick={() => updateAsset(selectedAsset.id, 'archive', { is_archived: !selectedAsset.is_archived }, selectedAsset.is_archived ? 'Asset restored.' : 'Asset archived.')}><Archive size={14} />{selectedAsset.is_archived ? 'Restore Asset' : 'Archive Asset'}</button> : null}</div></div>
            </>
          ) : <OrgEmptyState eyebrow="Asset Details" title="Choose an asset" description="Select any asset card to review its preview, metadata, and available actions." />}
        </aside>
      </div>
      <OrgAssetUploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={refresh} folders={folders} defaultFolderId={selectedFolderId} />
      <FolderCreateModal open={createFolderOpen} folders={folders} initialParentFolderId={folderCreateParentId} onClose={() => { setCreateFolderOpen(false); setFolderCreateParentId(''); }} onCreate={createFolder} />
      <MoveAssetModal open={moveAssetOpen} asset={selectedAsset} folders={folders} currentFolderId={selectedAsset?.folder_id || ''} onClose={() => setMoveAssetOpen(false)} onConfirm={(folder) => updateAsset(selectedAsset.id, 'move', { folder_id: folder?.id || null, folder_path: folder?.folder_path || '/' }, 'Asset moved.').then(() => setMoveAssetOpen(false))} />
      <OrgScheduleModal
        open={scheduleModalOpen}
        record={selectedAssetScheduleRecord}
        postId={selectedAsset?.origin?.linked_post_id || null}
        pipelineItemId={selectedAsset?.origin?.pipeline_item_id || null}
        onClose={() => setScheduleModalOpen(false)}
        onScheduled={() => Promise.resolve()}
        onOpenPipeline={() => {
          const target = buildDeepLink({
            path: `/app/org/${organizationId}/pipeline`,
            source: 'org_asset_library',
            target: 'org_pipeline_item',
            params: selectedAsset?.origin?.pipeline_item_id
              ? { pipelineItemId: selectedAsset.origin.pipeline_item_id }
              : {},
          });
          navigate(target.path, { state: target.state });
        }}
      />
    </section>
  );
}
