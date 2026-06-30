import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, Check, Globe2, Plus, Trash2, User2 } from 'lucide-react';

function groupPresets(presets = []) {
  return {
    shared: presets.filter((preset) => preset.scope === 'shared'),
    personal: presets.filter((preset) => preset.scope === 'personal'),
  };
}

export default function CalendarSavedViewsMenu({
  presets = [],
  presetsLoading = false,
  canManageShared = false,
  onApplyPreset,
  onCreatePreset,
  onDeletePreset,
  onSetDefault,
}) {
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [scope, setScope] = useState(canManageShared ? 'shared' : 'personal');
  const [makeDefault, setMakeDefault] = useState(false);

  useEffect(() => {
    if (!open) return undefined;

    function handleClickOutside(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const grouped = useMemo(() => groupPresets(presets), [presets]);

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    await onCreatePreset?.({
      name: trimmedName,
      scope,
      isDefault: makeDefault,
    });
    setName('');
    setMakeDefault(false);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={`org-calendar-saved ${open ? 'open' : ''}`.trim()}>
      <button
        type="button"
        className="org-calendar-saved-trigger"
        onClick={() => setOpen((current) => !current)}
      >
        <Bookmark size={14} />
        Saved Views
      </button>

      {open ? (
        <div className="org-calendar-saved-menu">
          <div className="org-calendar-saved-header">
            <div>
              <span className="org-calendar-saved-kicker">Presets</span>
              <strong>Saved Views</strong>
            </div>
          </div>

          <div className="org-calendar-saved-create">
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Save the current view..."
            />

            <div className="org-calendar-saved-create-row">
              <div className="org-calendar-saved-scope-toggle">
                <button
                  type="button"
                  className={scope === 'personal' ? 'active' : ''}
                  onClick={() => setScope('personal')}
                >
                  <User2 size={13} />
                  Personal
                </button>
                {canManageShared ? (
                  <button
                    type="button"
                    className={scope === 'shared' ? 'active' : ''}
                    onClick={() => setScope('shared')}
                  >
                    <Globe2 size={13} />
                    Shared
                  </button>
                ) : null}
              </div>

              <label className="org-calendar-saved-default">
                <input
                  type="checkbox"
                  checked={makeDefault}
                  onChange={(event) => setMakeDefault(event.target.checked)}
                />
                <span>Default</span>
              </label>
            </div>

            <button type="button" className="org-primary-button" onClick={handleSave} disabled={!name.trim()}>
              <Plus size={14} />
              Save Current View
            </button>
          </div>

          {presetsLoading ? (
            <div className="org-calendar-empty-inline">Loading saved views...</div>
          ) : (
            <div className="org-calendar-saved-groups">
              {[
                { key: 'shared', label: 'Shared Views', icon: Globe2, items: grouped.shared },
                { key: 'personal', label: 'Personal Views', icon: User2, items: grouped.personal },
              ].map((group) => {
                const Icon = group.icon;
                return (
                  <section key={group.key} className="org-calendar-saved-group">
                    <header>
                      <span>
                        <Icon size={13} />
                        {group.label}
                      </span>
                    </header>

                    {group.items.length === 0 ? (
                      <div className="org-calendar-saved-empty">No saved views yet.</div>
                    ) : (
                      <div className="org-calendar-saved-list">
                        {group.items.map((preset) => (
                          <article key={preset.id} className="org-calendar-saved-item">
                            <button
                              type="button"
                              className="org-calendar-saved-main"
                              onClick={() => {
                                onApplyPreset?.(preset);
                                setOpen(false);
                              }}
                            >
                              <strong>{preset.name}</strong>
                              <span>{preset.viewMode}</span>
                            </button>

                            {(preset.scope === 'personal' || canManageShared) ? (
                              <div className="org-calendar-saved-actions">
                                <button
                                  type="button"
                                  className={preset.isDefault ? 'active' : ''}
                                  onClick={() => onSetDefault?.(preset)}
                                  title={preset.isDefault ? 'Default view' : 'Set as default'}
                                >
                                  <Check size={13} />
                                </button>
                                <button
                                  type="button"
                                  className="danger"
                                  onClick={() => onDeletePreset?.(preset)}
                                  title="Delete view"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
