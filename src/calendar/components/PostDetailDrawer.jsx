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
//
// POST-PRODUCTION CONSOLIDATION (this task): the caption/hashtag AI section
// used to run through auditPostCaption() (calendar-ai edge function's
// 'caption_audit' action — score/grade/issues/rewrite-variants/hashtag-
// suggestions). That's been replaced with the same discovery-score system
// Studio's PostProductionPanel uses (generate-post-metadata / seo-score /
// optimize-seo, via src/services/postProduction.service.js) so both surfaces
// share one scoring model instead of two divergent ones. "Suggest best
// times" (getSlotSuggestions) and the local-only readiness checklist
// (checkPublishReadiness) are untouched — they have no Studio equivalent and
// stay as Calendar-only value. Platform character limits now come from the
// shared platformCaptionSpecs.js (via PlatformFitStrip) instead of this
// file's own separate, previously-duplicated PLATFORM_CHAR_LIMITS map.
import { useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import { checkPublishReadiness, getSlotSuggestions } from '../../services/calendarAIService';
import {
  regeneratePostMetadata,
  scorePostSeo,
  optimizePostSeo,
  DEFAULT_DISCOVERY_SCORE,
} from '../../services/postProduction.service';
import { platformNeedsTitle } from '../../services/platforms/platformCaptionSpecs';
import PlatformFitStrip from '../../components/PostProduction/PlatformFitStrip';
import { isLockedForReschedule } from '../../utils/postStatusMachine';
import {
  addDaysToDateKey, formatDateKey, formatInTimeZone, getZonedDateKey, getZonedParts,
  weekStartKeyFor, zonedDateTimeToUTC,
} from '../../utils/timezone';

const WEEKDAY_OFFSET = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
import StatusPill from './StatusPill';

const PLATFORM_LABELS = {
  instagram: 'Instagram', tiktok: 'TikTok', linkedin: 'LinkedIn', x: 'X', youtube: 'YouTube', facebook: 'Facebook', pinterest: 'Pinterest',
};
const PLATFORM_VARS = {
  instagram: '--platform-instagram', tiktok: '--platform-tiktok-alt', linkedin: '--platform-linkedin',
  x: '--platform-x', youtube: '--platform-youtube', facebook: '--platform-facebook', pinterest: '--platform-pinterest',
};

function platformVar(p) { return `var(${PLATFORM_VARS[p] || '--color-text-tertiary'})`; }

const SCORE_DIMS = [
  ['readability', 'Readability'],
  ['hookStrength', 'Hook strength'],
  ['hashtagQuality', 'Hashtag quality'],
  ['brandConsistency', 'Brand consistency'],
  ['platformFit', 'Platform fit'],
];

function scoreColor(v) {
  if (v >= 85) return 'var(--uiv2-success)';
  if (v >= 65) return 'var(--uiv2-warning)';
  return 'var(--uiv2-danger)';
}

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
  onPostNow, // (post) => void — opens the Post now confirm in CalendarPage
}) {
  const posts = group?.posts || [];
  const [activePlatform, setActivePlatform] = useState(posts[0]?.platform || null);
  const [editedByPost, setEditedByPost] = useState({});
  const [connectedAccounts, setConnectedAccounts] = useState([]);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [bestTimes, setBestTimes] = useState(null);
  const [bestTimesLoading, setBestTimesLoading] = useState(false);
  const [bestTimesError, setBestTimesError] = useState(null);

  // Discovery score + regenerate — the Studio-shared model (see header note).
  const [discoveryScore, setDiscoveryScore] = useState(DEFAULT_DISCOVERY_SCORE);
  const [discoveryStatus, setDiscoveryStatus] = useState('idle'); // idle|scoring|optimizing|scored|failed
  const [discoveryError, setDiscoveryError] = useState(null);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [metadataError, setMetadataError] = useState(null);

  useEffect(() => {
    setActivePlatform(posts[0]?.platform || null);
    setEditedByPost({});
    setIsDirty(false);
    setBestTimes(null);
    setBestTimesError(null);
    setDiscoveryScore(DEFAULT_DISCOVERY_SCORE);
    setDiscoveryStatus('idle');
    setDiscoveryError(null);
    setMetadataError(null);
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
  const editedTitle = edited.title ?? activePost.title ?? '';
  const editedCaption = edited.caption ?? activePost.caption ?? '';
  const editedHashtags = edited.hashtags ?? activePost.hashtags ?? [];
  const editedDate = edited.date ?? toDateInputValue(activePost.scheduled_at, timezone);
  const editedTime = edited.time ?? toTimeInputValue(activePost.scheduled_at, timezone);
  const editedAccountId = edited.accountId ?? activePost.account_id ?? null;

  const selectedAccount = connectedAccounts.find((a) => a.id === editedAccountId) || null;
  const editedPlatform = selectedAccount?.platform || activePost.platform;
  const canReassign = activePost.status !== 'published' && connectedAccounts.length > 1;

  // Media lives on the joined `generations` row — Supabase can return a
  // to-one join as either an object or a single-element array depending on
  // how the relationship was inferred, so unwrap both (same defensive
  // pattern checkPublishReadiness already uses for this same join).
  const generationRow = Array.isArray(activePost?.generations) ? activePost.generations[0] : activePost?.generations;
  const mediaType = generationRow?.media_type || 'image';
  const needsTitle = platformNeedsTitle(editedPlatform, mediaType);

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
    // Stale-score invalidation — identical rule to Studio's
    // updatePostProduction: touching title/caption/hashtags means any
    // previously-shown discovery score no longer describes what's on screen.
    if ('title' in patch || 'caption' in patch || 'hashtags' in patch) {
      setDiscoveryStatus('idle');
    }
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      const updates = {
        title: editedTitle || null,
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

  // Full LLM regeneration of title/caption/hashtags — generate-post-metadata
  // self-persists to the posts row (server-owned workflow_state lifecycle,
  // same as Studio); the realtime subscription in useCalendarPosts picks up
  // that write independently of whether "Save changes" is later clicked.
  async function handleRegenerateMetadata() {
    setMetadataLoading(true);
    setMetadataError(null);
    try {
      const result = await regeneratePostMetadata(activePost.id, ['title', 'caption', 'hashtags']);
      patchEdited({
        title: String(result.title || editedTitle || '').trim(),
        caption: String(result.caption || editedCaption || '').trim(),
        hashtags: Array.isArray(result.hashtags) ? result.hashtags : editedHashtags,
      });
    } catch (err) {
      setMetadataError(err?.message || 'Could not regenerate right now.');
    } finally {
      setMetadataLoading(false);
    }
  }

  async function handleRescore() {
    if (!editedCaption.trim()) return;
    setDiscoveryStatus('scoring');
    setDiscoveryError(null);
    try {
      const score = await scorePostSeo({
        postId: activePost.id,
        title: editedTitle,
        caption: editedCaption,
        hashtags: editedHashtags,
        platform: editedPlatform,
        mediaType,
        visualPrompt: generationRow?.prompt || '',
      });
      setDiscoveryScore(score);
      setDiscoveryStatus('scored');
    } catch (err) {
      setDiscoveryStatus('failed');
      setDiscoveryError(err?.message || 'Scoring unavailable.');
    }
  }

  async function handleOptimize() {
    if (!editedCaption.trim()) return;
    setDiscoveryStatus('optimizing');
    setDiscoveryError(null);
    try {
      const result = await optimizePostSeo({
        postId: activePost.id,
        title: editedTitle,
        caption: editedCaption,
        hashtags: editedHashtags,
        platform: editedPlatform,
        mediaType,
        visualPrompt: generationRow?.prompt || '',
        brandKit,
      });
      patchEdited({
        title: result.optimizedTitle,
        caption: result.optimizedCaption,
        hashtags: result.optimizedHashtags,
      });
      setDiscoveryScore(result);
      setDiscoveryStatus('scored');
    } catch (err) {
      setDiscoveryStatus('failed');
      setDiscoveryError(err?.message || 'Optimization unavailable.');
    }
  }

  // Real slot-scoring via the calendar-ai edge function's slot_suggestions
  // action (same one week_plan/CommandBar already use) — not a fabricated
  // heuristic. Manual trigger (rather than firing on every drawer open) to
  // avoid a hidden LLM call each time a post is viewed.
  async function handleSuggestTimes() {
    setBestTimesLoading(true);
    setBestTimesError(null);
    try {
      const weekStart = weekStartKeyFor(editedDate || getZonedDateKey(new Date().toISOString(), timezone));
      const { suggestions } = await getSlotSuggestions({
        weekStart,
        platforms: [editedPlatform].filter(Boolean),
        existingPosts: [],
        brandKit,
        contentType: mediaType,
        count: 3,
      });
      setBestTimes(suggestions.slice(0, 3).map((s) => {
        const offset = WEEKDAY_OFFSET[s.day] ?? 0;
        const dateKey = addDaysToDateKey(weekStart, offset);
        return { ...s, dateKey };
      }));
    } catch (err) {
      setBestTimesError(err?.message || 'Could not load suggestions.');
    } finally {
      setBestTimesLoading(false);
    }
  }

  function handlePickBestTime(slot) {
    patchEdited({ date: slot.dateKey, time: slot.time });
  }

  const isPublished = primary.status === 'published';
  const isFailed = primary.status === 'failed';
  const isLocked = isLockedForReschedule(primary.status);
  const isDiscoveryBusy = discoveryStatus === 'scoring' || discoveryStatus === 'optimizing';

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

            {/* Title only shows when the active platform actually uses one
                (YouTube/Pinterest always; TikTok for photo posts) — mirrors
                Studio's PostProductionPanel showTitleField gate exactly. */}
            {needsTitle && (
              <label className="ui-field">
                <span className="ui-field-label">Title{posts.length > 1 ? ` — ${PLATFORM_LABELS[activePost.platform] || activePost.platform}` : ''}</span>
                <input
                  className="ui-input"
                  value={editedTitle}
                  onChange={(e) => patchEdited({ title: e.target.value })}
                  disabled={isPublished}
                />
              </label>
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
              <PlatformFitStrip
                platforms={[{ id: activePost.id, platform: editedPlatform, label: PLATFORM_LABELS[editedPlatform] || editedPlatform }]}
                caption={editedCaption}
                hashtags={editedHashtags}
                title={editedTitle}
                mediaType={mediaType}
                onAutoFit={(_platformKey, trimmed) => patchEdited({ caption: trimmed })}
              />
            )}

            {!isPublished && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  className="ui-button ui-button-ghost ui-button-sm"
                  style={{ width: 'fit-content' }}
                  onClick={handleRegenerateMetadata}
                  disabled={metadataLoading}
                >
                  <Sparkles size={12} aria-hidden="true" /> {metadataLoading ? 'Regenerating…' : 'Regenerate title & caption'}
                </button>
                {metadataError && <div className="ui-field-error">{metadataError}</div>}

                <div className="scope-note" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                    {/* LOCK L5.11 — see pages/Studio/PostProductionPanel.jsx for the full
                        reasoning. The score reads only the post's own text, has no
                        external signal, and cannot learn, so it must not be labelled
                        as a discovery prediction. */}
                    <span className="ui-field-label" style={{ margin: 0 }}>Copy review</span>
                    {isDiscoveryBusy ? (
                      <span>…</span>
                    ) : discoveryStatus === 'failed' ? (
                      <span style={{ color: 'var(--uiv2-text-secondary)' }}>—</span>
                    ) : discoveryStatus === 'scored' ? (
                      <span style={{ fontWeight: 700, color: scoreColor(discoveryScore.seoScore || 0) }}>{discoveryScore.seoScore ?? 0}</span>
                    ) : (
                      <span style={{ color: 'var(--uiv2-text-secondary)' }}>—</span>
                    )}
                  </div>

                  {discoveryStatus === 'scored' && discoveryScore.seoBreakdown && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {SCORE_DIMS.map(([key, label]) => {
                        const val = discoveryScore.seoBreakdown?.[key] ?? 0;
                        return (
                          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                            <span style={{ width: 100, color: 'var(--uiv2-text-secondary)' }}>{label}</span>
                            <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'var(--uiv2-bg-inset)', overflow: 'hidden' }}>
                              <div style={{ width: `${val}%`, height: '100%', background: scoreColor(val) }} />
                            </div>
                            <span style={{ width: 24, textAlign: 'right', fontFamily: 'var(--uiv2-font-mono)' }}>{val}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {discoveryError && <div className="ui-field-error">{discoveryError}</div>}

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="ui-button ui-button-ghost ui-button-sm" onClick={handleRescore} disabled={isDiscoveryBusy || !editedCaption.trim()}>
                      {discoveryStatus === 'scoring' ? 'Scoring…' : 'Re-score'}
                    </button>
                    <button type="button" className="ui-button ui-button-ghost ui-button-sm" onClick={handleOptimize} disabled={isDiscoveryBusy || !editedCaption.trim()}>
                      <Sparkles size={12} aria-hidden="true" /> {discoveryStatus === 'optimizing' ? 'Optimizing…' : 'Optimize for discovery'}
                    </button>
                  </div>
                </div>
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
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="ui-button ui-button-secondary ui-button-sm" onClick={() => onReschedule?.(activePost)} disabled={isLocked} style={{ width: 'fit-content' }}>
                  Open Schedule modal…
                </button>
                {!isLocked && (
                  <button type="button" className="ui-button ui-button-ghost ui-button-sm" onClick={handleSuggestTimes} disabled={bestTimesLoading} style={{ width: 'fit-content' }}>
                    <Sparkles size={12} aria-hidden="true" /> {bestTimesLoading ? 'Finding best times…' : 'Suggest best times'}
                  </button>
                )}
              </div>
              {bestTimesError && <p className="ui-field-error">{bestTimesError}</p>}
              {bestTimes && bestTimes.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="ui-field-hint">Suggested times — from your audience activity</span>
                  {bestTimes.map((slot, i) => (
                    <button
                      key={`${slot.day}-${slot.time}-${i}`}
                      type="button"
                      className="ui-button ui-button-secondary ui-button-sm"
                      onClick={() => handlePickBestTime(slot)}
                      style={{ justifyContent: 'space-between', width: '100%', textAlign: 'left' }}
                    >
                      <span>{formatDateKey(slot.dateKey, { weekday: 'short', month: 'short', day: 'numeric' })} at {slot.time}</span>
                      <span className="ui-field-hint" style={{ margin: 0 }}>{slot.reason || `Score ${slot.score}`}</span>
                    </button>
                  ))}
                </div>
              )}
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
          {(primary.status === 'scheduled' || primary.status === 'failed') && (
            <div className="post-drawer__footer-row">
              <button type="button" className="ui-button ui-button-primary ui-button-md" onClick={() => onPostNow?.(activePost)} style={{ width: '100%' }}>
                {primary.status === 'failed' ? 'Retry now' : 'Post now'}
              </button>
            </div>
          )}
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
