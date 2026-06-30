// PostDetailDrawer — refactored from v3/PostPanel.jsx (AS_IS_AUDIT.md §3.4).
// Per-platform caption tabs for grouped/fanned-out posts (spec §4), asset
// preview, the platform/account-reassignment dropdown (KEPT per the
// human-confirmed 2026-06-23 decision in DECISIONS_LOG.md, despite being
// additive beyond CALENDAR_SPEC.md's literal text), and the readiness
// checklist carried over from PostPanel.jsx's pattern (computed once, shared
// by the checklist UI and the Save button's label).
//
// Reschedule mode 2 (full detail-panel date/time edit) lives in the
// "Reschedule" section — a real, always-available single-pointer path,
// independent of drag or tap-to-select.
//
// Personal scope only: no pipeline-approval-history section is rendered
// (spec says that's org-only) — a short scope note explains why, matching
// the approved mockup's `.scope-note` treatment exactly.
import { useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import { auditPostCaption, checkPublishReadiness } from '../../services/calendarAIService';
import { isLockedForReschedule } from '../../utils/postStatusMachine';
import { formatInTimeZone, getZonedDateKey, getZonedParts, zonedDateTimeToUTC } from '../../utils/timezone';
import StatusPill from './StatusPill';

const PLATFORM_CHAR_LIMITS = {
  x: 280, instagram: 2200, tiktok: 2200, linkedin: 3000, youtube: 5000, facebook: 63206,
};
const PLATFORM_LABELS = {
  instagram: 'Instagram', tiktok: 'TikTok', linkedin: 'LinkedIn', x: 'X', youtube: 'YouTube', facebook: 'Facebook', pinterest: 'Pinterest',
};
const PLATFORM_VARS = {
  instagram: '--platform-instagram', tiktok: '--platform-tiktok-alt', linkedin: '--platform-linkedin',
  x: '--platform-x', youtube: '--platform-youtube', facebook: '--platform-facebook', pinterest: '--platform-pinterest',
};

function platformVar(p) { return `var(${PLATFORM_VARS[p] || '--color-text-tertiary'})`; }

function toDateInputValue(iso, timezone) {
  if (!iso) return '';
  return getZonedDateKey(iso, timezone);
}
function toTimeInputValue(iso, timezone) {
  if (!iso) return '';
  const { hour, minute } = getZonedParts(iso, timezone);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
function combineDateAndTime(dateStr, timeStr, timezone) {
  if (!dateStr || !timeStr) return null;
  return zonedDateTimeToUTC(dateStr, timeStr, timezone);
}

export default function PostDetailDrawer({
  group,
  timezone = 'UTC',
  brandKit = null,
  onClose,
  onSavePost, // (post, updates) => Promise
  onDeletePost, // (post) => Promise
  onReschedule, // (post) => void — opens ScheduleModal
  onUnschedule, // (post) => Promise
  onDuplicate, // (post) => Promise
}) {
  const posts = group?.posts || [];
  const [activePlatform, setActivePlatform] = useState(posts[0]?.platform || null);
  const [editedByPost, setEditedByPost] = useState({});
  const [connectedAccounts, setConnectedAccounts] = useState([]);
  const [audit, setAudit] = useState(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setActivePlatform(posts[0]?.platform || null);
    setEditedByPost({});
    setAudit(null);
    setAuditError(null);
    setIsDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.groupKey]);

  useEffect(() => {
    let mounted = true;
    async function fetchAccounts() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data, error } = await supabase
          .from('connected_accounts')
          .select('id, platform, account_name, avatar_url, connection_status')
          .eq('user_id', user.id)
          .in('connection_status', ['active', 'mock', 'expired'])
          .order('platform');
        if (error) throw error;
        if (mounted) setConnectedAccounts(data || []);
      } catch (err) {
        console.error('PostDetailDrawer fetchAccounts:', err);
      }
    }
    fetchAccounts();
    return () => { mounted = false; };
  }, []);

  if (!posts.length) return null;

  const activePost = posts.find((p) => p.platform === activePlatform) || posts[0];
  const edited = editedByPost[activePost.id] || {};
  const editedCaption = edited.caption ?? activePost.caption ?? '';
  const editedHashtags = edited.hashtags ?? activePost.hashtags ?? [];
  const editedDate = edited.date ?? toDateInputValue(activePost.scheduled_at, timezone);
  const editedTime = edited.time ?? toTimeInputValue(activePost.scheduled_at, timezone);
  const editedAccountId = edited.accountId ?? activePost.account_id ?? null;

  const selectedAccount = connectedAccounts.find((a) => a.id === editedAccountId) || null;
  const editedPlatform = selectedAccount?.platform || activePost.platform;
  const charLimit = PLATFORM_CHAR_LIMITS[editedPlatform] ?? 2200;
  const captionOver = editedCaption.length > charLimit;
  const canReassign = activePost.status !== 'published' && connectedAccounts.length > 1;

  const currentPostForReadiness = {
    ...activePost,
    caption: editedCaption,
    hashtags: editedHashtags,
    platform: editedPlatform,
    scheduled_at: combineDateAndTime(editedDate, editedTime, timezone) || activePost.scheduled_at,
  };
  const readiness = checkPublishReadiness(currentPostForReadiness);

  const primary = posts[0];
  const groupLabel = primary.title || primary.caption?.slice(0, 60) || 'Post details';
  const scheduledLabel = primary.scheduled_at
    ? `${formatInTimeZone(primary.scheduled_at, timezone, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })} (${timezone})`
    : 'Not scheduled';

  function patchEdited(patch) {
    setEditedByPost((prev) => ({ ...prev, [activePost.id]: { ...prev[activePost.id], ...patch } }));
    setIsDirty(true);
    setAudit(null);
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      const updates = {
        caption: editedCaption,
        hashtags: editedHashtags,
        scheduled_at: combineDateAndTime(editedDate, editedTime, timezone) || activePost.scheduled_at,
        ...(selectedAccount ? { account_id: selectedAccount.id, platform: selectedAccount.platform } : {}),
      };
      await onSavePost?.(activePost, updates);
      setIsDirty(false);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRunAudit() {
    if (!editedCaption.trim()) return;
    setAuditLoading(true);
    setAuditError(null);
    try {
      const result = await auditPostCaption({ ...activePost, caption: editedCaption, hashtags: editedHashtags }, brandKit);
      setAudit({ ...result, originalCaption: editedCaption });
    } catch (err) {
      setAuditError(err?.message || 'Audit failed. Check your connection.');
    } finally {
      setAuditLoading(false);
    }
  }

  function handleApplyFix(fix) {
    patchEdited({ caption: fix.caption, hashtags: fix.hashtags });
  }

  const isPublished = primary.status === 'published';
  const isFailed = primary.status === 'failed';
  const isLocked = isLockedForReschedule(primary.status);

  return (
    <div className="drawer-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <aside className="post-drawer" role="dialog" aria-modal="true" aria-label="Post details">
        <div className="post-drawer__header">
          <div className="post-drawer__title-group">
            <h3 className="post-drawer__title">{groupLabel}</h3>
            <StatusPill status={primary.status} suffix={<span style={{ marginLeft: 4 }}>&mdash; {scheduledLabel}</span>} />
          </div>
          <button type="button" className="ui-icon-button ui-icon-button-ghost ui-icon-button-sm" onClick={onClose} aria-label="Close drawer">&times;</button>
        </div>

        <div className="post-drawer__body">
          {primary.generations?.storage_path && (
            <div className="post-drawer__section">
              <span className="post-drawer__section-label">Asset preview</span>
              <div className="media-preview">
                {primary.generations.media_type === 'video'
                  ? <video src={primary.generations.storage_path} controls />
                  : <img src={primary.generations.storage_path} alt={groupLabel} />}
              </div>
            </div>
          )}

          <div className="post-drawer__section">
            <span className="post-drawer__section-label">
              {posts.length > 1 ? 'Platforms in this group (shared generation_id)' : 'Caption'}
            </span>

            {posts.length > 1 && (
              <div className="platform-tabs" data-platform-tab-group>
                {posts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`platform-tab${p.platform === activePlatform ? ' is-active' : ''}`}
                    onClick={() => setActivePlatform(p.platform)}
                  >
                    <span className="platform-tab__dot" style={{ background: platformVar(p.platform) }} />
                    {PLATFORM_LABELS[p.platform] || p.platform}
                  </button>
                ))}
              </div>
            )}

            <label className="ui-field">
              <span className="ui-field-label">Caption{posts.length > 1 ? ` — ${PLATFORM_LABELS[activePost.platform] || activePost.platform}` : ''}</span>
              <textarea
                className="ui-textarea"
                value={editedCaption}
                onChange={(e) => patchEdited({ caption: e.target.value })}
                placeholder="Write your caption…"
                disabled={isPublished}
                rows={4}
              />
            </label>
            <div className={`caption-counter${captionOver ? ' is-over' : ''}`}>{editedCaption.length} / {charLimit}</div>

            {editedHashtags.length > 0 && (
              <div className="hashtag-wrap">
                {editedHashtags.map((tag) => (
                  <span key={tag} className="hashtag-chip">
                    {tag}
                    {!isPublished && (
                      <button type="button" onClick={() => patchEdited({ hashtags: editedHashtags.filter((t) => t !== tag) })} aria-label={`Remove ${tag}`}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}

            {!isPublished && (
              <div>
                {auditLoading ? (
                  <span className="ui-field-hint">Auditing caption…</span>
                ) : audit ? (
                  <div className="ui-field-hint">
                    Score {audit.score} ({audit.grade})
                    {audit.fixedCaption && audit.fixedCaption !== audit.originalCaption && (
                      <button type="button" className="ui-button ui-button-ghost ui-button-sm" style={{ marginLeft: 8 }} onClick={() => handleApplyFix(audit)}>
                        <Sparkles size={12} aria-hidden="true" /> Apply AI fix
                      </button>
                    )}
                  </div>
                ) : (
                  <button type="button" className="ui-button ui-button-ghost ui-button-sm" onClick={handleRunAudit} disabled={!editedCaption.trim()}>
                    <Sparkles size={12} aria-hidden="true" /> Audit caption
                  </button>
                )}
                {auditError && <div className="ui-field-error">{auditError}</div>}
              </div>
            )}
          </div>

          <div className="post-drawer__section">
            <span className="post-drawer__section-label">Account &amp; platform{posts.length > 1 ? ` (currently editing: ${PLATFORM_LABELS[activePost.platform] || activePost.platform} tab)` : ''}</span>
            {canReassign ? (
              <div className="reassign-row">
                <select
                  className="ui-select"
                  aria-label="Reassign connected account"
                  value={editedAccountId || ''}
                  onChange={(e) => patchEdited({ accountId: e.target.value || null })}
                >
                  {connectedAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {PLATFORM_LABELS[acc.platform] || acc.platform}{acc.account_name ? ` — ${acc.account_name}` : ''}{acc.connection_status === 'expired' ? ' (expired)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <span className="ui-field-hint">{PLATFORM_LABELS[activePost.platform] || activePost.platform}</span>
            )}
            <p className="ui-field-hint">Reassigning here changes which connected account this platform&apos;s row publishes from.</p>
          </div>

          {!isPublished && (
            <div className="post-drawer__section">
              <span className="post-drawer__section-label">Reschedule (full detail-panel edit)</span>
              <div className="time-row">
                <input className="ui-input" type="date" value={editedDate} onChange={(e) => patchEdited({ date: e.target.value })} aria-label="Scheduled date" style={{ maxWidth: 160 }} disabled={isLocked} />
                <input className="ui-input" type="time" value={editedTime} onChange={(e) => patchEdited({ time: e.target.value })} aria-label="Scheduled time" disabled={isLocked} />
                <span className="ui-field-hint">{timezone}</span>
              </div>
              {isLocked && <p className="ui-field-hint">{primary.status === 'publishing' ? 'Publishing now — can’t be rescheduled.' : 'Published posts can’t be rescheduled — duplicate to a new draft instead.'}</p>}
              <button type="button" className="ui-button ui-button-secondary ui-button-sm" onClick={() => onReschedule?.(activePost)} disabled={isLocked} style={{ width: 'fit-content' }}>
                Open Schedule modal…
              </button>
            </div>
          )}

          <div className="post-drawer__section">
            <span className="post-drawer__section-label">Readiness</span>
            <div className="checklist">
              {readiness.checks.map((c) => (
                <div key={c.id} className={`check-item ${c.pass ? 'pass' : c.severity === 'error' ? 'fail' : 'warn'}`}>
                  <span className={`check-icon ${c.pass ? 'pass' : c.severity === 'error' ? 'fail' : 'warn'}`}>{c.pass ? '✓' : c.severity === 'error' ? '✕' : '!'}</span>
                  <span>{c.label}</span>
                </div>
              ))}
            </div>
            <p className="scope-note">Pipeline approval history is an org-only section (not shown here — personal scope has no approval gate).</p>
          </div>

          {isFailed && primary.failure_reason && (
            <div className="post-drawer__section">
              <span className="post-drawer__section-label" style={{ color: 'var(--color-danger-text)' }}>Failure reason</span>
              <p style={{ color: 'var(--color-danger-text)', fontSize: 'var(--text-sm)', margin: 0 }}>{primary.failure_reason}</p>
            </div>
          )}
        </div>

        <div className="post-drawer__footer">
          <div className="post-drawer__footer-row">
            <button type="button" className="ui-button ui-button-secondary ui-button-md" onClick={handleSave} disabled={!isDirty || isSaving}>
              {isSaving ? 'Saving…' : isDirty ? 'Save changes' : readiness.canPublish ? 'Saved' : 'Incomplete'}
            </button>
            <button type="button" className="ui-button ui-button-primary ui-button-md" onClick={() => onReschedule?.(activePost)} disabled={isLocked}>
              Reschedule…
            </button>
          </div>
          <div className="post-drawer__footer-row">
            <button type="button" className="ui-button ui-button-secondary ui-button-md" onClick={() => onDuplicate?.(activePost)}>Duplicate</button>
            {!isPublished && !isLocked && (
              <button type="button" className="ui-button ui-button-danger ui-button-md" onClick={() => onUnschedule?.(activePost)}>Unschedule</button>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
