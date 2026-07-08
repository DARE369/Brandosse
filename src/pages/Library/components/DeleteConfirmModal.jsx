"use client";

// Soft-delete confirmation modal — ui-v2 rebuild of
// src/pages/LibraryPage/components/SoftDeleteConfirmModal.jsx
// (AS_IS_AUDIT.md §3.2 — Refactor), built directly on the real ui-v2
// <Modal> primitive (small enough to need no bespoke CSS module).
// LIBRARY_SPEC.md §6: delete moves an asset to a recoverable trash state,
// never an immediate hard delete, with the 30-day recovery window stated
// explicitly at the moment of deletion.
import { Button, Modal } from "../../../ui-v2";
import { getItemTitle } from "../libraryItemUtils";

export default function DeleteConfirmModal({ asset, open, onClose, onConfirm, busy }) {
  if (!asset) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Delete this asset?"
      description={`Moves "${getItemTitle(asset)}" to Trash — recoverable for 30 days. Still referenced in any post's history if it's been used.`}
      actions={(
        <>
          <Button variant="subtle" onClick={onClose}>Cancel</Button>
          <Button variant="dangerSolid" onClick={() => onConfirm(asset)} disabled={busy}>
            {busy ? "Moving…" : "Move to Trash"}
          </Button>
        </>
      )}
    />
  );
}
