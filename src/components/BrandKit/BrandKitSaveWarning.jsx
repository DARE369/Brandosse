import React from 'react';
import { AlertTriangle } from 'lucide-react';

export default function BrandKitSaveWarning({ missingFields = [], onComplete, onDismiss }) {
  return (
    <div
      className="bk-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bk-warning-title"
    >
      <div className="bk-modal bk-warning-modal">
        <div className="bk-warning-icon" aria-hidden="true"><AlertTriangle size={20} /></div>
        <h2 id="bk-warning-title" className="bk-modal-title">
          Some important fields are empty
        </h2>
        <p className="bk-modal-body">
          Without these fields, AI outputs may feel generic and less consistent with your brand.
        </p>

        <ul className="bk-warning-field-list">
          {missingFields.map((field) => (
            <li key={field.key} className="bk-warning-field-item">
              <span className="bk-warning-field-dot" aria-hidden="true" />
              {field.label}
            </li>
          ))}
        </ul>

        <div className="bk-modal-actions">
          <button className="bk-btn-primary" onClick={onDismiss} type="button">
            Complete these fields
          </button>
          <button className="bk-btn-ghost" onClick={onComplete} type="button">
            Save anyway -&gt;
          </button>
        </div>
      </div>
    </div>
  );
}
