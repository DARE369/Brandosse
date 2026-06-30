// StatusPill — icon + label + color, never color alone (CALENDAR_SPEC.md §3).
// Shared by CalendarListView's post rows and PostDetailDrawer's header.
// "Published" carries the honesty affordance from spec §2.1: publishing
// today means executeMockPublishAttempts() succeeded, not that content
// reached a real platform — the pill says "via mock connection" rather than
// claiming more than that.
import { POST_STATUS, POST_STATUS_LABELS } from '../../constants/statuses';

const ICONS = {
  [POST_STATUS.DRAFT]: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    </svg>
  ),
  [POST_STATUS.SCHEDULED]: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" />
    </svg>
  ),
  [POST_STATUS.PUBLISHING]: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="12" cy="12" r="10" />
    </svg>
  ),
  [POST_STATUS.PUBLISHED]: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  [POST_STATUS.FAILED]: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  [POST_STATUS.ARCHIVED]: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    </svg>
  ),
};

export default function StatusPill({ status, suffix = null }) {
  const normalized = status || POST_STATUS.DRAFT;
  const label = POST_STATUS_LABELS[normalized] || normalized;
  return (
    <span className={`status-pill status-${normalized}`}>
      {ICONS[normalized] || ICONS[POST_STATUS.DRAFT]}
      {label}
      {normalized === POST_STATUS.PUBLISHED && (
        <span className="mock-connection-note" title="Publishing in this build uses a mock connection, not a live platform API.">
          via mock connection
        </span>
      )}
      {suffix}
    </span>
  );
}
