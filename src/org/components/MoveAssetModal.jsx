import React, { useMemo, useState } from 'react';
import { FolderInput, X } from 'lucide-react';
import FolderTree from './FolderTree';
import { buildFolderLookup, formatFolderBreadcrumb } from '../utils/assetFolders';

export default function MoveAssetModal({
  open = false,
  asset = null,
  folders = [],
  currentFolderId = '',
  onClose,
  onConfirm,
}) {
  const folderLookup = useMemo(() => buildFolderLookup(folders), [folders]);
  const [selectedFolderId, setSelectedFolderId] = useState(currentFolderId || '');
  const [moving, setMoving] = useState(false);

  React.useEffect(() => {
    if (!open) return;
    setSelectedFolderId(currentFolderId || '');
    setMoving(false);
  }, [currentFolderId, open]);

  if (!open || !asset) return null;

  const selectedFolder = selectedFolderId ? folderLookup.get(selectedFolderId) || null : null;
  const destinationLabel = selectedFolder ? formatFolderBreadcrumb(selectedFolder.folder_path) : 'Root';

  const handleMove = async () => {
    setMoving(true);
    try {
      await onConfirm?.(selectedFolder || null);
    } finally {
      setMoving(false);
    }
  };

  return (
    <>
      <button type="button" className="org-modal-backdrop" onClick={() => !moving && onClose?.()} aria-label="Close move asset modal" />
      <section className="org-modal-card org-folder-modal" role="dialog" aria-modal="true" aria-label="Move asset">
        <div className="org-modal-header">
          <div>
            <span className="org-modal-kicker">Asset Library</span>
            <h3>Move to Folder</h3>
          </div>
          <button type="button" className="org-close-button" onClick={() => !moving && onClose?.()} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="org-folder-move-summary">
          <FolderInput size={16} />
          <div>
            <strong>{asset.name || 'Untitled asset'}</strong>
            <span>{destinationLabel}</span>
          </div>
        </div>

        <div className="org-folder-location-picker">
          <FolderTree
            folders={folders}
            selectedFolderId={selectedFolderId}
            canManageLibrary={false}
            allFoldersLabel="Root"
            onSelectFolder={(folder) => setSelectedFolderId(folder?.id || '')}
          />
        </div>

        <div className="org-modal-actions">
          <button type="button" className="org-text-button" onClick={() => !moving && onClose?.()}>
            Cancel
          </button>
          <button type="button" className="org-primary-button" disabled={moving} onClick={() => void handleMove()}>
            {moving ? 'Moving...' : 'Move'}
          </button>
        </div>
      </section>
    </>
  );
}
