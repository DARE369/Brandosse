import React, { useEffect, useMemo, useState } from 'react';
import { Search, Workflow, X } from 'lucide-react';

function formatValue(value) {
  return String(value || '')
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export default function CommonRoomPipelinePicker({
  open = false,
  items = [],
  loading = false,
  onClose,
  onSelectItem,
}) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      if (!normalizedQuery) return true;
      return [
        item.title,
        item.currentStageName,
        item.status,
        item.platform,
        item.posts?.caption,
      ].some((value) => String(value || '').toLowerCase().includes(normalizedQuery));
    });
  }, [items, query]);

  const selectedItem = useMemo(
    () => visibleItems.find((item) => item.id === selectedId) || visibleItems[0] || null,
    [selectedId, visibleItems],
  );

  useEffect(() => {
    if (!open) return;
    setSelectedId((current) => {
      if (visibleItems.some((item) => item.id === current)) {
        return current;
      }
      return visibleItems[0]?.id || '';
    });
  }, [open, visibleItems]);

  if (!open) return null;

  return (
    <div className="common-room-modal" role="dialog" aria-modal="true" aria-label="Reference a pipeline item">
      <button type="button" className="common-room-modal-backdrop" aria-label="Close pipeline picker" onClick={onClose} />

      <section className="common-room-picker-panel">
        <header className="common-room-picker-header">
          <div>
            <span className="common-room-eyebrow">Pipeline Reference</span>
            <h3>Link work in review</h3>
          </div>
          <button type="button" className="common-room-icon-button subtle" aria-label="Close pipeline picker" onClick={onClose}>
            <X size={15} />
          </button>
        </header>

        <div className="common-room-picker-layout">
          <div className="common-room-picker-list">
            <label className="common-room-search">
              <Search size={14} />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search titles, stages, or status"
              />
            </label>

            {loading ? (
              <div className="common-room-picker-empty">Loading pipeline items...</div>
            ) : visibleItems.length === 0 ? (
              <div className="common-room-picker-empty">No pipeline items matched this search.</div>
            ) : (
              <div className="common-room-picker-items">
                {visibleItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`common-room-picker-item ${selectedItem?.id === item.id ? 'active' : ''}`}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <strong>{item.title || 'Untitled item'}</strong>
                    <span>{item.currentStageName || formatValue(item.status) || 'Pipeline item'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <aside className="common-room-picker-preview">
            {selectedItem ? (
              <>
                <div className="common-room-picker-preview-card pipeline">
                  <div className="common-room-picker-thumbnail icon-only">
                    <Workflow size={22} />
                  </div>

                  <div className="common-room-picker-preview-copy">
                    <strong>{selectedItem.title || 'Untitled item'}</strong>
                    <p>{selectedItem.posts?.caption || selectedItem.currentStageName || 'Pipeline item in review.'}</p>
                  </div>
                </div>

                <div className="common-room-picker-stat-grid">
                  <div>
                    <span>Status</span>
                    <strong>{formatValue(selectedItem.status) || 'Unknown'}</strong>
                  </div>
                  <div>
                    <span>Stage</span>
                    <strong>{selectedItem.currentStageName || 'Unknown'}</strong>
                  </div>
                  <div>
                    <span>Platform</span>
                    <strong>{formatValue(selectedItem.platform) || 'Not set'}</strong>
                  </div>
                  <div>
                    <span>Updated</span>
                    <strong>{selectedItem.updated_at ? new Date(selectedItem.updated_at).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    }) : 'Unknown'}</strong>
                  </div>
                </div>

                <div className="common-room-modal-actions">
                  <button type="button" className="common-room-button ghost" onClick={onClose}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="common-room-button primary"
                    onClick={() => selectedItem && onSelectItem?.(selectedItem)}
                  >
                    Send Pipeline Reference
                  </button>
                </div>
              </>
            ) : (
              <div className="common-room-picker-empty">Choose a pipeline item to preview it here.</div>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}
