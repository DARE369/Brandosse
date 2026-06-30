export const TASK_PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

export function getTaskPriorityLabel(priority) {
  return TASK_PRIORITY_OPTIONS.find((option) => option.value === priority)?.label || 'Medium';
}

export function formatTaskDateTimeInput(value) {
  if (!value) return '';
  const nextDate = new Date(value);
  if (Number.isNaN(nextDate.getTime())) return '';
  const offset = nextDate.getTimezoneOffset();
  const localDate = new Date(nextDate.getTime() - offset * 60 * 1000);
  return localDate.toISOString().slice(0, 16);
}

export function formatTaskDateTime(value) {
  if (!value) return 'No due date';
  const nextDate = new Date(value);
  if (Number.isNaN(nextDate.getTime())) return 'Invalid date';
  return nextDate.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function isTaskOverdue(value) {
  if (!value) return false;
  const nextDate = new Date(value);
  if (Number.isNaN(nextDate.getTime())) return false;
  return nextDate.getTime() < Date.now();
}

export function shortCode(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  return normalized.slice(0, 8).toUpperCase();
}

export function safeTaskArray(value) {
  return Array.isArray(value) ? value : [];
}
