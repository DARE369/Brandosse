import React, { useEffect, useMemo, useState } from "react";

const CHANNEL_OPTIONS = [
  {
    value: "in_app",
    label: "In-app notification",
    description: "Shows in the user's notification bell inside SocialAI.",
  },
  {
    value: "email",
    label: "Email",
    description: "Sends to the user's registered email address.",
  },
  {
    value: "both",
    label: "Both",
    description: "Creates an in-app notification and also sends email.",
  },
];

export default function AdminNotifyUserModal({ open, busy, user, onClose, onSend }) {
  const [channel, setChannel] = useState("in_app");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    if (!open) return;
    setChannel("in_app");
    setSubject("");
    setBody("");
  }, [open]);

  const preview = useMemo(() => {
    const safeSubject = subject.trim() || "No subject";
    const safeBody = body.trim() || "No message body";
    return `${safeSubject} - ${safeBody.slice(0, 80)}${safeBody.length > 80 ? "..." : ""}`;
  }, [body, subject]);

  if (!open) return null;

  const disabled = busy || !subject.trim() || !body.trim() || subject.trim().length > 100 || body.trim().length > 1000;

  return (
    <div className="admin-modal-overlay" role="presentation">
      <div className="admin-modal-card" role="dialog" aria-modal="true" aria-label={`Send Notification to ${user?.full_name || user?.email || "User"}`}>
        <div className="admin-modal-header">
          <div>
            <h3>Send Notification to {user?.full_name || user?.email || "User"}</h3>
            <p className="admin-page-subtext">Choose the delivery channel and send a direct admin message.</p>
          </div>
          <button type="button" className="admin-modal-close" onClick={onClose} aria-label="Close notification modal">
            x
          </button>
        </div>

        <div className="admin-modal-body">
          <div className="admin-modal-section">
            <span className="admin-section-label">Channel</span>
            <div className="admin-option-grid">
              {CHANNEL_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`admin-option-card${channel === option.value ? " active" : ""}`}
                  onClick={() => setChannel(option.value)}
                >
                  <input type="radio" checked={channel === option.value} onChange={() => setChannel(option.value)} />
                  <div>
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="admin-modal-section">
            <label className="admin-form-grid-span">
              Subject
              <input
                type="text"
                className="admin-input admin-input-full"
                value={subject}
                maxLength={100}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="Required subject"
              />
            </label>
          </div>

          <div className="admin-modal-section">
            <label className="admin-form-grid-span">
              Message
              <textarea
                className="admin-textarea"
                rows="7"
                value={body}
                maxLength={1000}
                onChange={(event) => setBody(event.target.value)}
                placeholder="Required message body"
              />
            </label>
            <div className="admin-field-footnote">{body.length}/1000</div>
          </div>

          <div className="admin-modal-section">
            <span className="admin-section-label">Preview</span>
            <div className="admin-audit-preview">
              <span>{preview}</span>
            </div>
          </div>
        </div>

        <div className="admin-modal-footer">
          <button type="button" className="admin-secondary-button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="admin-primary-button"
            disabled={disabled}
            onClick={() => onSend({ channel, subject: subject.trim(), body: body.trim() })}
          >
            {busy ? "Sending..." : "Send Notification"}
          </button>
        </div>
      </div>
    </div>
  );
}
