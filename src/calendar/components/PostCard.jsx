// PostCard — the shared card shown in Month view, List/Agenda view, and the
// Drafts rail (CALENDAR_SPEC.md §1/§4). Renders a "group" object as produced
// by useCalendarPosts'/useCalendarDrafts' groupPostsByGeneration() — one card
// per generation_id (platform-icon-stack for fan-out groups), or one card per
// standalone post (generation_id IS NULL).
//
// Card anatomy (spec §4): thumbnail/platform glyph, platform-icon stack,
// status pill (icon+label+color, never color alone), scheduled time. Three
// reschedule modes all read from the SAME card markup: native HTML5 drag
// (desktop mouse / touch placeholder for the real @dnd-kit sensors wired in
// CalendarGrid.jsx), a "Move" trigger button (tap-to-select -> tap-destination,
// RESEARCH.md §2.4), and click-through to PostDetailDrawer (full edit, mode 2).
//
// Reused verbatim from the approved mockup's markup contract (`post-card`,
// `post-card-row`, `post-card-row__move-btn`, `post-card__platform-stack`,
// `post-card__status-dot`) — see mockup-gallery.html lines ~183-270 and
// mockup.css. `data-card-name` lives on the row (shared ancestor), never on
// the inner <button>, matching the Drafts rail's already-correct convention
// (DECISIONS_LOG.md, "Phase 2 (fix)").
import { POST_STATUS } from '../../constants/statuses';

const PLATFORM_VARS = {
  instagram: '--platform-instagram',
  tiktok: '--platform-tiktok-alt',
  linkedin: '--platform-linkedin',
  x: '--platform-x',
  youtube: '--platform-youtube',
  facebook: '--platform-facebook',
  pinterest: '--platform-pinterest',
};

function platformVar(platform) {
  return `var(${PLATFORM_VARS[platform] || '--color-text-tertiary'})`;
}

function deriveCardName(post) {
  return post?.title || (post?.caption ? post.caption.slice(0, 40) : '') || 'Untitled';
}

function formatCardTime(post, formatInTimeZone, timezone) {
  if (!post?.scheduled_at) return post?.status === POST_STATUS.DRAFT ? '—' : '';
  if (post.status === POST_STATUS.PUBLISHING) return 'now';
  return formatInTimeZone(post.scheduled_at, timezone, { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(' ', '')
    .toLowerCase();
}

/**
 * @param {object} props
 * @param {object} props.group - { groupKey, generationId, posts } from groupPostsByGeneration()
 * @param {string} props.timezone
 * @param {(iso, tz, opts) => string} props.formatInTimeZone
 * @param {boolean} [props.draggable]
 * @param {boolean} [props.isDraggingId] - id currently being dragged (native HTML5 DnD)
 * @param {(group, e) => void} [props.onDragStart]
 * @param {() => void} [props.onDragEnd]
 * @param {(group) => void} props.onOpen - opens PostDetailDrawer
 * @param {(group) => void} props.onMoveTrigger - enters tap-to-select move mode
 * @param {boolean} [props.locked] - true if every post in the group is reschedule-locked
 */
export default function PostCard({
  group,
  timezone = 'UTC',
  formatInTimeZone,
  draggable = true,
  isDragging = false,
  onDragStart,
  onDragEnd,
  onOpen,
  onMoveTrigger,
  locked = false,
}) {
  const primary = group.posts[0];
  if (!primary) return null;

  const platforms = [...new Set(group.posts.map((p) => p.platform).filter(Boolean))];
  const cardName = deriveCardName(primary);
  const timeLabel = formatCardTime(primary, formatInTimeZone, timezone);

  return (
    <div className="post-card-row" data-card-name={cardName}>
      <button
        type="button"
        className={`post-card${isDragging ? ' is-dragging' : ''}${locked ? ' is-locked' : ''}`}
        draggable={draggable && !locked}
        onClick={() => onOpen?.(group)}
        onDragStart={(e) => onDragStart?.(group, e)}
        onDragEnd={() => onDragEnd?.()}
        title={cardName}
      >
        <span className={`post-card__status-dot status-${primary.status || POST_STATUS.DRAFT}`} />
        {platforms.length > 0 && (
          <span className="post-card__platform-stack">
            {platforms.map((p) => (
              <span key={p} className="post-card__platform-dot" style={{ background: platformVar(p) }} title={p} />
            ))}
          </span>
        )}
        <span className="post-card__label">{cardName}</span>
        <span className="post-card__time">{timeLabel}</span>
      </button>
      {!locked && (
        <button
          type="button"
          className="post-card-row__move-btn"
          data-move-trigger
          aria-label={`Select ${cardName} to move`}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onMoveTrigger?.(group);
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M5 9l-3 3 3 3" /><path d="M9 5l3-3 3 3" /><path d="M15 19l3 3 3-3" /><path d="M19 9l3 3-3 3" />
            <line x1="2" y1="12" x2="22" y2="12" /><line x1="12" y1="2" x2="12" y2="22" />
          </svg>
        </button>
      )}
      {platforms.length > 1 && (
        <span className="ui-field-hint" style={{ fontSize: 10 }}>
          1 card &middot; {platforms.length} platforms (same generation_id)
        </span>
      )}
    </div>
  );
}

export { deriveCardName, formatCardTime, platformVar };
