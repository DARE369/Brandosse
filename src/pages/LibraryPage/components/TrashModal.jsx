"use client";

// Trash / restore modal — Phase 4 QA fix (QA_PERSONA_REVIEW_build.md, "Flow
// 5/7 — Restore from Trash: Fail, no UI path exists"; DECISIONS_LOG.md, QA
// item 4). The soft-delete confirmation modal (SoftDeleteConfirmModal.jsx)
// promises "you can recover it from Trash for 30 days," and the data layer
// (assetLibraryService.js's fetchTrashedPersonalAssets/restorePersonalAsset,
// LibraryStore.js's fetchTrash/restoreAsset) was already fully built and
// working — this component is the missing UI surface that actually lets a
// real user reach and use it. Not modeled in the approved mockup in detail,
// so this follows the closest existing in-page visual precedent rather than
// inventing a new pattern: AssetDetailDrawer.jsx's "version chain" rows
// (.version-item/.version-item__thumb/.version-item__body, all pre-existing
// CSS in LibraryV2.css, reused verbatim) — a thumb + title/meta + one action
// button per row is already this page's established shape for "a list of
// other asset states the user can act on." The mockup's own toast copy
// ("Recoverable for 30 days from the Trash section of the left rail" —
// mockup-gallery.html line 1017) is the strongest available signal for
// *where* this should be reachable from, hence the rail entry point wired
// in LibraryPageV2.jsx rather than e.g. a topbar icon button.
import { useEffect, useState } from 'react';
import { UiButton, UiModal } from '../../../components/Shared/ui';
import { getItemTitle, formatDate } from '../libraryItemUtils';

export default function TrashModal({ open, onClose, trashedAssets, loading, onRestore }) {
  const [restoringId, setRestoringId] = useState(null);

  // Reset any stale per-row "restoring" state whenever the modal re-opens
  // with a fresh list (e.g. after a previous restore already removed a row).
  useEffect(() => {
    if (open) setRestoringId(null);
  }, [open]);

  const handleRestore = async (asset) => {
    setRestoringId(asset.id);
    try {
      await onRestore?.(asset);
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <UiModal
      open={open}
      onClose={onClose}
      title="Trash"
      description="Deleted assets stay here for 30 days before they're gone for good."
      size="md"
      footer={(
        <UiButton type="button" variant="secondary" onClick={onClose}>Close</UiButton>
      )}
    >
      {loading ? (
        <p className="ui-field-hint">Loading…</p>
      ) : trashedAssets.length === 0 ? (
        <p className="used-in-empty">Trash is empty — nothing deleted in the last 30 days.</p>
      ) : (
        <div className="version-chain">
          {trashedAssets.map((asset) => (
            <div key={asset.id} className="version-item">
              <span className="version-item__thumb" />
              <div className="version-item__body">
                <span className="version-item__label">{getItemTitle(asset)}</span>
                <span className="version-item__meta">
                  Deleted {formatDate(asset.deleted_at || asset.updated_at)}
                </span>
              </div>
              <UiButton
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => handleRestore(asset)}
                loading={restoringId === asset.id}
              >
                Restore
              </UiButton>
            </div>
          ))}
        </div>
      )}
    </UiModal>
  );
}
