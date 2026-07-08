"use client";

// Trash view — ui-v2 rebuild of
// src/pages/LibraryPage/components/TrashModal.jsx, restyled per the
// APPROVED mockup's decision to present Trash as a full content-area page
// state (data-panel="trash", reached via the left rail's "Trash" item and a
// "Back to Library" action) rather than a modal overlay — see
// library-mockup.html's #trashList/.trashBanner markup and its
// data-view-btn="trash" state. The underlying data path (fetchTrash /
// restoreAsset, LIBRARY_SPEC.md §6's 30-day recovery window) is unchanged
// from TrashModal.jsx — only the container it renders inside changed from
// UiModal to an inline page section, matching the approved mockup's
// interaction model exactly.
import { useState } from "react";
import { Button } from "../../../ui-v2";
import { getItemTitle, formatDate } from "../libraryItemUtils";
import styles from "../LibraryPage.module.css";

export default function TrashView({ trashedAssets, loading, onRestore }) {
  const [restoringId, setRestoringId] = useState(null);

  const handleRestore = async (asset) => {
    setRestoringId(asset.id);
    try {
      await onRestore?.(asset);
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div>
      <div className={styles.trashBanner}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
        <span><strong>Deleted assets stay here for 30 days</strong> before they&rsquo;re gone for good. Restoring returns an asset to the main Library immediately.</span>
      </div>

      {loading ? (
        <p className={styles.fieldHint}>Loading…</p>
      ) : trashedAssets.length === 0 ? (
        <p className={styles.usedInEmpty}>Trash is empty — nothing deleted in the last 30 days.</p>
      ) : (
        <div className={styles.versionChain}>
          {trashedAssets.map((asset) => (
            <div key={asset.id} className={styles.versionItem}>
              <span className={styles.versionThumb} />
              <div className={styles.versionBody}>
                <span className={styles.versionLabel}>{getItemTitle(asset)}</span>
                <span className={styles.versionMeta}>Deleted {formatDate(asset.deleted_at || asset.updated_at)}</span>
              </div>
              <Button variant="subtle" size="sm" onClick={() => handleRestore(asset)} disabled={restoringId === asset.id}>
                {restoringId === asset.id ? "Restoring…" : "Restore"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
