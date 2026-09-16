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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, FileImage, Sparkles } from 'lucide-react';
import { generateQuickPostCaption } from '../services/calendarService';
import { supabase } from '../../services/supabaseClient';
import { getZonedTodayKey, zonedDateTimeToUTC } from '../../utils/timezone';
import {
  getPlatformSpec,
  platformNeedsTitle,
  platformsRequiringMedia,
} from '../../services/platforms/platformCaptionSpecs';
import { checkScheduleFloor, seedFromNow } from '../scheduleSeed';
import { SCORE_STATE, bandFor, scoreDestinations } from '../discoveryScore';
import { previewFor } from '../platformPreview';
import { scorePostSeo } from '../../services/postProduction.service';
import TikTokOptionsPanel from '../../components/Publishing/TikTokOptionsPanel';
import YouTubeOptionsPanel from '../../components/Publishing/YouTubeOptionsPanel';
import { useAuth } from '../../Context/AuthContext';
import { fetchUserSettings } from '../../services/userSettingsService';

/**
 * Presentation metadata ONLY — label and brand colour.
 *
 * The caption ceiling deliberately does NOT live here. It used to, as a second
 * hardcoded table beside platformCaptionSpecs.captionMax. The two agreed on
 * every platform the day they were written and nothing whatsoever kept them
 * agreeing, so the counter in front of the user could drift away from the limit
 * the adapter enforces — and the adapter REFUSES rather than truncating
 * (tiktok.service.ts:203-210), so drift means a post rejected at send time
 * against a counter that said it fit. One table now: getPlatformSpec().
 *
 * This is deliberately not the list of platforms the composer offers. It used
 * to be, and that was wrong in both directions at once: it offered Instagram
 * and X, neither of which has a publishing adapter, while omitting YouTube,
 * which does and which the user had connected. A user could compose a post for
 * a platform that could never publish it, and could not compose one for a
 * platform that could.
 *
 * What is offered is now derived from connected_accounts_health_summary —
 * see usePublishablePlatforms below. A platform appears here only to say how
 * it should LOOK once something else has established that it works.
 */
const PLATFORM_PRESENTATION = {
  instagram: { label: 'Instagram', varName: '--platform-instagram' },
  tiktok:    { label: 'TikTok',    varName: '--platform-tiktok-alt' },
  linkedin:  { label: 'LinkedIn',  varName: '--platform-linkedin' },
  x:         { label: 'X',         varName: '--platform-x' },
  youtube:   { label: 'YouTube',   varName: '--platform-youtube' },
  facebook:  { label: 'Facebook',  varName: '--platform-facebook' },
  pinterest: { label: 'Pinterest', varName: '--platform-pinterest' },
};

/** The limit the adapter will actually enforce, for the counter in front of the user. */
const captionLimitFor = (key) => getPlatformSpec(key).captionMax;

/**
 * Platforms whose adapter HARD-REFUSES a post that arrives without per-post
 * settings, and which therefore must collect them before this composer will
 * send. Not a style preference — each entry is a refusal already in the code:
 *
 *   tiktok  — tiktok.service.ts:195-200  "No TikTok privacy level was chosen
 *             for this post." privacy_level is deliberately undefaulted because
 *             TikTok's guidelines require the user to choose it.
 *   youtube — youtube.service.ts:254-259  refuses when made_for_kids is null,
 *             because it is a COPPA declaration this product must not make on
 *             someone's behalf.
 *
 * Both refusals are asserted against the adapters by
 * scripts/check-composer-field-contract.cjs, so this list cannot quietly fall
 * behind them in either direction.
 */
export const PLATFORMS_WITH_REQUIRED_FIELDS = ['tiktok', 'youtube'];

/**
 * The platforms this user can actually publish to, right now.
 *
 * Read from connected_accounts_health_summary rather than connected_accounts:
 * that view computes can_publish from the provider registry PLUS evidence of a
 * live credential (migration 20260904140000), so an account whose token failed
 * to save or has expired is correctly excluded. RLS scopes it to the caller.
 *
 * Failing to load is NOT treated as "no platforms": that would silently empty
 * the composer and look like the user has nothing connected. The error is
 * surfaced instead, because "we could not check" and "you have none" are
 * different statements.
 */
function usePublishablePlatforms(open) {
  const [platforms, setPlatforms] = useState([]);
  const [state, setState] = useState('loading');   // loading | ready | error

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;

    (async () => {
      setState('loading');
      // `id` and the display names are selected because the per-platform options
      // panels need them: TikTok's fetches live creator info by account id (its
      // guidelines require the CURRENT creator state, never a cached one), and
      // both name the account being configured. The view exposes these columns —
      // 20260904140000_publish_capability_registry.sql:161-162.
      const { data, error } = await supabase
        .from('connected_accounts_health_summary')
        .select('id, platform, can_publish, display_name, account_name, username')
        .eq('scope', 'personal');

      if (cancelled) return;
      if (error) {
        console.error('[quickpost] could not load connected accounts:', error.message);
        setState('error');
        return;
      }

      // First publishable account wins per platform. More than one account on
      // one platform is a real case this composer does not model yet; choosing
      // silently beats rendering the same platform twice, and the options panel
      // names the account it is configuring so the choice stays visible.
      const byPlatform = new Map();
      for (const row of data || []) {
        if (!row?.can_publish) continue;
        const key = String(row.platform || '').toLowerCase();
        if (!PLATFORM_PRESENTATION[key] || byPlatform.has(key)) continue;
        byPlatform.set(key, {
          key,
          ...PLATFORM_PRESENTATION[key],
          accountId: row.id || null,
          accountName: row.display_name || row.account_name || row.username || null,
        });
      }

      setPlatforms([...byPlatform.values()]);
      setState('ready');
    })();

    return () => { cancelled = true; };
  }, [open]);

  return { platforms, state };
}

/**
 * The user's standing AI-disclosure answer, from
 * user_settings.generation_defaults.ai_disclosure (userSettingsService.js:54).
 *
 * "Was this made by AI" is a fact about the ASSET, not about one send — it maps
 * to YouTube's status.containsSyntheticMedia and Instagram's is_ai_generated,
 * and asking it once per destination invites two different answers for the same
 * file, which is the field most likely to get an account actioned
 * (PLATFORM-PUBLISH-FIELDS.md §0.1). So it is answered once in Settings, shown
 * here, and overridable for this post only.
 *
 * Defaults TRUE while loading and on failure, matching DEFAULT_GENERATION_DEFAULTS.
 * Disclosing when we were unsure is the recoverable direction; failing to
 * disclose is not.
 */
function useAiDisclosureDefault(open, userId) {
  const [value, setValue] = useState(true);

  useEffect(() => {
    if (!open || !userId) return undefined;
    let cancelled = false;

    fetchUserSettings(userId)
      .then((settings) => {
        if (cancelled) return;
        const stored = settings?.generationDefaults?.ai_disclosure;
        if (typeof stored === 'boolean') setValue(stored);
      })
      .catch((err) => {
        console.error('[quickpost] could not load AI-disclosure default:', err?.message || err);
      });

    return () => { cancelled = true; };
  }, [open, userId]);

  return value;
}

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
  // Which primary action this surface offers. 'schedule' is the Calendar's
  // (pick a date, put it on the grid); 'publish' is the Library's (send it now).
  // Both write the same row — see handleSubmit — so this chooses a default
  // emphasis, never a different mechanism.
  primaryAction = 'schedule',
  onClose,
  // ({ mode: 'draft'|'schedule'|'publish', platforms, captions, asset, dateKey, timeStr }) => Promise<boolean>
  // Must resolve to `true` on success / `false` on failure (it owns the
  // outcome-accurate confirmation toast itself, via the page-level
  // ToastStack — see DECISIONS_LOG.md 2026-06-24 "Bug 1" for why this isn't
  // the composer's own job). The composer closes itself only when the
  // parent reports success; it stays open on failure so Sade can retry
  // without losing what she typed.
  onSubmit,
}) {
  const { user } = useAuth();
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState(prefillAsset || null);
  const [activePlatforms, setActivePlatforms] = useState([]);

  // ── Per-platform required fields ─────────────────────────────────────────
  //
  // Collected by the SAME panels the Studio uses — TikTokOptionsPanel and
  // YouTubeOptionsPanel — not by a second, thinner copy of them here.
  //
  // This composer used to hand-roll two made-for-kids buttons and hardcode
  // privacyStatus:'private', which meant it collected neither
  // contains_synthetic_media nor category_id (both read by
  // youtube.service.ts:173-182), and collected NOTHING AT ALL for TikTok — so
  // workflow_state.tiktok was absent, optionsFor("tiktok") returned null, and
  // tiktok.service.ts:195-200 refused every such post with "No TikTok privacy
  // level was chosen for this post." A control that exists in one surface and
  // not in the one users reach is this repo's signature defect.
  //
  // Keyed by platform so a platform toggled OFF cannot leave its options behind
  // to be written to a row that no longer targets it.
  const [platformOptions, setPlatformOptions] = useState({}); // key -> settings object
  const [platformValid, setPlatformValid] = useState({});     // key -> boolean

  // Per-platform title, for the platforms that take a real one SEPARATE from the
  // caption. That is not cosmetic: on YouTube the title is the line above the
  // player, and with no field for it the adapter falls back to post.title — which
  // createQuickPost set to the asset's FILENAME (calendarService.js:417), so a
  // clip published as "clip-3.mp4". On TikTok video, by contrast, post_info.title
  // IS the caption, so no separate box is offered there. platformNeedsTitle()
  // already encodes exactly this, per media type.
  const [titles, setTitles] = useState({}); // key -> string

  // Answered once for the asset, defaulted from Settings, overridable here.
  const aiDisclosureDefault = useAiDisclosureDefault(open, user?.id);
  const [aiDisclosure, setAiDisclosure] = useState(true);
  const aiTouched = useRef(false);
  useEffect(() => {
    // The stored default arrives asynchronously. Applying it after the user has
    // already made a choice for this post would silently overwrite them.
    if (!aiTouched.current) setAiDisclosure(aiDisclosureDefault);
  }, [aiDisclosureDefault]);

  // ── Panel callbacks must be STABLE PER PLATFORM, not merely memoised ──────
  //
  // `useCallback((key) => (settings) => …)` is not enough, and the difference is
  // an infinite render loop rather than a style point. That form memoises the
  // OUTER function, so `handleOptionsChange('youtube')` still returns a brand
  // new inner arrow on every render. YouTubeOptionsPanel emits from an effect
  // that lists `onChange` in its dependencies, so a fresh identity each render
  // means: effect fires → setPlatformOptions → re-render → new onChange → effect
  // fires… React caught it as "Maximum update depth exceeded". (TikTok's panel
  // omits onChange from its deps and so never showed the symptom — which is
  // exactly why a bug like this hides.)
  //
  // Caching the handler pair per platform key in a ref gives each panel one
  // callback identity for the lifetime of the composer, so each emits only when
  // its OWN state actually changes.
  const optionHandlers = useRef(new Map());
  const handlersFor = useCallback((key) => {
    if (!optionHandlers.current.has(key)) {
      optionHandlers.current.set(key, {
        onChange: (settings) => {
          // `isValid` is transient UI state that TikTok's panel bundles in with
          // the settings; it is tracked separately via onValidityChange and must
          // not be persisted onto the row. Everything else passes through
          // UNTRANSLATED — each panel already emits its own adapter's key
          // vocabulary (TikTok reads camelCase at tiktok.service.ts:195,246-250;
          // YouTube reads snake_case at youtube.service.ts:158,173-182), and a
          // renaming layer here would just be a second place for the two ends to
          // drift apart.
          const { isValid: _transient, ...persisted } = settings || {};
          setPlatformOptions((prev) => ({ ...prev, [key]: persisted }));
        },
        onValidityChange: (valid) => {
          setPlatformValid((prev) => (prev[key] === valid ? prev : { ...prev, [key]: valid }));
        },
      });
    }
    return optionHandlers.current.get(key);
  }, []);

  // Which active platforms have a required-field panel that is not yet satisfied.
  // Returns LABELS: every caller puts these straight in front of a person.
  const unsatisfiedPlatforms = useMemo(
    () => PLATFORMS_WITH_REQUIRED_FIELDS
      .filter((key) => activePlatforms.includes(key) && platformValid[key] !== true)
      .map((key) => getPlatformSpec(key).label),
    [activePlatforms, platformValid],
  );

  // Which active platforms need a title and have not been given one.
  const missingTitles = useMemo(
    () => activePlatforms
      .filter((key) => platformNeedsTitle(key, selectedAsset?.media_type)
        && !String(titles[key] || '').trim())
      .map((key) => getPlatformSpec(key).label),
    [activePlatforms, titles, selectedAsset],
  );

  // Blocks SENDING only, never saving a draft. A draft is explicitly an
  // unfinished post, and refusing to save one would lose the caption the user
  // just wrote. These declarations are required to PUBLISH, not to keep working.
  const requiredFieldsMissing = unsatisfiedPlatforms.length > 0 || missingTitles.length > 0;

  // ── Media requirement ────────────────────────────────────────────────────
  //
  // Deliberately keyed on generation_id, NOT on "an asset is selected".
  // `generation_id` is the ONLY link the publisher can follow
  // (publish-post/index.ts:81-88 joins posts -> generations), so an asset that
  // carries none is, to the publisher, no media at all. Library rows created by
  // UPLOAD have a null generation_id by schema
  // (20260625100000_personal_assets_table.sql:41), which is why selecting one
  // must NOT satisfy this check — that path produced posts that looked complete
  // and then failed at publish.
  //
  // Same rule as youtubeNeedsAudience: blocks SCHEDULING, never draft-saving.
  // A draft is explicitly unfinished work, and refusing to save one would throw
  // away the caption the user just wrote.
  const attachedGenerationId = selectedAsset?.generation_id || null;
  const platformsNeedingMedia = attachedGenerationId
    ? []
    : platformsRequiringMedia(activePlatforms);
  const needsMedia = platformsNeedingMedia.length > 0;

  // An asset IS selected but carries no publishable link — this needs its own
  // message, because "attach media" reads as nonsense next to a filled picker.
  const assetHasNoPublishableMedia = Boolean(selectedAsset) && !attachedGenerationId;

  const { platforms: PLATFORMS, state: platformState } = usePublishablePlatforms(open);

  // Select the first publishable platform once they load. Defaulting to a
  // hardcoded 'instagram' selected a platform the user may not have connected.
  useEffect(() => {
    if (platformState === 'ready' && PLATFORMS.length > 0 && activePlatforms.length === 0) {
      setActivePlatforms([PLATFORMS[0].key]);
    }
  }, [platformState, PLATFORMS, activePlatforms.length]);
  const [captions, setCaptions] = useState({});
  const [prefilling, setPrefilling] = useState({});
  // Seeded from the clock at open, through the same module ScheduleModal uses.
  //
  // This was `getZonedTodayKey(timezone)` plus a hardcoded '09:00' — which, for
  // most of the working day, is a time that has already passed. The dispatcher
  // selects `scheduled_at <= now()` every minute, so "scheduling" a post for
  // 09:00 at three in the afternoon sent it immediately. The user chose a
  // future-looking control and got an instant send, with a confirmation saying
  // it was scheduled.
  // ONE seed, read twice. Calling seedFromNow() in each initializer separately
  // would sample the clock twice, and two samples either side of a minute
  // boundary can disagree — 23:59 on one line and 00:00 on the next, giving a
  // date and a time that belong to different days. Rare, and silent when it
  // happens, which is the kind of thing worth spending one extra useState on.
  const [initialSeed] = useState(() => seedFromNow(timezone));
  const [dateKey, setDateKey] = useState(initialSeed.dateKey);
  const [timeStr, setTimeStr] = useState(initialSeed.timeStr);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // ── Discovery score, per destination ─────────────────────────────────────
  //
  // Debounced hard, because this is a paid LLM call behind a rate limit and the
  // input is a textarea someone is typing into. Two seconds of quiet is the
  // difference between one call per caption and one per keystroke — and the
  // rate limit, once hit, would make the whole feature read as broken.
  //
  // Nothing here is awaited by the submit path and nothing here can reject:
  // scoreDestinations() resolves to a state object on every path, so a scoring
  // outage degrades to "not scored" and the composer sends exactly as before.
  const [scores, setScores] = useState({});

  useEffect(() => {
    if (!open || activePlatforms.length === 0) return undefined;

    const targets = activePlatforms
      .filter((key) => String(captions[key] || '').trim())
      .map((key) => ({
        platform: key,
        caption: captions[key],
        title: titles[key] || '',
        hashtags: [],
        mediaType: selectedAsset?.media_type || null,
      }));

    if (targets.length === 0) return undefined;

    let cancelled = false;
    const timer = setTimeout(async () => {
      setScores((prev) => {
        const next = { ...prev };
        for (const t of targets) {
          if (next[t.platform]?.state !== SCORE_STATE.SCORED) {
            next[t.platform] = { state: SCORE_STATE.SCORING, score: null, category: null, suggestions: [], reason: '' };
          }
        }
        return next;
      });

      const result = await scoreDestinations(scorePostSeo, targets);
      if (cancelled) return;
      setScores((prev) => ({ ...prev, ...result }));
    }, 2000);

    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activePlatforms, captions, titles, selectedAsset?.media_type]);

  // Everything that must hold before a row may be written with a non-null
  // scheduled_at, in one place so "Schedule" and "Publish now" cannot drift
  // apart — they create the same row and must refuse under the same conditions.
  // Draft-saving is deliberately NOT gated by any of this.
  //
  // Declared HERE, below every state it reads, and not up beside the media
  // checks where it reads more naturally: `isSubmitting` is a const declared
  // further down, so the earlier position was a temporal dead zone — a
  // ReferenceError on the composer's first render. `next build` compiled it
  // without complaint, because compiling a modal is not rendering one.
  const sendBlocked = isSubmitting
    || activePlatforms.length === 0
    || requiredFieldsMissing
    || needsMedia;

  // The schedule floor, from the same module ScheduleModal uses, so a new post
  // and a reschedule cannot disagree about when "too soon" begins.
  //
  // It gates SCHEDULING only. "Publish now" is deliberately below the floor —
  // it writes scheduled_at = now(), which is a send rather than a scheduling
  // choice — and "Save as draft" writes no time at all.
  const scheduleFloor = checkScheduleFloor(dateKey, timeStr, timezone);
  const scheduleBlocked = sendBlocked || !scheduleFloor.ok;

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
      const turningOff = prev.includes(key);
      const next = turningOff ? prev.filter((k) => k !== key) : [...prev, key];
      if (!turningOff && !captions[key]) {
        prefillCaption(key);
      }
      if (turningOff) {
        // Drop this platform's collected settings with it. Keeping them would
        // let a stale privacy level or made-for-kids answer — gathered for a
        // destination the user has since removed — survive to the insert, and
        // the validity map would go on reporting a platform satisfied that is
        // no longer being sent to.
        setPlatformOptions((o) => { const { [key]: _drop, ...rest } = o; return rest; });
        setPlatformValid((v) => { const { [key]: _drop, ...rest } = v; return rest; });
        setTitles((t) => { const { [key]: _drop, ...rest } = t; return rest; });
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
      // "Publish now" is scheduled-at-this-instant, not a second send path.
      //
      // publish-post has exactly ONE caller: the database cron worker
      // process-scheduled-posts, registered '* * * * *', which selects
      // status='scheduled' AND scheduled_at <= now()
      // (20260710140000_create_process_scheduled_posts.sql). Nothing
      // client-side can invoke the publisher. So the honest implementation of
      // "now" is a past scheduled_at through the dispatcher already proven in
      // production — no second endpoint, no duplicated dispatch guard, no
      // idempotency problem re-solved. The worker picks it up within a minute,
      // which is exactly what the confirmation copy promises and no more.
      const payload = {
        mode,
        platforms: activePlatforms,
        // Every platform's collected settings, not just YouTube's. Passing only
        // YouTube's is what left TikTok posts with no privacy level and failed
        // them at send.
        platformOptions: Object.fromEntries(
          activePlatforms
            .filter((key) => platformOptions[key])
            .map((key) => [key, platformOptions[key]]),
        ),
        titles: Object.fromEntries(
          activePlatforms
            .filter((key) => String(titles[key] || '').trim())
            .map((key) => [key, String(titles[key]).trim()]),
        ),
        aiDisclosure,
        captions,
        asset: selectedAsset,
        dateKey: mode === 'schedule' ? dateKey : null,
        timeStr: mode === 'schedule' ? timeStr : null,
        scheduledAtISO: mode === 'publish'
          ? new Date().toISOString()
          : (mode === 'schedule' && dateKey && timeStr
            ? zonedDateTimeToUTC(dateKey, timeStr, timezone)
            : null),
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
            {/* Optional is a property of the SELECTED PLATFORMS, not of the
                step. Labelling it "(optional)" while YouTube is selected is
                how a post reached publish with no media at all. */}
            <p className="quickpost-step__label"><span className="quickpost-step__num">1</span>Library asset {needsMedia ? '(required)' : '(optional)'}</p>
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
                {selectedAsset
                  ? selectedAsset.name
                  : needsMedia
                    ? 'No asset — click to pick from Library (required for the selected platforms)'
                    : 'No asset — click to pick from Library (optional)'}
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
            {platformState === 'loading' && (
              <p className="quickpost-hint">Checking which accounts can publish…</p>
            )}

            {/* "We could not check" is not "you have none". Saying the second
                when the first is true would have the user reconnecting a
                working account to fix a network blip. */}
            {platformState === 'error' && (
              <p className="quickpost-hint quickpost-hint--error">
                Could not check your connected accounts. Reload to try again — nothing is wrong
                with your connections.
              </p>
            )}

            {platformState === 'ready' && PLATFORMS.length === 0 && (
              <p className="quickpost-hint quickpost-hint--error">
                No connected account can publish yet. Connect one in Settings first — a post
                scheduled with no target would fail at publish time.
              </p>
            )}

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

            {/* ── Declare AI-generated media ────────────────────────────────
                Asked once for the ASSET, not once per destination: it maps to
                YouTube's containsSyntheticMedia and Instagram's is_ai_generated,
                and two controls for one fact is how the same file gets disclosed
                to one platform and not the other. Seeded from
                user_settings.generation_defaults.ai_disclosure; this override
                applies to this post only, which is what the Settings copy
                promises. */}
            <div className="quickpost-yt-audience">
              <p className="quickpost-yt-audience__q">Declare AI-generated media</p>
              <p className="quickpost-hint">
                {aiDisclosure
                  ? 'Destinations that support a disclosure flag will be told this post contains AI-generated media.'
                  : 'No disclosure will be sent with this post.'}
              </p>
              <div className="platform-toggle-row">
                <button
                  type="button"
                  className={`platform-toggle${aiDisclosure ? ' is-active' : ''}`}
                  onClick={() => { aiTouched.current = true; setAiDisclosure(true); }}
                  aria-pressed={aiDisclosure}
                >
                  On
                </button>
                <button
                  type="button"
                  className={`platform-toggle${!aiDisclosure ? ' is-active' : ''}`}
                  onClick={() => { aiTouched.current = true; setAiDisclosure(false); }}
                  aria-pressed={!aiDisclosure}
                >
                  Off
                </button>
              </div>
              {!aiDisclosure && (
                <p className="quickpost-hint">
                  Platforms can restrict, demonetise or remove content — or action the account —
                  over synthetic media that was not disclosed. Turning this off for this post is
                  your call and your responsibility.
                </p>
              )}
            </div>

            {/* ── Per-platform required fields ──────────────────────────────
                The same panels Studio uses. Each is a compliance artefact in its
                own right (TikTok's UX requirements are a condition of Direct Post
                approval; YouTube's made-for-kids is a COPPA declaration), which is
                exactly why this composer must not carry a thinner copy of them. */}
            {PLATFORMS.filter((p) => activePlatforms.includes(p.key) && p.key === 'tiktok').map((p) => (
              <TikTokOptionsPanel
                key={`opts-${p.key}`}
                accountId={p.accountId}
                mediaType={selectedAsset?.media_type === 'image' ? 'photo' : 'video'}
                onChange={handlersFor(p.key).onChange}
                onValidityChange={handlersFor(p.key).onValidityChange}
              />
            ))}

            {PLATFORMS.filter((p) => activePlatforms.includes(p.key) && p.key === 'youtube').map((p) => (
              <YouTubeOptionsPanel
                key={`opts-${p.key}`}
                accountId={p.accountId}
                accountName={p.accountName}
                /* Controlled: the single AI-disclosure control above owns this
                   declaration, so the panel does not render a second checkbox
                   for it. See YouTubeOptionsPanel's header. */
                syntheticMedia={aiDisclosure}
                onChange={handlersFor(p.key).onChange}
                onValidityChange={handlersFor(p.key).onValidityChange}
              />
            ))}

            {/* ── Titles, where a title is a real separate field ────────────
                "Title" means four different things across four platforms
                (PLATFORM-PUBLISH-FIELDS.md §0.2), so this is per destination and
                never one generic box. platformNeedsTitle() encodes which — and
                for TikTok, only for photo posts, because on TikTok VIDEO
                post_info.title IS the caption. */}
            {PLATFORMS.filter((p) => activePlatforms.includes(p.key)
              && platformNeedsTitle(p.key, selectedAsset?.media_type)).map((p) => {
              const spec = getPlatformSpec(p.key);
              const value = titles[p.key] || '';
              const over = Boolean(spec.titleMax && value.length > spec.titleMax);
              return (
                <div className="quickpost-yt-audience" key={`title-${p.key}`}>
                  <p className="quickpost-yt-audience__q">
                    {p.label} title <span aria-hidden="true">*</span>
                  </p>
                  <p className="quickpost-hint">
                    {p.key === 'youtube'
                      ? 'Shown above the player, separate from the caption. Without one, YouTube falls back to the file name.'
                      : `${p.label} shows this separately from the caption.`}
                  </p>
                  <input
                    className="ui-input"
                    type="text"
                    value={value}
                    onChange={(e) => setTitles((prev) => ({ ...prev, [p.key]: e.target.value }))}
                    aria-label={`${p.label} title`}
                    placeholder={`Title for ${p.label}…`}
                  />
                  {spec.titleMax && (
                    <div className={`caption-counter${over ? ' is-over' : ''}`}>
                      {value.length} / {spec.titleMax}
                    </div>
                  )}
                </div>
              );
            })}

            <div className="per-platform-caption">
              {PLATFORMS.filter((p) => activePlatforms.includes(p.key)).map((p) => {
                const caption = captions[p.key] || '';
                const limit = captionLimitFor(p.key);
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
                    <div className={`caption-counter${caption.length > limit ? ' is-over' : ''}`}>{caption.length} / {limit}</div>

                    {/* ── Where this caption gets cut ──────────────────────
                        Generic layout, exact truncation. The value is showing
                        WHERE the fold falls, not imitating anyone's app — a
                        preview subtly wrong about spacing is tolerable, one
                        wrong about the fold is worse than none. Described as
                        approximate because real clients wrap by pixel width,
                        not by character count. */}
                    {(() => {
                      const pv = previewFor({ platform: p.key, caption, hashtags: [] });
                      if (!caption || pv.foldAt === null) return null;
                      return (
                        <div className="quickpost-preview">
                          <p className="quickpost-hint">
                            {pv.folds
                              ? `${p.label} shows about the first ${pv.foldAt} characters before “more”. Your hook needs to land above the line.`
                              : `Fits inside ${p.label}’s visible area (about ${pv.foldAt} characters).`}
                          </p>
                          <div className="quickpost-preview__body">
                            <span>{pv.visible}</span>
                            {pv.folds && (
                              <>
                                <span className="quickpost-preview__fold" aria-hidden="true"> … more</span>
                                <span className="quickpost-preview__hidden">{pv.hidden}</span>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── Discovery score ──────────────────────────────────
                        Advisory, always. discoveryScore.js cannot reject, so
                        nothing here can make the send depend on it — and a
                        failure renders as "not scored", never as a low score. */}
                    {(() => {
                      const s = scores[p.key];
                      if (!s || s.state === SCORE_STATE.IDLE) return null;
                      if (s.state === SCORE_STATE.SCORING) {
                        return <p className="quickpost-hint">Checking discoverability…</p>;
                      }
                      if (s.state === SCORE_STATE.UNAVAILABLE) {
                        return (
                          <p className="quickpost-hint">
                            Not scored — {s.reason} This does not affect publishing.
                          </p>
                        );
                      }
                      const band = bandFor(s.score);
                      return (
                        <p className="quickpost-hint">
                          Discoverability: <strong>{s.score}</strong> · {band.label}
                          {s.suggestions.length > 0 ? ` — ${s.suggestions[0]}` : ''}
                        </p>
                      );
                    })()}
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

        {/* Says which platform objects and why, rather than a bare disabled
            button. Saving a draft stays available, and the copy says so —
            otherwise this reads as "your work is stuck". */}
        {needsMedia && (
          <div className="ui-field-error" role="alert">
            {assetHasNoPublishableMedia ? (
              <>
                {platformsNeedingMedia.join(' and ')} {platformsNeedingMedia.length > 1 ? 'need' : 'needs'} a
                {' '}photo or video, and the selected asset doesn&apos;t have one that can be published yet.
                Pick a generated asset instead, or save this as a draft.
              </>
            ) : (
              <>
                {platformsNeedingMedia.join(' and ')} {platformsNeedingMedia.length > 1 ? 'do' : 'does'} not
                {' '}accept text-only posts. Attach a Library asset above, or save this as a draft.
              </>
            )}
          </div>
        )}

        {/* Names the platform that objects and what it wants, rather than a bare
            disabled button. Saving a draft stays available throughout. */}
        {unsatisfiedPlatforms.length > 0 && (
          <div className="ui-field-error" role="alert">
            {unsatisfiedPlatforms.join(' and ')} {unsatisfiedPlatforms.length > 1 ? 'have' : 'has'} a
            {' '}required setting that has not been answered yet. Fill in the options above, or save
            this as a draft — the answer is yours to give and cannot be filled in for you.
          </div>
        )}

        {/* Scheduling-only, and it says so — otherwise a user whose chosen time
            is too soon sees a disabled button next to an enabled "Publish now"
            with nothing connecting the two. */}
        {!sendBlocked && !scheduleFloor.ok && scheduleFloor.reason && (
          <div className="ui-field-error" role="alert">{scheduleFloor.reason}</div>
        )}

        {missingTitles.length > 0 && (
          <div className="ui-field-error" role="alert">
            {missingTitles.join(' and ')} {missingTitles.length > 1 ? 'need' : 'needs'} a title,
            {' '}separate from the caption. Without one the post goes out named after the file.
          </div>
        )}

        <div className="quickpost-footer">
          <button type="button" className="ui-button ui-button-secondary ui-button-md" disabled={isSubmitting} onClick={() => handleSubmit('draft')}>
            Save as draft
          </button>
          <div className="quickpost-footer__primary">
            <button type="button" className="ui-button ui-button-secondary ui-button-md" onClick={onClose} disabled={isSubmitting}>Cancel</button>
            {/* Both buttons write one row through one path; they differ only in
                when scheduled_at falls. The label says "Publish now" because that
                is the user's intent — the CONFIRMATION, owned by the parent, is
                what must not claim the post is published, because at click time
                nothing knows that yet. */}
            {primaryAction === 'publish' ? (
              <>
                <button
                  type="button"
                  className="ui-button ui-button-secondary ui-button-md"
                  disabled={scheduleBlocked}
                  onClick={() => handleSubmit('schedule')}
                >
                  Schedule…
                </button>
                <button
                  type="button"
                  className="ui-button ui-button-primary ui-button-md"
                  disabled={sendBlocked}
                  onClick={() => handleSubmit('publish')}
                >
                  Publish now
                </button>
              </>
            ) : (
              <button
                type="button"
                className="ui-button ui-button-primary ui-button-md"
                disabled={scheduleBlocked}
                onClick={() => handleSubmit('schedule')}
              >
                Schedule post
              </button>
            )}
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
