import { useMemo } from 'react';
import PlatformIcon from '../../components/Shared/PlatformIcon';

// Ambient weekly insights strip — sits below the header, above the grid.
// Shows post count, best-performing day, health score, and one stat-derived
// tip. The tip is plain local arithmetic (see generateLocalInsight below) —
// it is intentionally NOT presented as an AI feature (no sparkle, no
// "analysing" state), to keep it honestly distinct from the real AI features
// elsewhere on this page (caption audit, command bar).
//
// Platform glyphs reuse the same shared PlatformIcon component Settings'
// Connected Accounts already uses (src/components/Shared/PlatformIcon.jsx) —
// real lucide-react brand icons, not emoji. No new icon set introduced here.

function parseWeekStats(posts = []) {
  const scheduled  = posts.filter((p) => p.status === 'scheduled').length;
  const published  = posts.filter((p) => p.status === 'published').length;
  const failed     = posts.filter((p) => p.status === 'failed').length;

  // Best day by scheduled count
  const dayCounts = {};
  posts.forEach((p) => {
    if (!p.scheduled_at) return;
    const d = new Date(p.scheduled_at);
    const dow = d.toLocaleDateString('en-US', { weekday: 'short' });
    dayCounts[dow] = (dayCounts[dow] || 0) + 1;
  });
  const bestDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  // Platform breakdown (top 2)
  const platCounts = {};
  posts.forEach((p) => {
    if (p.platform) platCounts[p.platform] = (platCounts[p.platform] || 0) + 1;
  });
  const topPlatforms = Object.entries(platCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => k);

  // Naive health score: 0-100
  const total = posts.length;
  let health = 100;
  if (total === 0) health = 0;
  else {
    health = Math.max(0, Math.round(((published + scheduled) / total) * 100 - failed * 15));
  }

  return { scheduled, published, failed, total, bestDay, topPlatforms, health };
}

function HealthBadge({ score, total }) {
  if (total === 0) return <span className="cal3-strip__badge cal3-strip__badge--ok">Empty</span>;
  const grade = score >= 80 ? 'ok' : score >= 50 ? 'warn' : 'danger';
  const label = score >= 80 ? 'Healthy' : score >= 50 ? 'Review' : 'Issues';
  return (
    <span className={`cal3-strip__badge cal3-strip__badge--${grade}`}>
      {label}
    </span>
  );
}

export default function IntelligenceStrip({ posts = [], weekStart = null }) {
  const stats = parseWeekStats(posts);

  // Plain local computation — genuinely instant, so it's rendered
  // synchronously rather than behind a fake loading state.
  const insight = useMemo(() => generateLocalInsight(stats, posts, weekStart), [stats, posts, weekStart]);

  return (
    <div className="cal3-strip" role="complementary" aria-label="Week intelligence">

      {/* Scheduled count */}
      <div className="cal3-strip__item">
        <div className="cal3-strip__icon">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <rect x="3" y="4" width="18" height="18" rx="2"/>
            <line x1="3" y1="9" x2="21" y2="9"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
          </svg>
        </div>
        <span className="cal3-strip__label">Scheduled</span>
        <span className="cal3-strip__value">{stats.scheduled}</span>
      </div>

      {/* Published count */}
      <div className="cal3-strip__item">
        <div className="cal3-strip__icon" style={{ background: 'color-mix(in srgb,var(--color-success) 15%,transparent)', color: 'var(--color-success-text)' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <span className="cal3-strip__label">Published</span>
        <span className="cal3-strip__value">{stats.published}</span>
      </div>

      {/* Failed count (only show if > 0) */}
      {stats.failed > 0 && (
        <div className="cal3-strip__item">
          <div className="cal3-strip__icon" style={{ background: 'color-mix(in srgb,var(--color-danger) 15%,transparent)', color: 'var(--color-danger-text)' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <span className="cal3-strip__label">Failed</span>
          <span className="cal3-strip__value" style={{ color: 'var(--cal3-clr-failed)' }}>{stats.failed}</span>
        </div>
      )}

      {/* Best day */}
      {stats.bestDay && (
        <div className="cal3-strip__item">
          <div className="cal3-strip__icon">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          </div>
          <span className="cal3-strip__label">Most active</span>
          <span className="cal3-strip__value">{stats.bestDay}</span>
        </div>
      )}

      {/* Platform breakdown */}
      {stats.topPlatforms.length > 0 && (
        <div className="cal3-strip__item">
          <span className="cal3-strip__label">Platforms</span>
          {stats.topPlatforms.map((p) => (
            <PlatformIcon key={p} platform={p} size="xs" />
          ))}
        </div>
      )}

      {/* Health score */}
      <div className="cal3-strip__item">
        <span className="cal3-strip__label">Health</span>
        <HealthBadge score={stats.health} total={stats.total} />
      </div>

      {/* Stat-derived tip — plain local logic, deliberately not styled as AI */}
      <div className="cal3-strip__tip">
        <span className="cal3-strip__tip-text">{insight}</span>
      </div>

    </div>
  );
}

// ── Local insight generator (no API call) ─────────────────────────────────────
function generateLocalInsight(stats, posts, weekStart) {
  if (stats.total === 0) return 'No posts this week yet — drag drafts onto the grid to start scheduling.';

  const msgs = [];

  if (stats.failed > 0) {
    msgs.push(`${stats.failed} post${stats.failed > 1 ? 's' : ''} failed to publish — review them to reschedule.`);
  }

  if (stats.scheduled > 0 && stats.published === 0) {
    msgs.push(`${stats.scheduled} post${stats.scheduled > 1 ? 's' : ''} queued for this week — looking sharp.`);
  }

  if (stats.health === 100) {
    msgs.push('Perfect week — every post published successfully.');
  }

  // Spacing insight
  if (posts.length >= 2) {
    const dates = posts
      .filter((p) => p.scheduled_at)
      .map((p) => new Date(p.scheduled_at).getTime())
      .sort((a, b) => a - b);

    let allOnSameDay = false;
    if (dates.length >= 2) {
      const firstDay = new Date(dates[0]).toDateString();
      allOnSameDay = dates.every((d) => new Date(d).toDateString() === firstDay);
    }
    if (allOnSameDay) msgs.push('All posts land on the same day — spacing them out may improve reach.');
  }

  // Platform diversity
  if (stats.topPlatforms.length === 1 && stats.total >= 3) {
    msgs.push(`All posts are on ${stats.topPlatforms[0]} — cross-posting could expand your audience.`);
  }

  return msgs[0] || `${stats.total} post${stats.total > 1 ? 's' : ''} planned — stay consistent and keep it up.`;
}
