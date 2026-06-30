// QuickPostComposer — deliberately minimal, calendar-native creation path
// (CALENDAR_SPEC.md §6.3) — NOT a reimplementation of Generate Studio:
//   1. Pick zero or one existing Library asset (compact asset picker).
//   2. Platform toggles + one caption field per platform, pre-filled via
//      calendarService.generateQuickPostCaption() (the generate-post-metadata
//      wrapper, RESEARCH.md §4 — a plain service call, no Generate
//      Studio/AI Studio file touched).
//   3. Date/time (reuses ScheduleModal's account-timezone-explicit banner) or
//      save as draft.
//   4. On submit: creates the posts row(s) directly via calendarService —
//      one row per active platform, sharing one generation_id is NOT
//      applicable here since there is no upstream generation for a
//      Quick-Post-with-no-asset; createPost() is called once per platform
//      and (per RESEARCH §3.2) they are correctly rendered as independent
//      standalone cards by groupPostsByGeneration() when generation_id is
//      null on all of them — there is nothing to share a group key with.
//      (If a Library asset IS attached, all rows reuse that asset's
//      generation_id so they fan out into the platform-icon-stack group.)
import { useEffect, useRef, useState } from 'react';
import { FileText, FileImage, Sparkles } from 'lucide-react';
import { generateQuickPostCaption } from '../services/calendarService';
import { getZonedTodayKey, zonedDateTimeToUTC } from '../../utils/timezone';

const PLATFORMS = [
  { key: 'instagram', label: 'Instagram', varName: '--platform-instagram', limit: 2200 },
  { key: 'tiktok', label: 'TikTok', varName: '--platform-tiktok-alt', limit: 2200 },
  { key: 'linkedin', label: 'LinkedIn', varName: '--platform-linkedin', limit: 3000 },
  { key: 'x', label: 'X', varName: '--platform-x', limit: 280 },
];

export default function QuickPostComposer({
  open,
  timezone = 'UTC',
  libraryAssets = [], // [{ id, name, thumbnail_url, generation_id, media_type }]
  // Optional — Packet 2's Library "Schedule" hand-off (LIBRARY_SPEC.md §7).
  // When provided, step 1 ("Library asset") opens already pre-selected
  // instead of requiring the user to manually open the Asset Picker. Same
  // shape as a libraryAssets entry. Additive only — every existing caller
  // that doesn't pass this prop behaves exactly as before.
  prefillAsset = null,
  onClose,
  // ({ mode: 'draft'|'schedule', platforms, captions, asset, dateKey, timeStr }) => Promise<boolean>
  // Must resolve to `true` on success / `false` on failure (it owns the
  // outcome-accurate confirmation toast itself, via the page-level
  // ToastStack — see DECISIONS_LOG.md 2026-06-24 "Bug 1" for why this isn't
  // the composer's own job). The composer closes itself only when the
  // parent reports success; it stays open on failure so Sade can retry
  // without losing what she typed.
  onSubmit,
}) {
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState(prefillAsset || null);
  const [activePlatforms, setActivePlatforms] = useState(['instagram']);
  const [captions, setCaptions] = useState({});
  const [prefilling, setPrefilling] = useState({});
  const [dateKey, setDateKey] = useState(() => getZonedTodayKey(timezone));
  const [timeStr, setTimeStr] = useState('09:00');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Phase 4 QA fix (schedule hand-off composer race — see
  // DECISIONS_LOG.md, PersonalCalendarPage.jsx's own note on the same
  // fix). PersonalCalendarPage now opens this composer immediately and
  // lets prefillAsset arrive moments later via the asynchronous
  // fetchAssetForHandoff() call, instead of gating `open` behind that
  // fetch — so prefillAsset can change AFTER this component has already
  // mounted. useState(prefillAsset || null)'s initializer above only ever
  // runs once, on first mount, so without this sync effect a late-
  // arriving prefillAsset would never reach selectedAsset and Sade would
  // see the composer open with no asset selected, then nothing update —
  // the exact "no asset, no error, no indication anything happened"
  // symptom QA reported. Re-firing prefillCaption() for any active
  // platform that's still empty mirrors exactly what the existing
  // didMountPrefill effect below already does on open, and what
  // togglePlatform() already does when a platform is turned on after a
  // caption-worthy asset is already selected — same pattern, just also
  // triggered by the asset arriving late instead of only by mount/toggle.
  useEffect(() => {
    if (!prefillAsset) return;
    setSelectedAsset(prefillAsset);
    activePlatforms.forEach((key) => {
      if (!captions[key]) prefillCaption(key, prefillAsset);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillAsset]);

  // QA_PERSONA_REVIEW_build.md (2026-06-25 re-test, finding #1): Instagram is
  // pre-toggled active in useState's initializer above, but prefillCaption()
  // previously only ever fired from togglePlatform()'s explicit on-click
  // branch — so whichever platform(s) start active never got a pre-fill
  // unless the user toggled them off and back on. Fire the same
  // prefillCaption() once on mount for every platform that's active from
  // the start, mirroring exactly what togglePlatform() already does for a
  // newly-toggled-on platform (same guard: skip if it already has a
  // caption). Guarded with a ref so this never re-fires on re-renders.
  const didMountPrefill = useRef(false);
  useEffect(() => {
    if (!open || didMountPrefill.current) return;
    didMountPrefill.current = true;
    activePlatforms.forEach((key) => {
      if (!captions[key]) prefillCaption(key);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  function togglePlatform(key) {
    setActivePlatforms((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      if (!prev.includes(key) && !captions[key]) {
        prefillCaption(key);
      }
      return next;
    });
  }

  // assetOverride (optional): Phase 4 QA fix — the prefillAsset-sync effect
  // above calls setSelectedAsset(prefillAsset) and prefillCaption(key) in
  // the same tick; React's state batching means `selectedAsset` in this
  // closure would still read its OLD value (null, pre-hand-off) at call
  // time if this function only ever read `selectedAsset` directly, which
  // would silently produce the same generic "a new social media update"
  // prompt base the hand-off is specifically supposed to avoid. Every
  // existing call site (togglePlatform, the on-mount effect) omits this
  // argument and is therefore completely unaffected — selectedAsset is
  // already correctly committed by the time those call this function.
  async function prefillCaption(platformKey, assetOverride) {
    setPrefilling((prev) => ({ ...prev, [platformKey]: true }));
    try {
      const promptAsset = assetOverride || selectedAsset;
      const promptBase = promptAsset?.name || 'a new social media update';
      const result = await generateQuickPostCaption({
        prompt: `Write a ${platformKey} caption for a post about: ${promptBase}`,
        platform: platformKey,
        mediaType: promptAsset?.media_type || null,
      });
      setCaptions((prev) => ({ ...prev, [platformKey]: result.caption || prev[platformKey] || '' }));
    } catch (err) {
      console.error('[QuickPostComposer] caption pre-fill failed:', err);
      // Non-fatal — the field stays editable/blank; Solo Sade can always type
      // her own caption, per spec §9's "AI proposes, never blocks" pattern.
    } finally {
      setPrefilling((prev) => ({ ...prev, [platformKey]: false }));
    }
  }

  function handleSelectAsset(asset) {
    setSelectedAsset(asset);
    setAssetPickerOpen(false);
  }

  async function handleSubmit(mode) {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const payload = {
        mode,
        platforms: activePlatforms,
        captions,
        asset: selectedAsset,
        dateKey: mode === 'schedule' ? dateKey : null,
        timeStr: mode === 'schedule' ? timeStr : null,
        scheduledAtISO: mode === 'schedule' && dateKey && timeStr ? zonedDateTimeToUTC(dateKey, timeStr, timezone) : null,
      };
      // onSubmit is owned by the parent page (PersonalCalendarPage), which
      // pushes the real success/error toast onto the page-level ToastStack
      // (a component that does NOT unmount when this composer closes) and
      // reports back whether the save actually succeeded. Closing only on
      // a true success — and never closing on failure — is what lets the
      // confirmation toast actually survive long enough to paint, and what
      // keeps Sade's typed captions on screen to retry if the save failed.
      const ok = await onSubmit?.(payload);
      if (ok) {
        onClose?.();
      } else {
        setSubmitError('Could not save this post. Your captions and settings are still here — fix the issue and try again.');
      }
    } catch (err) {
      console.error('[QuickPostComposer] submit failed:', err);
      setSubmitError(err?.message || 'Could not save this post. Your captions and settings are still here — fix the issue and try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="quickpost-modal" role="dialog" aria-modal="true" aria-label="Quick Post">
        <div className="schedule-modal__header">
          <h3 className="schedule-modal__title">Quick Post</h3>
          <button type="button" className="ui-icon-button ui-icon-button-ghost ui-icon-button-sm" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <div className="quickpost-steps">
          <div>
            <p className="quickpost-step__label"><span className="quickpost-step__num">1</span>Library asset (optional)</p>
            {/* Phase 4 QA fix (schedule hand-off composer race, see
                DECISIONS_LOG.md): this was a real <button> wrapping another
                real <button> (the "Clear selected asset" control) whenever
                selectedAsset was set — invalid HTML that the static
                mockup's raw-HTML parser silently auto-corrected (browsers
                close the outer button early when parsing nested <button>
                tags from text), but that React renders as a genuine nested-
                button DOM node via the JSX/DOM APIs, producing a real
                hydration-validation error. The schedule hand-off's prefill
                path sets selectedAsset on first render, so this nested-
                button error fired on every single hand-off — its DOM/render
                disruption is what produced the "composer never visibly
                opens" symptom QA reproduced (confirmed live: the error
                appears in the console at the same moment the dialog
                becomes briefly unqueryable). Switched the outer element
                from <button> to a <div role="button" tabIndex={0}> with
                its own Enter/Space activation so it keeps identical
                click/keyboard/visual behavior (same className, same
                onClick) without violating HTML's no-interactive-content-
                in-button rule. The mockup's own markup has this same bug
                (mockups/mockup-gallery.html:1225-1229) — not deviating
                from anything intentionally approved, fixing a markup
                defect that happened to be invisible in raw HTML. */}
            <div
              className="asset-picker-trigger"
              role="button"
              tabIndex={0}
              onClick={() => setAssetPickerOpen(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setAssetPickerOpen(true);
                }
              }}
            >
              <span className="asset-picker-trigger__thumb">
                {selectedAsset?.thumbnail_url ? <img src={selectedAsset.thumbnail_url} alt="" /> : <FileText size={16} aria-hidden="true" />}
              </span>
              <span className="asset-picker-trigger__text">
                {selectedAsset ? selectedAsset.name : 'No asset — click to pick from Library (optional)'}
              </span>
              {selectedAsset && (
                <button
                  type="button"
                  className="ui-icon-button ui-icon-button-ghost ui-icon-button-sm asset-picker-trigger__clear"
                  aria-label="Clear selected asset"
                  onClick={(e) => { e.stopPropagation(); setSelectedAsset(null); }}
                >
                  &times;
                </button>
              )}
            </div>
          </div>

          <div>
            <p className="quickpost-step__label"><span className="quickpost-step__num">2</span>Platforms &amp; captions</p>
            <div className="platform-toggle-row">
              {PLATFORMS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={`platform-toggle${activePlatforms.includes(p.key) ? ' is-active' : ''}`}
                  onClick={() => togglePlatform(p.key)}
                >
                  <span className="platform-toggle__dot" style={{ background: `var(${p.varName})` }} />
                  {p.label}
                </button>
              ))}
            </div>

            <div className="per-platform-caption">
              {PLATFORMS.filter((p) => activePlatforms.includes(p.key)).map((p) => {
                const caption = captions[p.key] || '';
                return (
                  <div className="per-platform-caption__row" key={p.key}>
                    <div className="per-platform-caption__head">
                      <span className="platform-toggle__dot" style={{ background: `var(${p.varName})` }} />
                      {p.label} caption
                    </div>
                    {prefilling[p.key] ? (
                      <span className="ai-prefill-note"><Sparkles size={12} aria-hidden="true" /> Pre-filling…</span>
                    ) : caption && (
                      <span className="ai-prefill-note"><Sparkles size={12} aria-hidden="true" /> Pre-filled by AI — edit freely</span>
                    )}
                    <textarea
                      className="ui-textarea"
                      value={caption}
                      onChange={(e) => setCaptions((prev) => ({ ...prev, [p.key]: e.target.value }))}
                      placeholder={`Write a caption for ${p.label}…`}
                    />
                    <div className={`caption-counter${caption.length > p.limit ? ' is-over' : ''}`}>{caption.length} / {p.limit}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <p className="quickpost-step__label"><span className="quickpost-step__num">3</span>When</p>
            <div className="tz-banner">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
              Times shown in your account timezone: <strong>{timezone}</strong>
            </div>
            <div className="time-row" style={{ marginTop: 'var(--space-3)' }}>
              <input className="ui-input" type="date" value={dateKey} onChange={(e) => setDateKey(e.target.value)} aria-label="Date" style={{ maxWidth: 160 }} />
              <input className="ui-input" type="time" value={timeStr} onChange={(e) => setTimeStr(e.target.value)} aria-label="Time" />
              <span className="ui-field-hint">or save as draft below</span>
            </div>
          </div>
        </div>

        {submitError && <div className="ui-field-error" role="alert">{submitError}</div>}

        <div className="quickpost-footer">
          <button type="button" className="ui-button ui-button-secondary ui-button-md" disabled={isSubmitting} onClick={() => handleSubmit('draft')}>
            Save as draft
          </button>
          <div className="quickpost-footer__primary">
            <button type="button" className="ui-button ui-button-secondary ui-button-md" onClick={onClose} disabled={isSubmitting}>Cancel</button>
            <button type="button" className="ui-button ui-button-primary ui-button-md" disabled={isSubmitting || activePlatforms.length === 0} onClick={() => handleSubmit('schedule')}>
              Schedule post
            </button>
          </div>
        </div>
      </div>

      {assetPickerOpen && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setAssetPickerOpen(false); }}>
          <div className="schedule-modal" style={{ width: 'min(480px,100%)' }} role="dialog" aria-modal="true" aria-label="Pick a Library asset">
            <div className="schedule-modal__header">
              <h3 className="schedule-modal__title">Pick an asset</h3>
              <button type="button" className="ui-icon-button ui-icon-button-ghost ui-icon-button-sm" onClick={() => setAssetPickerOpen(false)} aria-label="Close">&times;</button>
            </div>
            <div className="schedule-modal__body">
              <input className="ui-input" type="search" placeholder="Search your Library…" aria-label="Search Library assets" />
              <div className="asset-grid">
                {libraryAssets.length === 0 && <p className="ui-field-hint">No Library assets yet.</p>}
                {libraryAssets.map((asset) => (
                  <div
                    key={asset.id}
                    className={`asset-tile${selectedAsset?.id === asset.id ? ' is-selected' : ''}`}
                    onClick={() => handleSelectAsset(asset)}
                    role="button"
                    tabIndex={0}
                  >
                    {asset.thumbnail_url ? <img src={asset.thumbnail_url} alt={asset.name} /> : <FileImage size={18} aria-hidden="true" />}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
