"use client";

// Soft-delete confirmation modal — net-new component the approved mockup
// requires (mockup-gallery.html #soft-delete). Reliability requirement per
// LIBRARY_SPEC.md §6: delete moves an asset to a recoverable trash state,
// never an immediate hard delete, with the 30-day recovery window stated
// explicitly at the moment of deletion (not buried in a settings page).
import { UiButton, UiModal } from '../../../components/Shared/ui';
import { getItemTitle } from '../libraryItemUtils';

export default function SoftDeleteConfirmModal({ asset, open, onClose, onConfirm, busy }) {
  if (!asset) return null;

  return (
    <UiModal
      open={open}
      onClose={onClose}
      title="Delete this asset?"
      description={`Moves "${getItemTitle(asset)}" to Trash — recoverable for 30 days. Still referenced in any post's history if it's been used.`}
      size="sm"
      footer={(
        <>
          <UiButton type="button" variant="secondary" onClick={onClose}>Cancel</UiButton>
          <UiButton type="button" variant="primary" tone="danger" onClick={() => onConfirm(asset)} loading={busy}>
            Move to Trash
          </UiButton>
        </>
      )}
    />
  );
}
