// ConfirmDialog — generic replacement for window.confirm() across Calendar.
// Styled with the same modal-backdrop / ui-button classes ScheduleModal.jsx
// already uses (calendar-engine-v2.css), so it matches the frozen visual
// system exactly rather than introducing a second modal look.
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  confirmTone = 'danger', // 'danger' | 'primary'
  busy = false,
  onConfirm,
  onClose,
}) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="schedule-modal" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: 400 }}>
        <div className="schedule-modal__header">
          <h3 className="schedule-modal__title">{title}</h3>
          <button type="button" className="ui-icon-button ui-icon-button-ghost ui-icon-button-sm" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="schedule-modal__body">
          <p className="ui-field-hint" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{description}</p>
        </div>
        <div className="schedule-modal__footer">
          <button type="button" className="ui-button ui-button-secondary ui-button-md" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="button"
            className={`ui-button ui-button-${confirmTone === 'danger' ? 'danger' : 'primary'} ui-button-md`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
