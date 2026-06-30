// Popover that appears when the user clicks an empty calendar cell.
// Shows quick actions: schedule draft, AI slot suggestion, new post, etc.
// `day` is a 'YYYY-MM-DD' key (see src/utils/timezone.js), not a Date object.
import { useEffect, useRef } from 'react';
import { ClipboardList, Pencil, Sparkles, Calendar } from 'lucide-react';
import { formatDateKey } from '../../utils/timezone';

function formatCellTime(hour) {
  // Month view is day-only (no hour concept) — CalendarGrid.jsx never
  // passes an `hour`, only `day`. WeekGrid.jsx (hour-aware, Phase 2 per
  // CALENDAR_SPEC.md §11) is the caller that would pass a real hour.
  if (hour === undefined || hour === null) return '';
  if (hour === 0)  return '12:00 AM';
  if (hour === 12) return '12:00 PM';
  return hour < 12 ? `${hour}:00 AM` : `${hour - 12}:00 PM`;
}

function formatCellDay(day) {
  if (!day) return '';
  return formatDateKey(day, { weekday: 'long', month: 'short', day: 'numeric' });
}

const QUICK_ACTIONS = [
  {
    id:    'schedule_draft',
    Icon:  ClipboardList,
    label: 'Schedule a draft',
    hint:  'Pick a draft from your library',
    type:  'neutral',
  },
  {
    id:    'new_post',
    Icon:  Pencil,
    label: 'New post',
    hint:  'Create a post for this slot',
    type:  'neutral',
  },
  {
    id:    'ai_suggest',
    Icon:  Sparkles,
    label: 'Ask AI what to post',
    hint:  'Get a content idea for this time',
    type:  'ai',
  },
  {
    id:    'week_plan',
    Icon:  Calendar,
    label: 'Generate week plan',
    hint:  'AI fills your whole week',
    type:  'ai',
  },
];

export default function CellCommandPalette({
  hour,
  day,
  isOptimal = false,
  optimalSlot = null,
  style = {},
  onAction,
  onClose,
}) {
  const ref = useRef(null);

  // Close on outside click is handled by the parent overlay
  // Focus trap: focus first item
  useEffect(() => {
    const el = ref.current?.querySelector('button');
    el?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="cal3-cell-palette"
      style={style}
      onClick={(e) => e.stopPropagation()}
      role="menu"
      aria-label="Cell actions"
    >
      {/* Header */}
      <div className="cal3-cell-palette__header">
        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
          {formatCellDay(day)}
        </div>
        <div className="cal3-cell-palette__time">{formatCellTime(hour)}</div>
      </div>

      {/* AI optimal slot callout */}
      {isOptimal && optimalSlot && (
        <div className="cal3-cell-palette__ai-slot">
          <div className="cal3-cell-palette__ai-slot-label"><Sparkles size={12} aria-hidden="true" /> AI recommended slot</div>
          <div className="cal3-cell-palette__ai-slot-text">
            {optimalSlot.reason || `Best time for ${optimalSlot.platform || 'engagement'}`}
            {optimalSlot.score ? ` (score ${optimalSlot.score}/100)` : ''}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="cal3-cell-palette__list" role="group">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.id}
            className="cal3-cell-palette__item"
            role="menuitem"
            onClick={() => onAction?.(action.id)}
          >
            <div
              className={`cal3-cell-palette__item-icon cal3-cell-palette__item-icon--${action.type}`}
            >
              <action.Icon size={15} aria-hidden="true" />
            </div>
            <div className="cal3-cell-palette__item-body">
              <div className="cal3-cell-palette__item-label">{action.label}</div>
              <div className="cal3-cell-palette__item-hint">{action.hint}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
