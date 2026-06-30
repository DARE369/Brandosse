import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Upload, X } from 'lucide-react';
import { UiDrawer } from '../../components/Shared/ui';
import useOrgContext from '../hooks/useOrgContext';
import { fetchOrgAssetFolders, uploadOrgAsset } from '../services/assetLibraryService';
import { DEFAULT_FOLDER_PATH, formatFolderBreadcrumb } from '../utils/assetFolders';

export default function OrgAssetUploadModal({
  open = false,
  onClose,
  onUploaded,
  embedded = false,
  folders: providedFolders = null,
  defaultFolderId = '',
}) {
  const {
    organizationId,
    brandProjectId,
    activeBrandProject,
    hasPermission,
  } = useOrgContext();

  const canManageLibrary = hasPermission('can_manage_library');
  const canApproveUploads = hasPermission('can_approve_library_uploads') || canManageLibrary;

  const [file, setFile] = useState(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [folders, setFolders] = useState(Array.isArray(providedFolders) ? providedFolders : []);
  const [folderId, setFolderId] = useState(defaultFolderId || '');
  const [isBrandAsset, setIsBrandAsset] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open) return;

    if (Array.isArray(providedFolders)) {
      setFolders(providedFolders);
      return;
    }

    let cancelled = false;
    const loadFolders = async () => {
      const data = await fetchOrgAssetFolders({
        organizationId,
        brandProjectId,
      });

      if (!cancelled) {
        setFolders(data);
      }
    };

    void loadFolders();
    return () => {
      cancelled = true;
    };
  }, [brandProjectId, open, organizationId, providedFolders]);

  useEffect(() => {
    if (!open) return;
    setFolderId(defaultFolderId || '');
  }, [defaultFolderId, open]);

  const folderOptions = useMemo(() => {
    const source = Array.isArray(providedFolders) ? providedFolders : folders;
    return source;
  }, [folders, providedFolders]);

  const selectedFolder = useMemo(
    () => folderOptions.find((folder) => folder.id === folderId) || null,
    [folderId, folderOptions],
  );

  const fileLabel = useMemo(() => {
    if (!file) return 'No file selected';
    return `${file.name} | ${(file.size / (1024 * 1024)).toFixed(1)}MB`;
  }, [file]);

  if (!open) return null;

  const reset = () => {
    setFile(null);
    setName('');
    setDescription('');
    setTags('');
    setFolderId(defaultFolderId || '');
    setIsBrandAsset(false);
    setUploading(false);
  };

  const handleClose = () => {
    if (uploading) return;
    reset();
    onClose?.();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!file) {
      toast.error('Choose a file first.');
      return;
    }

    setUploading(true);
    try {
      const asset = await uploadOrgAsset({
        organizationId,
        brandProjectId,
        file,
        name: name.trim() || file.name,
        description,
        tags: tags.split(',').map((entry) => entry.trim()).filter(Boolean),
        folderId: selectedFolder?.id || null,
        folderPath: selectedFolder?.folder_path || DEFAULT_FOLDER_PATH,
        isBrandAsset,
      });

      toast.success(canApproveUploads ? 'Asset uploaded.' : 'Asset uploaded for approval.');
      await onUploaded?.(asset);
      setUploading(false);
      handleClose();
    } catch (error) {
      toast.error(error?.message || 'Could not upload this asset.');
      setUploading(false);
    }
  };

  const drawerTitle = 'Upload to Shared Library';
  const drawerDescription = activeBrandProject?.name
    ? `Save into ${activeBrandProject.name}.`
    : 'Add a reusable asset to this org library.';

  const renderContent = (includeHeader = true) => (
    <>
      {includeHeader ? (
        <div className="org-drawer-header">
          <div>
            <h3>{drawerTitle}</h3>
            <p>{drawerDescription}</p>
          </div>
          <button type="button" className="org-text-button" onClick={handleClose}>
            <X size={14} />
            Close
          </button>
        </div>
      ) : null}

      <form className="org-form org-asset-upload-form" onSubmit={handleSubmit}>
        <label className="org-upload-dropzone">
          <input
            type="file"
            onChange={(event) => {
              const nextFile = event.target.files?.[0] || null;
              setFile(nextFile);
              if (nextFile && !name.trim()) {
                setName(nextFile.name);
              }
            }}
          />
          <Upload size={18} />
          <strong>Choose a file</strong>
          <span>{fileLabel}</span>
        </label>

        <label>
          <span>Name</span>
          <input type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder="Asset name" />
        </label>

        <label>
          <span>Description</span>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="What should the team know about this asset?" />
        </label>

        <label>
          <span>Tags</span>
          <input type="text" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="campaign, product, launch" />
        </label>

        <label>
          <span>Folder</span>
          <select value={folderId} onChange={(event) => setFolderId(event.target.value)}>
            <option value="">Root</option>
            {folderOptions.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {formatFolderBreadcrumb(folder.folder_path)}
              </option>
            ))}
          </select>
        </label>

        <div className="org-upload-folder-note">
          <strong>Destination</strong>
          <span>{selectedFolder ? formatFolderBreadcrumb(selectedFolder.folder_path) : 'Root'}</span>
        </div>

        <label className="org-checkbox-row">
          <input
            type="checkbox"
            checked={isBrandAsset}
            onChange={(event) => setIsBrandAsset(event.target.checked)}
            disabled={!canManageLibrary}
          />
          <span>Mark as a brand asset</span>
        </label>

        <div className="org-drawer-footer">
          <button type="button" className="org-text-button" onClick={handleClose}>
            Cancel
          </button>
          <button type="submit" className="org-primary-button" disabled={uploading || !canManageLibrary}>
            {uploading ? 'Uploading...' : 'Upload Asset'}
          </button>
        </div>
      </form>
    </>
  );

  if (embedded) {
    return (
      <section className="org-asset-upload-embedded">
        {renderContent(true)}
      </section>
    );
  }

  return (
    <UiDrawer
      open={open}
      onClose={handleClose}
      title={drawerTitle}
      description={drawerDescription}
      className="org-drawer-panel org-asset-upload-panel"
    >
      {renderContent(false)}
    </UiDrawer>
  );
}
