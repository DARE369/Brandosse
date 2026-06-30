// ToastStack — non-blocking toasts for drag conflict, stale write, and
// Quick Post submit confirmation (CALENDAR_SPEC.md §5/§10). Matches the
// approved mockup's `.toast-stack`/`.toast` markup and "Schedule anyway"
// action button exactly (mockup-gallery.html toast templates + mockup.js's
// showToast()). Built as its own small component rather than reusing
// `react-hot-toast` (already used elsewhere on this page for simple
// success/error strings) because these specific toasts need a persistent
// action button ("Schedule anyway") inside the toast body, which
// react-hot-toast's default API doesn't model — introducing a second toast
// mechanism only for this one structural need, not a stylistic preference.
import { useCallback, useRef, useState } from 'react';

let idCounter = 0;

export function useToastStack() {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) { clearTimeout(timer); timers.current.delete(id); }
  }, []);

  const push = useCallback((toast, durationMs = 9000) => {
    idCounter += 1;
    const id = idCounter;
    setToasts((prev) => [...prev, { id, ...toast }]);
    const timer = setTimeout(() => dismiss(id), durationMs);
    timers.current.set(id, timer);
    return id;
  }, [dismiss]);

  const update = useCallback((id, patch) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  return { toasts, push, dismiss, update };
}

export default function ToastStack({ toasts, onDismiss, onScheduleAnyway }) {
  if (!toasts.length) return null;
  return (
    <div className="cal3-toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div className="cal3-toast" key={toast.id}>
          <span className={`cal3-toast__icon tone-${toast.tone || 'info'}`}>{toast.icon}</span>
          <div className="cal3-toast__body">
            <p className="cal3-toast__title">{toast.title}</p>
            {toast.desc && <p className="cal3-toast__desc">{toast.desc}</p>}
            {toast.scheduleAnyway && (
              <div className="cal3-toast__actions">
                <button
                  type="button"
                  className="ui-button ui-button-secondary ui-button-sm"
                  onClick={() => { onScheduleAnyway?.(toast); onDismiss?.(toast.id); }}
                >
                  Schedule anyway
                </button>
                <button type="button" className="ui-button ui-button-ghost ui-button-sm" onClick={() => onDismiss?.(toast.id)}>
                  Undo move
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            className="ui-icon-button ui-icon-button-ghost ui-icon-button-sm cal3-toast__close"
            aria-label="Dismiss"
            onClick={() => onDismiss?.(toast.id)}
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}

export const TOAST_ICONS = {
  warning: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  info: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  ),
  success: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  ),
  // Same circle-exclamation glyph already used for this tree's other
  // hard-failure states (PersonalCalendarPage.jsx's day-error-state,
  // StatusPill.jsx's failed status) — reused here rather than invented, so
  // a failed Quick Post reads as visually distinct from the existing
  // amber "soft warning" (scheduling conflict) toast.
  danger: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
};
