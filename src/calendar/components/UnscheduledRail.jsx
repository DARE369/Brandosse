// UnscheduledRail — "Drafts" (personal) / "Approved backlog" (org), spec §1/§3.
// Refactored from v3/DraftTray.jsx (AS_IS_AUDIT.md §3.5). This packet only
// implements and renders the personal "drafts" branch — the org
// "approved-but-unplaced backlog" branch point is named here (workspaceType
// prop) but intentionally not implemented, per the data-layer task's own
// scope boundary (calendarService.assertPersonalScope) and this task's scope
// (Packet 1, personal only).
//
// Drag-to-schedule (mode 1) AND a per-card "Move" button (mode 3,
// tap-to-select -> tap-destination) are both wired — DraftTray.jsx originally
// only had drag; the Move button closes the gap RESEARCH.md §2.4 and
// MOBILE_PARITY.md's "Drafts-rail Move-button gap" finding both required.
import { useRef, useState } from 'react';
import { FileImage, Film, Images, Sparkles, Pencil, FileText } from 'lucide-react';

const MEDIA_TYPE_ICON = {
  image: FileImage,
  video: Film,
  carousel: Images,
  'image-to-video': Sparkles,
  edit: Pencil,
};

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

function readinessScore(draft) {
  let score = 0;
  if (draft.caption?.trim()) score += 34;
  if (draft.generations?.storage_path) score += 33;
  if (draft.platform) score += 33;
  return score;
}

function DraftCard({ draft, onOpen, onMoveTrigger, onDragStart, onDragEnd, isDragging }) {
  const score = readinessScore(draft);
  const thumbnailUrl = draft.generations?.storage_path || null;
  const mediaType = draft.generations?.media_type || null;
  const ThumbIcon = MEDIA_TYPE_ICON[mediaType] || FileText;
  const cardName = draft.title || draft.caption?.slice(0, 30) || 'Untitled draft';

  return (
    <div
      className={`draft-card${isDragging ? ' is-dragging' : ''}`}
      draggable
      data-card-name={cardName}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', `draft:${draft.id}`);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart?.(draft);
      }}
      onDragEnd={() => onDragEnd?.()}
      title={`${cardName} — drag to schedule`}
      onClick={() => onOpen?.(draft)}
      role="button"
      tabIndex={0}
    >
      {thumbnailUrl ? (
        mediaType === 'video' ? (
          // Same media_type branch PostDetailDrawer.jsx already uses
          // (QA_PERSONA_REVIEW_build.md 2026-06-25 re-test, finding #2: a
          // video asset rendered here as a broken <img> before this fix).
          // No `controls`/full playback chrome here — this is a small
          // list-row thumbnail, not the drawer's full preview, so muted +
          // first-frame poster (the browser's default behavior for a
          // <video> with no autoplay) is the lightest-weight correct
          // treatment; see DECISIONS_LOG.md for this judgment call.
          <video className="draft-card__thumb" src={thumbnailUrl} muted playsInline draggable={false} />
        ) : (
          <img className="draft-card__thumb" src={thumbnailUrl} alt={cardName} draggable={false} />
        )
      ) : (
        <div className="draft-card__thumb"><ThumbIcon size={22} aria-hidden="true" /></div>
      )}

      <div className="draft-card__meta">
        <div className="draft-card__name">{cardName}</div>
        <div className="draft-card__platform-row">
          {draft.platform && <span className="post-card__platform-dot" style={{ background: platformVar(draft.platform) }} title={draft.platform} />}
          <span className="ui-field-hint" style={{ textTransform: 'uppercase', letterSpacing: '.04em', fontSize: 9 }}>
            {mediaType || 'post'}
          </span>
        </div>
      </div>

      <button
        type="button"
        className="draft-card__move-btn"
        data-move-trigger
        aria-label={`Select ${cardName} to move`}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); onMoveTrigger?.(draft); }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M5 9l-3 3 3 3" /><path d="M9 5l3-3 3 3" /><path d="M15 19l3 3 3-3" /><path d="M19 9l3 3-3 3" />
          <line x1="2" y1="12" x2="22" y2="12" /><line x1="12" y1="2" x2="12" y2="22" />
        </svg>
      </button>

      <div className="draft-card__readiness">
        <div
          className="draft-card__readiness-fill"
          style={{
            width: `${score}%`,
            background: score === 100 ? 'var(--color-success)' : score >= 60 ? 'var(--color-primary)' : 'var(--color-warning)',
          }}
        />
      </div>
    </div>
  );
}

// Sidebar's scrollable list gets a resizable max-height (drag handle below
// the header) — same interaction as the old horizontal tray, just resizing
// vertical list height instead of tray height now that this renders as a
// right-docked column (mockup's `.rail`/`.rail__scroll`, not `.cal3-tray`).
const RAIL_MIN_H  = 160;
const RAIL_MAX_H  = 720;
const RAIL_DEFAULT_H = 360;
const STORAGE_KEY = 'cal3-rail-height';

function getSavedHeight() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const n = parseInt(raw, 10);
      if (n >= RAIL_MIN_H && n <= RAIL_MAX_H) return n;
    }
  } catch { /* localStorage unavailable */ }
  return RAIL_DEFAULT_H;
}

export default function UnscheduledRail({
  workspaceType = 'personal',
  drafts = [],
  collapsed = false,
  onToggle,
  onOpenDraft,
  onMoveTrigger,
}) {
  const scrollRef  = useRef(null);
  const dragRef    = useRef(null); // { startY, startHeight } while dragging
  const [draggingId, setDraggingId] = useState(null);
  const [railHeight, setRailHeight] = useState(getSavedHeight);
  const [resizing,   setResizing]   = useState(false);

  if (workspaceType !== 'personal') {
    return null;
  }

  function handleResizeStart(e) {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startHeight: railHeight };
    setResizing(true);

    function onMove(ev) {
      const delta = ev.clientY - dragRef.current.startY; // down = positive = taller (vertical list grows downward)
      const next  = Math.max(RAIL_MIN_H, Math.min(RAIL_MAX_H, dragRef.current.startHeight + delta));
      setRailHeight(next);
    }

    function onUp(ev) {
      const delta = ev.clientY - dragRef.current.startY;
      const next  = Math.max(RAIL_MIN_H, Math.min(RAIL_MAX_H, dragRef.current.startHeight + delta));
      setRailHeight(next);
      try { localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* ignore */ }
      setResizing(false);
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup',   onUp);
      window.removeEventListener('pointercancel', onUp);
    }

    window.addEventListener('pointermove',    onMove);
    window.addEventListener('pointerup',      onUp);
    window.addEventListener('pointercancel',  onUp);
  }

  const scrollStyle = collapsed ? {} : { maxHeight: `${railHeight}px` };

  return (
    // Right-docked vertical sidebar (mockup: `.card.rail`, id="draftsRail")
    // — NOT a horizontal bottom tray. Desktop/tablet: fixed-width column,
    // second cell of the body grid (see CalendarPage.jsx's cal3-body-grid).
    // Mobile (<640px, see calendar-engine-v2.css): collapses back to a
    // horizontal strip via `order: -1` + row-direction scroll, matching the
    // mockup's documented mobile behavior exactly.
    <div
      id="draftsRail"
      className={`cal3-rail${collapsed ? ' is-collapsed' : ''}${resizing ? ' is-resizing' : ''}`}
    >
      <button className="cal3-rail__header" data-tray-toggle type="button" aria-expanded={!collapsed} onClick={onToggle}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
        </svg>
        <span className="cal3-rail__title">Drafts</span>
        {drafts.length > 0 && <span className="cal3-rail__count">{drafts.length}</span>}
        <span className="cal3-rail__hint">drag onto the calendar, or use Move</span>
        <span className="cal3-rail__toggle">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15" /></svg>
        </span>
      </button>

      {/* Drag handle — only shown when expanded */}
      {!collapsed && (
        <div
          className="cal3-rail__resize"
          onPointerDown={handleResizeStart}
          aria-label="Drag to resize drafts panel"
          role="separator"
          aria-orientation="horizontal"
          title="Drag to resize"
        />
      )}

      {!collapsed && (
        <div className="cal3-rail__scroll" ref={scrollRef} style={scrollStyle}>
          {drafts.length === 0 ? (
            <div className="cal3-rail__empty">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
              </svg>
              No drafts yet — generate content in AI Studio or use Quick Post, and it will appear here.
            </div>
          ) : (
            drafts.map((draft) => (
              <DraftCard
                key={draft.id}
                draft={draft}
                isDragging={draggingId === draft.id}
                onOpen={onOpenDraft}
                onMoveTrigger={onMoveTrigger}
                onDragStart={(d) => setDraggingId(d.id)}
                onDragEnd={() => setDraggingId(null)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
