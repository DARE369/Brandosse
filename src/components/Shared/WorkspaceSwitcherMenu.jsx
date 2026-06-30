import React from 'react';
import { Building2, Check, Home, ShieldCheck } from 'lucide-react';
function getWorkspaceIcon(type) {
  if (type === 'admin') return ShieldCheck;
  if (type === 'organization') return Building2;
  return Home;
}

export default function WorkspaceSwitcherMenu({
  workspaces = [],
  activeWorkspace = null,
  onSelect = () => {},
  heading = 'Switch Workspace',
  className = '',
}) {
  if (!Array.isArray(workspaces) || workspaces.length === 0) return null;

  return (
    <div className={['workspace-switcher-menu', className].filter(Boolean).join(' ')}>
      {heading ? <div className="workspace-switcher-heading">{heading}</div> : null}
      {workspaces.map((workspace) => {
        const Icon = getWorkspaceIcon(workspace.type);
        const active = activeWorkspace?.id === workspace.id;

        return (
          <button
            key={workspace.id}
            type="button"
            className={`workspace-switcher-item ${active ? 'active' : ''}`}
            onClick={() => onSelect(workspace)}
          >
            <span className="workspace-switcher-icon" aria-hidden="true">
              <Icon size={16} />
            </span>
            <span className="workspace-switcher-copy">
              <strong>{workspace.label}</strong>
              <span>{workspace.description || 'Workspace'}</span>
            </span>
            <span className="workspace-switcher-active" aria-hidden="true">
              {active ? <Check size={16} /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
