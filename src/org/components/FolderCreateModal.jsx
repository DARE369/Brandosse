import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import FolderTree from './FolderTree';
import {
  FOLDER_COLOR_SWATCHES,
  buildFolderLookup,
  formatFolderBreadcrumb,
} from '../utils/assetFolders';

export default function FolderCreateModal({
  open = false,
  folders = [],
  initialParentFolderId = '',
  onClose,
  onCreate,
}) {
  const folderLookup = useMemo(() => buildFolderLookup(folders), [folders]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('team');
  const [color, setColor] = useState(FOLDER_COLOR_SWATCHES[0]);
  const [parentFolderId, setParentFolderId] = useState(initialParentFolderId || '');
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setDescription('');
    setVisibility('team');
    setColor(FOLDER_COLOR_SWATCHES[0]);
    setParentFolderId(initialParentFolderId || '');
    setLocationPickerOpen(false);
    setSaving(false);
  }, [initialParentFolderId, open]);

  if (!open) return null;

  const parentFolder = parentFolderId ? folderLookup.get(parentFolderId) || null : null;
  const locationLabel = parentFolder ? formatFolderBreadcrumb(parentFolder.folder_path) : 'Root';

  const handleCreate = async (event) => {
    event.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    try {
      await onCreate?.({
        name,
        description,
        visibility,
        color,
        parentFolderId: parentFolderId || null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button type="button" className="org-modal-backdrop" onClick={() => !saving && onClose?.()} aria-label="Close folder modal" />
      <section className="org-modal-card org-folder-modal" role="dialog" aria-modal="true" aria-label="Create folder">
        <div className="org-modal-header">
          <div>
            <span className="org-modal-kicker">Folder</span>
            <h3>Create Folder</h3>
          </div>
          <button type="button" className="org-close-button" onClick={() => !saving && onClose?.()} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <form className="org-form org-folder-form" onSubmit={handleCreate}>
          <label>
            <span>Folder Name</span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Q2 Campaign Assets"
              autoFocus
            />
          </label>

          <label>
            <span>Description</span>
            <textarea
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional context for the team"
            />
          </label>

          <div className="org-folder-field">
            <span>Location</span>
            <div className="org-folder-location-card">
              <strong>{locationLabel}</strong>
              <button type="button" className="org-text-button" onClick={() => setLocationPickerOpen((current) => !current)}>
                {locationPickerOpen ? 'Done' : 'Change'}
              </button>
            </div>

            {locationPickerOpen ? (
              <div className="org-folder-location-picker">
                <FolderTree
                  folders={folders}
                  selectedFolderId={parentFolderId}
                  canManageLibrary={false}
                  allFoldersLabel="Root"
                  onSelectFolder={(folder) => setParentFolderId(folder?.id || '')}
                />
              </div>
            ) : null}
          </div>

          <div className="org-folder-field">
            <span>Color</span>
            <div className="org-folder-color-grid">
              {FOLDER_COLOR_SWATCHES.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  className={`org-folder-color-swatch ${color === swatch ? 'active' : ''}`}
                  style={{ background: swatch }}
                  onClick={() => setColor(swatch)}
                  aria-label={`Choose ${swatch}`}
                />
              ))}
            </div>
          </div>

          <div className="org-folder-field">
            <span>Visibility</span>
            <div className="org-folder-visibility-toggle">
              <button
                type="button"
                className={visibility === 'team' ? 'active' : ''}
                onClick={() => setVisibility('team')}
              >
                Team (visible to all)
              </button>
              <button
                type="button"
                className={visibility === 'private' ? 'active' : ''}
                onClick={() => setVisibility('private')}
              >
                Private (only me)
              </button>
            </div>
          </div>

          <div className="org-modal-actions">
            <button type="button" className="org-text-button" onClick={() => !saving && onClose?.()}>
              Cancel
            </button>
            <button type="submit" className="org-primary-button" disabled={saving || !name.trim()}>
              {saving ? 'Creating...' : 'Create Folder'}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
