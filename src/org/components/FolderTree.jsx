import React, { useMemo, useState } from 'react';
import {
  Archive,
  Bookmark,
  Briefcase,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Lock,
  Palette,
  Plus,
  Send,
  Trash2,
  Users,
} from 'lucide-react';
import {
  FOLDER_COLOR_SWATCHES,
  buildFolderTree,
  getFolderDepth,
} from '../utils/assetFolders';

const ICON_MAP = {
  Archive,
  Bookmark,
  Briefcase,
  Folder,
  FolderOpen,
  Send,
};

function FolderRowIcon({ folder, open = false }) {
  const Icon = ICON_MAP[folder?.icon] || (open ? FolderOpen : Folder);
  return <Icon size={14} style={{ color: folder?.color || 'currentColor' }} />;
}

function FolderNode({
  folder,
  depth,
  maxDepth,
  expandedIds,
  selectedFolderId,
  assetCountsByFolderId,
  canManageLibrary,
  colorPickerId,
  onSelectFolder,
  onToggleFolder,
  onOpenCreateFolder,
  onOpenDeleteFolder,
  onChangeFolderColor,
  onToggleFolderVisibility,
}) {
  const hasChildren = Array.isArray(folder.children) && folder.children.length > 0;
  const isExpanded = expandedIds.has(folder.id);
  const isSelected = selectedFolderId === folder.id;
  const count = assetCountsByFolderId.get(folder.id) || 0;
  const canRenderChildren = depth < maxDepth - 1;
  const showOverflowCount = hasChildren && !canRenderChildren;
  const rowPaddingLeft = `${12 + (Math.min(getFolderDepth(folder.folder_path), maxDepth - 1) * 16)}px`;

  const handleRowKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelectFolder?.(folder);
    }
  };

  return (
    <div className="org-folder-tree-node">
      <div
        role="button"
        tabIndex={0}
        className={`org-folder-tree-row ${isSelected ? 'active' : ''}`}
        onClick={() => onSelectFolder?.(folder)}
        onKeyDown={handleRowKeyDown}
        style={{ paddingLeft: rowPaddingLeft }}
      >
        {hasChildren && canRenderChildren ? (
          <span
            className="org-folder-tree-toggle"
            onClick={(event) => {
              event.stopPropagation();
              onToggleFolder?.(folder.id);
            }}
          >
            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        ) : (
          <span className="org-folder-tree-toggle placeholder" />
        )}

        <span className="org-folder-tree-icon">
          <FolderRowIcon folder={folder} open={isExpanded} />
        </span>

        <span className="org-folder-tree-copy">
          <strong>{folder.name}</strong>
          <small>{folder.visibility === 'private' ? 'Private' : 'Team'}</small>
        </span>

        <span className="org-folder-tree-badges">
          <span className="org-folder-tree-count">{count}</span>
          {folder.is_system ? <Lock size={12} /> : null}
        </span>

        {canManageLibrary ? (
          <span className="org-folder-tree-actions" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="org-folder-tree-action"
              onClick={() => onOpenCreateFolder?.(folder)}
              aria-label={`Create subfolder inside ${folder.name}`}
            >
              <Plus size={12} />
            </button>
            <button
              type="button"
              className="org-folder-tree-action"
              onClick={() => onToggleFolderVisibility?.(folder)}
              aria-label={folder.visibility === 'private' ? 'Make folder visible to team' : 'Make folder private'}
            >
              {folder.visibility === 'private' ? <Lock size={12} /> : <Users size={12} />}
            </button>
            <button
              type="button"
              className={`org-folder-tree-action ${colorPickerId === folder.id ? 'active' : ''}`}
              onClick={() => onChangeFolderColor?.(folder, null, true)}
              aria-label={`Change color for ${folder.name}`}
            >
              <Palette size={12} />
            </button>
            {!folder.is_system ? (
              <button
                type="button"
                className="org-folder-tree-action danger"
                onClick={() => onOpenDeleteFolder?.(folder)}
                aria-label={`Delete ${folder.name}`}
              >
                <Trash2 size={12} />
              </button>
            ) : null}
          </span>
        ) : null}
      </div>

      {colorPickerId === folder.id ? (
        <div className="org-folder-color-popover">
          {FOLDER_COLOR_SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              className="org-folder-color-swatch"
              style={{ background: color }}
              onClick={() => onChangeFolderColor?.(folder, color, false)}
              aria-label={`Set folder color to ${color}`}
            />
          ))}
        </div>
      ) : null}

      {showOverflowCount ? (
        <div className="org-folder-tree-overflow-note">
          {folder.children.length} deeper folder{folder.children.length === 1 ? '' : 's'}
        </div>
      ) : null}

      {hasChildren && isExpanded && canRenderChildren ? (
        <div className="org-folder-tree-children">
          {folder.children.map((child) => (
            <FolderNode
              key={child.id}
              folder={child}
              depth={depth + 1}
              maxDepth={maxDepth}
              expandedIds={expandedIds}
              selectedFolderId={selectedFolderId}
              assetCountsByFolderId={assetCountsByFolderId}
              canManageLibrary={canManageLibrary}
              colorPickerId={colorPickerId}
              onSelectFolder={onSelectFolder}
              onToggleFolder={onToggleFolder}
              onOpenCreateFolder={onOpenCreateFolder}
              onOpenDeleteFolder={onOpenDeleteFolder}
              onChangeFolderColor={onChangeFolderColor}
              onToggleFolderVisibility={onToggleFolderVisibility}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function FolderTree({
  folders = [],
  selectedFolderId = '',
  expandedFolderIds = null,
  assetCountsByFolderId = new Map(),
  canManageLibrary = false,
  maxDepth = 3,
  showAllFoldersOption = true,
  allFoldersLabel = 'All folders',
  colorPickerId = '',
  onSelectFolder,
  onToggleFolder,
  onOpenCreateFolder,
  onOpenDeleteFolder,
  onChangeFolderColor,
  onToggleFolderVisibility,
}) {
  const tree = useMemo(() => buildFolderTree(folders), [folders]);
  const [localExpanded, setLocalExpanded] = useState(() => new Set());
  const controlledExpanded = Array.isArray(expandedFolderIds) ? new Set(expandedFolderIds) : null;
  const expandedIds = controlledExpanded || localExpanded;

  const handleToggleFolder = (folderId) => {
    if (controlledExpanded) {
      onToggleFolder?.(folderId);
      return;
    }

    setLocalExpanded((current) => {
      const next = new Set(current);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  return (
    <div className="org-folder-tree">
      {showAllFoldersOption ? (
        <button
          type="button"
          className={`org-folder-tree-row org-folder-tree-root ${!selectedFolderId ? 'active' : ''}`}
          onClick={() => onSelectFolder?.(null)}
        >
          <span className="org-folder-tree-toggle placeholder" />
          <span className="org-folder-tree-icon">
            <Folder size={14} />
          </span>
          <span className="org-folder-tree-copy">
            <strong>{allFoldersLabel}</strong>
            <small>Browse the full library</small>
          </span>
        </button>
      ) : null}

      {tree.map((folder) => (
        <FolderNode
          key={folder.id}
          folder={folder}
          depth={0}
          maxDepth={maxDepth}
          expandedIds={expandedIds}
          selectedFolderId={selectedFolderId}
          assetCountsByFolderId={assetCountsByFolderId}
          canManageLibrary={canManageLibrary}
          colorPickerId={colorPickerId}
          onSelectFolder={onSelectFolder}
          onToggleFolder={handleToggleFolder}
          onOpenCreateFolder={onOpenCreateFolder}
          onOpenDeleteFolder={onOpenDeleteFolder}
          onChangeFolderColor={onChangeFolderColor}
          onToggleFolderVisibility={onToggleFolderVisibility}
        />
      ))}
    </div>
  );
}
