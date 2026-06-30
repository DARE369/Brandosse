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
}) {
  const [search, setSearch] = useState('');
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
              return (
                <button key={group.groupKey} type="button" className="post-row" onClick={() => onOpenGroup?.(group)}>
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
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
