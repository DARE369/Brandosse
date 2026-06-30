import { POST_STATUS } from '../constants/statuses';

const NORMALIZED_STATUS = new Set(Object.values(POST_STATUS));

const TRANSITIONS = {
  [POST_STATUS.DRAFT]: new Set([POST_STATUS.DRAFT, POST_STATUS.SCHEDULED, POST_STATUS.PUBLISHING, POST_STATUS.FAILED, POST_STATUS.ARCHIVED]),
  [POST_STATUS.SCHEDULED]: new Set([POST_STATUS.SCHEDULED, POST_STATUS.DRAFT, POST_STATUS.PUBLISHING, POST_STATUS.FAILED, POST_STATUS.ARCHIVED]),
  [POST_STATUS.PUBLISHING]: new Set([POST_STATUS.PUBLISHING, POST_STATUS.PUBLISHED, POST_STATUS.FAILED]),
  [POST_STATUS.FAILED]: new Set([POST_STATUS.FAILED, POST_STATUS.DRAFT, POST_STATUS.SCHEDULED, POST_STATUS.PUBLISHING, POST_STATUS.ARCHIVED]),
  [POST_STATUS.PUBLISHED]: new Set([POST_STATUS.PUBLISHED, POST_STATUS.ARCHIVED]),
  [POST_STATUS.ARCHIVED]: new Set([POST_STATUS.ARCHIVED, POST_STATUS.DRAFT]),
};

export function normalizePostStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return NORMALIZED_STATUS.has(normalized) ? normalized : null;
}

export function canTransitionPostStatus(fromStatus, toStatus) {
  const from = normalizePostStatus(fromStatus);
  const to = normalizePostStatus(toStatus);

  if (!to) return false;
  if (!from) return true;
  return Boolean(TRANSITIONS[from]?.has(to));
}

// Posts in these states represent something that already happened (or is
// happening right now) — their scheduled_at must not be silently rewritten
// by a drag or a quick reschedule action, since that implies "this hasn't
// happened yet and can still move."
const RESCHEDULE_LOCKED_STATUSES = new Set([
  POST_STATUS.PUBLISHED,
  POST_STATUS.ARCHIVED,
  POST_STATUS.PUBLISHING,
]);

export function isLockedForReschedule(status) {
  return RESCHEDULE_LOCKED_STATUSES.has(normalizePostStatus(status));
}

export function assertPostStatusTransition(fromStatus, toStatus, context = '') {
  const from = normalizePostStatus(fromStatus);
  const to = normalizePostStatus(toStatus);

  if (!to) {
    throw new Error(`Invalid post status "${toStatus}"${context ? ` (${context})` : ''}`);
  }

  if (from && !canTransitionPostStatus(from, to)) {
    throw new Error(`Invalid post status transition ${from} -> ${to}${context ? ` (${context})` : ''}`);
  }

  return to;
}
