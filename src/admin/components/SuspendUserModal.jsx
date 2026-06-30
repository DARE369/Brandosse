import React, { useMemo, useState } from "react";
import { AlertTriangle, Clock3, ShieldAlert, X } from "lucide-react";
import { formatRelativeTime, formatShortDateTime } from "../utils/formatDate";
import { resolveInitials } from "../utils/adminClient";

const REASON_OPTIONS = [
  { value: "policy_violation", label: "Policy violation" },
  { value: "spam", label: "Spam" },
  { value: "abuse", label: "Abuse" },
  { value: "inactivity_review", label: "Inactivity review" },
  { value: "account_security", label: "Account security" },
  { value: "support_hold", label: "Support hold" },
  { value: "other", label: "Other" },
];

const DURATION_OPTIONS = [
  { label: "24 hours", durationHours: 24 },
  { label: "7 days", durationHours: 24 * 7 },
  { label: "30 days", durationHours: 24 * 30 },
  { label: "Indefinite", durationHours: null },
];

const SUSPENSION_TYPES = [
  {
    value: "login",
    label: "Login suspension",
    description: "Prevents login.",
  },
  {
    value: "publishing",
    label: "Publishing suspension",
    description: "Blocks posting while login still works.",
  },
  {
    value: "generation",
    label: "Generation suspension",
    description: "Blocks AI generation.",
  },
  {
    value: "full",
    label: "Full suspension",
    description: "Blocks login, publishing, and generation.",
  },
];

function buildConfirmPayload(form) {
  return {
    suspensionType: form.suspensionType,
    durationHours: form.durationHours,
    reasonCode: form.reasonCode,
    note: form.note.trim(),
  };
}

export default function SuspendUserModal({
  open,
  targets = [],
  busy = false,
  onClose,
  onConfirm,
}) {
  const [form, setForm] = useState({
    suspensionType: "full",
    durationHours: 24,
    reasonCode: "policy_violation",
    note: "",
  });

  const primaryTarget = targets[0] || null;
  const isBulk = targets.length > 1;

  const title = useMemo(() => {
    if (isBulk) return `Suspend ${targets.length} Users`;
    return `Suspend ${primaryTarget?.full_name || primaryTarget?.email || "User"}`;
  }, [isBulk, primaryTarget, targets.length]);

  if (!open) return null;

  return (
    <div className="admin-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="suspend-user-modal-title">
      <div className="admin-modal-card">
        <div className="admin-modal-header">
          <div>
            <span className="admin-section-kicker">Controlled Action</span>
            <h3 id="suspend-user-modal-title">{title}</h3>
          </div>
          <button
            type="button"
            className="admin-modal-close"
            onClick={onClose}
            aria-label="Close suspension dialog"
            disabled={busy}
          >
            <X size={18} />
          </button>
        </div>

        <div className="admin-modal-body">
          <div className="admin-inline-alert admin-inline-alert-warning">
            <AlertTriangle size={16} />
            <span>This action is reversible and will be logged in the audit trail.</span>
          </div>

          {primaryTarget ? (
            <div className="admin-modal-summary">
              <div className="admin-modal-avatar">
                {primaryTarget.avatar_url ? (
                  <img
                    src={primaryTarget.avatar_url}
                    alt={primaryTarget.full_name || primaryTarget.email || "User"}
                  />
                ) : (
                  resolveInitials(primaryTarget.full_name, primaryTarget.email)
                )}
              </div>

              <div className="admin-modal-summary-copy">
                <strong>
                  {isBulk ? `${targets.length} selected users` : primaryTarget.full_name || "Unnamed user"}
                </strong>
                <span>{isBulk ? "Bulk suspension request" : primaryTarget.email || "No email"}</span>
                {!isBulk ? (
                  <span>
                    Last active {formatRelativeTime(primaryTarget.last_active_at)} · {formatShortDateTime(primaryTarget.last_active_at)}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="admin-modal-section">
            <span className="admin-section-label">Suspension Type</span>
            <div className="admin-option-grid">
              {SUSPENSION_TYPES.map((option) => (
                <label
                  key={option.value}
                  className={`admin-option-card${form.suspensionType === option.value ? " active" : ""}`}
                >
                  <input
                    type="radio"
                    name="suspensionType"
                    value={option.value}
                    checked={form.suspensionType === option.value}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, suspensionType: event.target.value }))
                    }
                  />
                  <div>
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="admin-modal-section">
            <span className="admin-section-label">Duration</span>
            <div className="admin-chip-grid">
              {DURATION_OPTIONS.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className={`admin-chip-button${form.durationHours === option.durationHours ? " active" : ""}`}
                  onClick={() => setForm((current) => ({ ...current, durationHours: option.durationHours }))}
                >
                  <Clock3 size={14} />
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="admin-form-grid">
            <label>
              Reason code
              <select
                className="admin-select"
                value={form.reasonCode}
                onChange={(event) => setForm((current) => ({ ...current, reasonCode: event.target.value }))}
              >
                {REASON_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-form-grid-span">
              Internal note
              <textarea
                className="admin-textarea"
                rows="4"
                maxLength={500}
                placeholder="Optional internal note for the audit log."
                value={form.note}
                onChange={(event) => setForm((current) => ({ ...current, note: event.target.value.slice(0, 500) }))}
              />
              <span className="admin-field-footnote">{form.note.length}/500</span>
            </label>
          </div>

          <div className="admin-audit-preview">
            <ShieldAlert size={16} />
            <span>
              This will be logged as: Admin suspended {isBulk ? `${targets.length} users` : primaryTarget?.full_name || primaryTarget?.email || "user"} - {form.reasonCode}
            </span>
          </div>
        </div>

        <div className="admin-modal-footer">
          <button type="button" className="admin-secondary-button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="admin-warning-button"
            disabled={busy}
            onClick={() => onConfirm(buildConfirmPayload(form))}
          >
            {busy ? "Suspending..." : "Confirm Suspension"}
          </button>
        </div>
      </div>
    </div>
  );
}
