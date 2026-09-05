import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import styles from './TikTokOptionsPanel.module.css';

/**
 * TikTokOptionsPanel — the compose controls TikTok's audit actually inspects.
 *
 * ── This component is a compliance artefact, not just a form ────────────────
 * TikTok's Content Sharing Guidelines make specific UI elements a CONDITION of
 * Direct Post approval. Apps are rejected for missing them, and — separately —
 * for paraphrasing the declaration text.
 *
 * A verbatim rejection email for a comparable integration read:
 *
 *   "Your application did not follow our UX Guidelines. Point 2)b. Privacy
 *    Status. Users must manually select the privacy status from a dropdown
 *    and there should be no default value."
 *
 * The five faults documented in that case, each closed here:
 *   1. creator nickname/avatar not shown          -> CreatorIdentity below
 *   2. privacy hardcoded to PUBLIC_TO_EVERYONE    -> privacyLevel starts ''
 *   3. interaction toggles checked by default     -> all three start false
 *   4. music declaration shown conditionally      -> rendered unconditionally
 *   5. max_video_post_duration_sec not enforced   -> durationError below
 *
 * Before changing anything here, read
 * FUNCTIONAL-SPECIFICATION-PUBLISHING.md §7.1. A change that looks like a
 * harmless UX improvement — pre-selecting the most common privacy level,
 * hiding the declaration until it is relevant — is a rejection.
 */

/** TikTok's own labels. Left in their vocabulary so the UI matches the app. */
const PRIVACY_LABELS = {
  PUBLIC_TO_EVERYONE: 'Everyone',
  MUTUAL_FOLLOW_FRIENDS: 'Friends (mutual follows)',
  FOLLOWER_OF_CREATOR: 'Followers',
  SELF_ONLY: 'Only me',
};

/**
 * Declaration text, VERBATIM. Do not reword, shorten, or "improve".
 * TikTok checks for these exact strings.
 */
const MUSIC_DECLARATION = 'By posting, you agree to TikTok\'s Music Usage Confirmation.';
const BRANDED_DECLARATION = 'By posting, you agree to TikTok\'s Branded Content Policy and Music Usage Confirmation.';

const MUSIC_URL = 'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en';
const BRANDED_URL = 'https://www.tiktok.com/legal/page/global/bc-policy/en';

/** The empty option is deliberate and load-bearing. See the header. */
const NO_PRIVACY_SELECTED = '';

export default function TikTokOptionsPanel({
  accountId,
  mediaType = 'video',          // 'video' | 'photo' | 'carousel'
  mediaDurationSec = null,
  onChange,
  onValidityChange,
  /**
   * DESIGN PREVIEW ONLY — never pass this from a real surface.
   *
   * Supplies a creator_info payload instead of fetching one, so the panel can
   * be reviewed before a TikTok sandbox account exists. Every compliance rule
   * still applies to what renders; only the source of the data changes.
   *
   * Passing this in production would defeat the live-fetch requirement that
   * exists because a creator can go private between sessions. The guard
   * scripts/check-tiktok-ux-compliance.cjs fails if any file outside
   * app/app/dev/ passes it.
   */
  previewCreatorInfo = null,
}) {
  const isPhoto = mediaType === 'photo' || mediaType === 'carousel';

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [creator, setCreator] = useState(null);

  // ── Post settings ─────────────────────────────────────────────────────────
  // Every default below is mandated, not a preference.
  const [privacyLevel, setPrivacyLevel] = useState(NO_PRIVACY_SELECTED);
  const [allowComment, setAllowComment] = useState(false);
  const [allowDuet, setAllowDuet] = useState(false);
  const [allowStitch, setAllowStitch] = useState(false);
  const [isCommercial, setIsCommercial] = useState(false);
  const [yourBrand, setYourBrand] = useState(false);
  const [brandedContent, setBrandedContent] = useState(false);

  /**
   * Fetch on every mount — never cached.
   *
   * The guidelines require the LATEST creator info when the post page renders.
   * The creator may have gone private or disabled Duet since last time, and a
   * stale option list offers a privacy level the account no longer allows.
   */
  const load = useCallback(async () => {
    // Design-preview short circuit. See the prop's documentation.
    if (previewCreatorInfo) {
      setCreator(previewCreatorInfo);
      setLoadError(null);
      setLoading(false);
      return;
    }
    if (!accountId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Sign in again to load TikTok settings.');

      const res = await fetch(
        `/api/social/tiktok/creator-info?accountId=${encodeURIComponent(accountId)}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || 'Could not load your TikTok settings.');
      setCreator(body);
    } catch (err) {
      setCreator(null);
      setLoadError(err.message || 'Could not load your TikTok settings.');
    } finally {
      setLoading(false);
    }
  }, [accountId, previewCreatorInfo]);

  useEffect(() => { void load(); }, [load]);

  // A creator who has switched an interaction off in their own TikTok settings
  // must see it greyed out, not silently absent and not silently enabled.
  const commentLocked = Boolean(creator?.commentDisabled);
  const duetLocked = Boolean(creator?.duetDisabled);
  const stitchLocked = Boolean(creator?.stitchDisabled);

  useEffect(() => {
    if (commentLocked) setAllowComment(false);
    if (duetLocked) setAllowDuet(false);
    if (stitchLocked) setAllowStitch(false);
  }, [commentLocked, duetLocked, stitchLocked]);

  /**
   * Duration ceiling, enforced HERE rather than at publish.
   * Letting an over-length video through to the API and failing there is a
   * documented rejection cause, and it wastes the user's upload.
   */
  const maxDuration = creator?.maxVideoPostDurationSec ?? null;
  const durationError = useMemo(() => {
    if (isPhoto || !maxDuration || !mediaDurationSec) return null;
    if (mediaDurationSec <= maxDuration) return null;
    return `This video is ${Math.round(mediaDurationSec)}s. TikTok allows up to ${maxDuration}s for this account.`;
  }, [isPhoto, maxDuration, mediaDurationSec]);

  // At least one commercial option must be chosen once disclosure is on.
  const commercialIncomplete = isCommercial && !yourBrand && !brandedContent;

  const isValid = Boolean(creator)
    && privacyLevel !== NO_PRIVACY_SELECTED
    && !durationError
    && !commercialIncomplete;

  useEffect(() => {
    onValidityChange?.(isValid);
    onChange?.({
      privacyLevel,
      disableComment: !allowComment,
      disableDuet: !allowDuet,
      disableStitch: !allowStitch,
      brandContentToggle: brandedContent,
      brandOrganicToggle: yourBrand,
      isValid,
    });
    // onChange/onValidityChange are caller-owned and often inline; depending on
    // them would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [privacyLevel, allowComment, allowDuet, allowStitch, yourBrand, brandedContent, isValid]);

  // ── Loading / error ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className={styles.panel} aria-busy="true">
        <div className={styles.loading}>
          <Loader2 size={15} className={styles.spin} aria-hidden="true" />
          Loading your TikTok settings…
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={styles.panel} role="alert">
        <div className={styles.errorBox}>
          <AlertTriangle size={15} aria-hidden="true" />
          <div>
            <div className={styles.errorTitle}>{loadError}</div>
            <button type="button" className={styles.retry} onClick={() => void load()}>
              <RefreshCw size={12} aria-hidden="true" /> Try again
            </button>
          </div>
        </div>
        {/*
          No form is rendered without creator info. Falling back to a guessed
          option list would mean showing privacy levels the account may not
          permit — the exact failure the live fetch exists to prevent.
        */}
      </div>
    );
  }

  const declaration = brandedContent ? BRANDED_DECLARATION : MUSIC_DECLARATION;

  return (
    <div className={styles.panel}>

      {/* 1 ── Creator identity, from the live fetch ───────────────────────── */}
      <div className={styles.creator}>
        {creator.creatorAvatarUrl ? (
          <img className={styles.avatar} src={creator.creatorAvatarUrl} alt="" aria-hidden="true" />
        ) : (
          <span className={styles.avatarFallback} aria-hidden="true" />
        )}
        <div className={styles.creatorText}>
          <span className={styles.creatorNickname}>{creator.creatorNickname || 'TikTok account'}</span>
          {creator.creatorUsername ? (
            <span className={styles.creatorHandle}>@{creator.creatorUsername}</span>
          ) : null}
        </div>
        <span className={styles.postingTo}>Posting to</span>
      </div>

      {/* 2 ── Privacy: a dropdown with NO default value ───────────────────── */}
      <div className={styles.field}>
        <label className={styles.label} htmlFor="tt-privacy">
          Who can see this post? <span className={styles.required} aria-hidden="true">*</span>
        </label>
        <select
          id="tt-privacy"
          className={styles.select}
          value={privacyLevel}
          onChange={(e) => setPrivacyLevel(e.target.value)}
          required
          aria-required="true"
        >
          {/* This placeholder is why the control is compliant. Removing it, or
              pre-selecting an option, is the single most-cited rejection. */}
          <option value={NO_PRIVACY_SELECTED} disabled>Select who can see this</option>
          {creator.privacyLevelOptions.map((opt) => (
            <option key={opt} value={opt}>{PRIVACY_LABELS[opt] || opt}</option>
          ))}
        </select>
        {privacyLevel === NO_PRIVACY_SELECTED ? (
          <p className={styles.hint}>Choose a privacy level to continue.</p>
        ) : null}
      </div>

      {/* 3 ── Interaction toggles, all OFF by default ─────────────────────── */}
      <fieldset className={styles.fieldset}>
        <legend className={styles.label}>Allow users to</legend>

        <Toggle
          id="tt-comment" label="Comment"
          checked={allowComment} disabled={commentLocked}
          reason={commentLocked ? 'Turned off in your TikTok settings' : null}
          onChange={setAllowComment}
        />

        {/* Duet and Stitch do not exist for photo posts, so they are omitted
            entirely rather than shown disabled — an irrelevant control is
            noise, and the guidelines say to exclude them. */}
        {!isPhoto ? (
          <>
            <Toggle
              id="tt-duet" label="Duet"
              checked={allowDuet} disabled={duetLocked}
              reason={duetLocked ? 'Turned off in your TikTok settings' : null}
              onChange={setAllowDuet}
            />
            <Toggle
              id="tt-stitch" label="Stitch"
              checked={allowStitch} disabled={stitchLocked}
              reason={stitchLocked ? 'Turned off in your TikTok settings' : null}
              onChange={setAllowStitch}
            />
          </>
        ) : null}
      </fieldset>

      {/* 4 ── Commercial content disclosure, OFF by default ───────────────── */}
      <fieldset className={styles.fieldset}>
        <Toggle
          id="tt-commercial"
          label="Disclose post content"
          checked={isCommercial}
          onChange={(next) => {
            setIsCommercial(next);
            if (!next) { setYourBrand(false); setBrandedContent(false); }
          }}
        />
        <p className={styles.hint}>
          Turn on to tell viewers this post promotes a brand, product or service.
        </p>

        {isCommercial ? (
          <div className={styles.subGroup}>
            <Toggle
              id="tt-your-brand" label="Your brand"
              checked={yourBrand} onChange={setYourBrand}
              hint="You are promoting yourself or your own business."
            />
            <Toggle
              id="tt-branded" label="Branded content"
              checked={brandedContent} onChange={setBrandedContent}
              hint="You are promoting another brand or a third party."
            />
            {commercialIncomplete ? (
              <p className={styles.inlineError} role="alert">
                Choose at least one to continue.
              </p>
            ) : null}
          </div>
        ) : null}
      </fieldset>

      {/* 5 ── Duration ceiling from creator_info ──────────────────────────── */}
      {!isPhoto && maxDuration ? (
        <p className={durationError ? styles.inlineError : styles.hint} role={durationError ? 'alert' : undefined}>
          {durationError || `Maximum video length for this account: ${maxDuration}s.`}
        </p>
      ) : null}

      {/* 6 ── Processing notice ───────────────────────────────────────────── */}
      <p className={styles.hint}>
        TikTok can take a few minutes to process your {isPhoto ? 'photos' : 'video'} after posting.
      </p>

      {/*
        7 ── The declaration. ALWAYS RENDERED.

        Not inside a conditional, not revealed by a toggle. Showing it only when
        commercial disclosure is on is one of the five documented rejection
        causes. The disclosure toggle changes its WORDING; it never controls
        whether it appears.
      */}
      <p className={styles.declaration}>
        {brandedContent ? (
          <>
            By posting, you agree to TikTok&apos;s{' '}
            <a href={BRANDED_URL} target="_blank" rel="noopener noreferrer">Branded Content Policy</a>
            {' '}and{' '}
            <a href={MUSIC_URL} target="_blank" rel="noopener noreferrer">Music Usage Confirmation</a>.
          </>
        ) : (
          <>
            By posting, you agree to TikTok&apos;s{' '}
            <a href={MUSIC_URL} target="_blank" rel="noopener noreferrer">Music Usage Confirmation</a>.
          </>
        )}
      </p>

      {/* Non-visual mirror of the exact mandated string, so an automated
          check (and a reviewer using find-in-page) sees it byte-for-byte. */}
      <span className={styles.srOnly} data-tiktok-declaration>{declaration}</span>
    </div>
  );
}

/** Toggle rendered as a real checkbox so it is keyboard- and screen-reader-native. */
function Toggle({ id, label, checked, disabled = false, reason = null, hint = null, onChange }) {
  return (
    <div className={disabled ? styles.toggleRowDisabled : styles.toggleRow}>
      <label className={styles.toggleLabel} htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          className={styles.checkbox}
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          aria-describedby={reason || hint ? `${id}-desc` : undefined}
        />
        <span>{label}</span>
      </label>
      {reason || hint ? (
        <span id={`${id}-desc`} className={styles.toggleHint}>{reason || hint}</span>
      ) : null}
    </div>
  );
}
