"use client";

// Sticky batch-action bar shown once one or more asset cards are selected —
// ui-v2 rebuild of src/pages/LibraryPage/components/LibraryBulkActionBar.jsx
// (AS_IS_AUDIT.md §3.3 — Reuse of shape, restyled). Matches the approved
// mockup's #bulkBar (Clear / Archive / Delete — "Move to draft" intentionally
// absent, assets have no draft/scheduled concept; that's Calendar's territory).
import { Button } from "../../../ui-v2";
import styles from "../LibraryPage.module.css";

export default function BulkActionBar({ count, busy, onArchive, onDelete, onClear }) {
  if (count === 0) return null;

  return (
    <div className={styles.bulkBar} role="region" aria-label="Bulk actions">
      <span className={styles.bulkBarMsg}>{count} selected</span>
      <div className={styles.bulkBarActions}>
        <Button variant="subtle" size="sm" onClick={onClear} disabled={busy}>Clear</Button>
        <Button variant="subtle" size="sm" onClick={onArchive} disabled={busy}>Archive</Button>
        <Button variant="dangerSolid" size="sm" onClick={onDelete} disabled={busy}>Delete</Button>
      </div>
    </div>
  );
}
