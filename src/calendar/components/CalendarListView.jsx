// CalendarListView — Agenda/List view (CALENDAR_SPEC.md §3): "Flat,
// filterable, the accessible/mobile-first fallback. Same data, same
// PostCard, different layout — not a separate query." Below ~600px this is
// the default view (mockup's Fix 1 / MOBILE_UX_CRITIQUE.md), though Month
// stays one tap away always.
//
// Reschedule mode 2 (full detail-panel edit) is reachable by clicking any
// row. Mode 3 (tap-to-select -> tap-destination) is intentionally NOT wired
// here per the approved mockup (MOBILE_PARITY.md's spot-check explicitly
// found "List/Agenda view's missing lighter Move path... judged non-blocking
// ... the heavier drawer fallback genuinely works as a substitute" — see
// DECISIONS_LOG.md, qa-persona-agent final re-test). Rows are still
// satisfying WCAG 2.5.7 since opening the drawer and editing the date/time
// fields is a real, always-available single-pointer path.
import { useMemo, useState } from 'react';
import { getZonedDateKey } from '../../utils/timezone';
import StatusPill from './StatusPill';

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

function groupDayLabel(dayKey, todayKey, tomorrowKey, formatDateKey) {
  if (dayKey === todayKey) return `Today — ${formatDateKey(dayKey, { weekday: 'short', month: 'short', day: 'numeric' })}`;
  if (dayKey === tomorrowKey) return `Tomorrow — ${formatDateKey(dayKey, { weekday: 'short', month: 'short', day: 'numeric' })}`;
  return formatDateKey(dayKey, { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function CalendarListView({
  groups = [],
  isLoading = false,
  timezone = 'UTC',
  todayKey,
  tomorrowKey,
  formatDateKey,
  formatInTimeZone,
  onOpenGroup,
  // LOCK L5.5 — bulk operations. Every calendar action worked on exactly one
  // post, which is the first thing a Power Migrant coming from Publer or Buffer
  // reaches for and does not find (audit findings P2-005/006).
  onBulkReschedule,
  onBulkDelete,
}) {
  const [search, setSearch] = useState('');
  // Keyed by groupKey, because a "row" here is a GROUP of posts (one piece of
  // content fanned out to several platforms). Selecting a row must act on every
  // post in it, or a cross-posted item would be half-rescheduled.
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [platformFilter, setPlatformFilter] = useState('all');

  const dayGroups = useMemo(() => {
    const filtered = groups.filter((group) => {
      const primary = group.posts[0];
      if (!primary) return false;
      if (statusFilter !== 'all' && primary.status !== statusFilter) return false;
      if (platformFilter !== 'all' && !group.posts.some((p) => p.platform === platformFilter)) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const text = `${primary.title || ''} ${primary.caption || ''}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });

    const byDay = new Map();
    filtered.forEach((group) => {
      const primary = group.posts[0];
      const key = primary.scheduled_at ? getZonedDateKey(primary.scheduled_at, timezone) : 'undated';
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(group);
    });

    return Array.from(byDay.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([dayKey, dayItems]) => ({ dayKey, items: dayItems }));
  }, [groups, statusFilter, platformFilter, search, timezone]);

  // ── LOCK L5.5 — bulk selection ────────────────────────────────────────────
  //
  // Selection is pruned to what is currently VISIBLE. Without this, filtering
  // to "failed", selecting rows, then clearing the filter would silently act on
  // posts the user can no longer see — and a bulk delete is precisely the wrong
  // place for an invisible selection.
  const visibleKeys = useMemo(
    () => new Set(dayGroups.flatMap(({ items }) => items.map((g) => g.groupKey))),
    [dayGroups],
  );
  const effectiveSelected = useMemo(
    () => [...selectedKeys].filter((k) => visibleKeys.has(k)),
    [selectedKeys, visibleKeys],
  );
  const selectedCount = effectiveSelected.length;

  const selectedGroups = useMemo(() => {
    const byKey = new Map(dayGroups.flatMap(({ items }) => items.map((g) => [g.groupKey, g])));
    return effectiveSelected.map((k) => byKey.get(k)).filter(Boolean);
  }, [dayGroups, effectiveSelected]);

  const toggleKey = (groupKey) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  const clearSelection = () => setSelectedKeys(new Set());

  const runBulk = async (fn) => {
    if (bulkBusy || selectedGroups.length === 0) return;
    setBulkBusy(true);
    try {
      await fn(selectedGroups);
      clearSelection();
    } finally {
      // Always clear busy, even if the handler threw — otherwise one failure
      // leaves the bar permanently disabled with no way back.
      setBulkBusy(false);
    }
  };

  return (
    <div className="agenda-view">
      <div className="agenda-filterbar">
        <input
          className="ui-input agenda-filterbar__search"
          type="search"
          placeholder="Search posts…"
          aria-label="Search posts"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="ui-select" style={{ width: 'auto' }} aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="scheduled">Scheduled</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="failed">Failed</option>
        </select>
        <select className="ui-select" style={{ width: 'auto' }} aria-label="Filter by platform" value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}>
          <option value="all">All platforms</option>
          <option value="instagram">Instagram</option>
          <option value="tiktok">TikTok</option>
          <option value="linkedin">LinkedIn</option>
          <option value="x">X</option>
          <option value="youtube">YouTube</option>
          <option value="facebook">Facebook</option>
          <option value="pinterest">Pinterest</option>
        </select>
      </div>

      <div className="agenda-scroll">
        {isLoading && (
          <>
            <div className="skel-row"><span className="skel skel-thumb" /><span className="skel-lines"><span className="skel skel-line w-65" /><span className="skel skel-line w-40" /></span></div>
            <div className="skel-row"><span className="skel skel-thumb" /><span className="skel-lines"><span className="skel skel-line w-65" /><span className="skel skel-line w-40" /></span></div>
          </>
        )}

        {!isLoading && dayGroups.length === 0 && (
          <p className="ui-field-hint" style={{ padding: 'var(--space-5)', textAlign: 'center' }}>No posts match these filters.</p>
        )}

        {!isLoading && dayGroups.map(({ dayKey, items }) => (
          <div className="agenda-day-group" key={dayKey}>
            <p className="agenda-day-group__label">
              {dayKey === 'undated' ? 'Drafts (no date set)' : groupDayLabel(dayKey, todayKey, tomorrowKey, formatDateKey)}
            </p>
            {items.map((group) => {
              const primary = group.posts[0];
              const platforms = [...new Set(group.posts.map((p) => p.platform).filter(Boolean))];
              const timeLabel = primary.scheduled_at
                ? formatInTimeZone(primary.scheduled_at, timezone, { hour: 'numeric', minute: '2-digit', hour12: true })
                : '';
              const isSelected = selectedKeys.has(group.groupKey);
              return (
                <div
                  key={group.groupKey}
                  className={`post-row-wrap${isSelected ? ' is-selected' : ''}`}
                >
                  {/* LOCK L5.5 — the checkbox is a SIBLING of the row button,
                      not a child: a checkbox nested inside a <button> is invalid
                      HTML and cannot be clicked independently of the row. */}
                  {(onBulkReschedule || onBulkDelete) ? (
                    <input
                      type="checkbox"
                      className="post-row__select"
                      checked={isSelected}
                      onChange={() => toggleKey(group.groupKey)}
                      aria-label={`Select ${primary.title || primary.caption?.slice(0, 40) || 'post'}`}
                    />
                  ) : null}
                <button type="button" className="post-row" onClick={() => onOpenGroup?.(group)}>
                  <span className="post-row__thumb">
                    {primary.generations?.storage_path ? (
                      // Same media_type branch PostDetailDrawer.jsx already
                      // uses (QA_PERSONA_REVIEW_build.md 2026-06-25 re-test,
                      // finding #2 — video assets rendered as a broken <img>
                      // here before this fix).
                      primary.generations.media_type === 'video'
                        ? <video src={primary.generations.storage_path} muted playsInline />
                        : <img src={primary.generations.storage_path} alt="" />
                    ) : '\u{1F4C4}'}
                  </span>
                  <span className="post-row__body">
                    <span className="post-row__title">{primary.title || primary.caption?.slice(0, 60) || 'Untitled'}</span>
                    <span className="post-row__meta">
                      <StatusPill status={primary.status} />
                      {platforms.length > 1 ? (
                        <span className="post-row__platform-stack">
                          {platforms.map((p) => <span key={p} className="post-card__platform-dot" style={{ background: platformVar(p) }} />)}
                        </span>
                      ) : platforms[0] ? ` · ${platforms[0]}` : ''}
                      {timeLabel ? ` · ${timeLabel}` : ''}
                      {primary.status === 'failed' ? ' · retry or reschedule from the drawer' : ''}
                    </span>
                  </span>
                </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/*
        LOCK L5.5 — the bulk action bar.
        Appears only when something is selected, so it never occupies space it
        has not earned. Counts are taken from the VISIBLE selection, so the
        number shown is always the number that will actually be acted on.
      */}
      {selectedCount > 0 && (onBulkReschedule || onBulkDelete) ? (
        <div className="agenda-bulkbar" role="region" aria-label="Bulk actions">
          <span className="agenda-bulkbar__count">
            {selectedCount} selected
          </span>

          {onBulkReschedule ? (
            <>
              <button
                type="button"
                className="ui-button ui-button-ghost ui-button-sm"
                disabled={bulkBusy}
                onClick={() => runBulk((g) => onBulkReschedule(g, 1))}
              >
                +1 day
              </button>
              <button
                type="button"
                className="ui-button ui-button-ghost ui-button-sm"
                disabled={bulkBusy}
                onClick={() => runBulk((g) => onBulkReschedule(g, 7))}
              >
                +1 week
              </button>
            </>
          ) : null}

          {onBulkDelete ? (
            <button
              type="button"
              className="ui-button ui-button-ghost ui-button-sm agenda-bulkbar__danger"
              disabled={bulkBusy}
              onClick={() => runBulk((g) => onBulkDelete(g))}
            >
              Delete
            </button>
          ) : null}

          <button
            type="button"
            className="ui-button ui-button-ghost ui-button-sm"
            disabled={bulkBusy}
            onClick={clearSelection}
          >
            Clear
          </button>
        </div>
      ) : null}
    </div>
  );
}
