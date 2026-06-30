"use client";

// Sticky batch-action bar shown once one or more library cards are selected.
// Reuses the same visual shell as UiStickySaveBar (.ui-save-bar) — it just
// needs more than one named action, so it isn't built on that component.
// AS_IS_AUDIT.md §3.3 — Reuse classification confirmed: the component
// itself needed no structural change. Per the approved mockup's
// `.lib-bulk-bar` (Clear / Archive / Delete — "Move to draft" dropped, since
// assets have no draft/scheduled concept; that's Calendar's territory now).

import { UiButton } from '../../../components/Shared/ui';

export default function LibraryBulkActionBar({
  count,
  busy,
  onArchive,
  onDelete,
  onClear,
}) {
  if (count === 0) return null;

  return (
    <div className="ui-save-bar" role="region" aria-label="Bulk actions">
      <span className="ui-save-bar-msg">{count} selected</span>
      <div className="ui-save-bar-actions">
        <UiButton type="button" variant="subtle" size="sm" onClick={onClear} disabled={busy}>
          Clear
        </UiButton>
        <UiButton type="button" variant="secondary" size="sm" onClick={onArchive} disabled={busy}>
          Archive
        </UiButton>
        <UiButton type="button" variant="primary" tone="danger" size="sm" onClick={onDelete} disabled={busy}>
          Delete
        </UiButton>
      </div>
    </div>
  );
}
