import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styles from './YouTubeOptionsPanel.module.css';

/**
 * YouTubeOptionsPanel — the per-post settings a YouTube upload legally needs.
 *
 * ── Why this exists, concretely ──────────────────────────────────────────────
 * The first real upload through this product (2026-09-10, video vjuIoPzSVcc)
 * landed on the channel with `selfDeclaredMadeForKids` ABSENT, and YouTube
 * Studio flagged it in red: "You need to answer this question."
 *
 * That is a COPPA declaration. YouTube requires every video to carry one, and
 * until it does the video sits incomplete in Studio. So without this panel,
 * every video Brandosse publishes needs the user to go and finish it by hand on
 * youtube.com — which is not publishing, it is homework.
 *
 * The adapter has read these fields since it was written
 * (_shared/youtube.service.ts, readOptions). Nothing populated them. This is
 * the missing half.
 *
 * ── Made-for-kids is REQUIRED and has no default ─────────────────────────────
 * Deliberately. It is a legal declaration about someone else's content, made to
 * a regulator, and this product must not make it on the user's behalf — the
 * same reason TikTok's panel refuses to default privacy_level. The panel
 * reports invalid until it is answered, and the composer blocks scheduling.
 *
 * A default here would be the worst option available: silent, legally
 * meaningful, and wrong roughly half the time.
 *
 * ── Synthetic media IS defaulted, and that is a different case ───────────────
 * `contains_synthetic_media` defaults to a visible, unticked "no". YouTube
 * requires disclosure only for REALISTIC altered or synthetic content; clips
 * cut from real source footage are not that. The checkbox states the claim in
 * plain words and the user can see and change it before scheduling, so the
 * declaration is theirs, not ours. Leaving it absent instead would just put the
 * question back in Studio, which is the problem being fixed.
 *
 * ── Visibility defaults to private, and says why ─────────────────────────────
 * Private is the only safe direction (a private video can be made public; an
 * unintended public one cannot be un-seen), and before the compliance audit
 * YouTube forces private regardless — so the default is also the truth.
 */

// YouTube's assignable video categories. Deliberately a short list of the ones
// valid in every region: the full set includes categories that are
// region-restricted or not assignable at all, and picking one of those returns
// `invalidCategoryId` at upload — an error the user cannot interpret.
const CATEGORIES = [
  { id: '22', label: 'People & Blogs' },
  { id: '24', label: 'Entertainment' },
  { id: '23', label: 'Comedy' },
  { id: '10', label: 'Music' },
  { id: '20', label: 'Gaming' },
  { id: '17', label: 'Sports' },
  { id: '26', label: 'Howto & Style' },
  { id: '27', label: 'Education' },
  { id: '28', label: 'Science & Technology' },
  { id: '19', label: 'Travel & Events' },
  { id: '15', label: 'Pets & Animals' },
  { id: '25', label: 'News & Politics' },
];

const VISIBILITY = [
  { value: 'private', label: 'Private', hint: 'Only you can watch it' },
  { value: 'unlisted', label: 'Unlisted', hint: 'Anyone with the link can watch' },
  { value: 'public', label: 'Public', hint: 'Listed on your channel and searchable' },
];

/** Sentinel: no answer yet. NOT false — false is a real declaration. */
const UNANSWERED = null;

export default function YouTubeOptionsPanel({
  accountId,
  accountName,
  /** Flip to true once the app passes YouTube's compliance audit. */
  auditPassed = false,
  onChange,
  onValidityChange,
}) {
  const [madeForKids, setMadeForKids] = useState(UNANSWERED);
  const [privacyStatus, setPrivacyStatus] = useState('private');
  const [categoryId, setCategoryId] = useState('22');
  const [containsSyntheticMedia, setContainsSyntheticMedia] = useState(false);

  const isValid = madeForKids !== UNANSWERED;

  // The exact keys _shared/youtube.service.ts readOptions() reads — snake_case
  // for that reason, not by accident. A mismatch here would be silent, and
  // would surface as a video published with none of these settings applied.
  const settings = useMemo(() => ({
    privacy_status: privacyStatus,
    made_for_kids: madeForKids,
    contains_synthetic_media: containsSyntheticMedia,
    category_id: categoryId,
  }), [privacyStatus, madeForKids, containsSyntheticMedia, categoryId]);

  useEffect(() => {
    // Only emit once the settings are actually usable. Publishing a
    // half-answered object upward invites a caller to persist it and schedule
    // anyway, which is the failure this panel exists to prevent.
    if (isValid) onChange?.(settings);
  }, [isValid, settings, onChange]);

  useEffect(() => {
    onValidityChange?.(isValid);
  }, [isValid, onValidityChange]);

  const answer = useCallback((value) => () => setMadeForKids(value), []);

  return (
    <div className={styles.panel} data-account={accountId}>
      <div className={styles.header}>
        <span className={styles.title}>YouTube options</span>
        {accountName ? <span className={styles.account}>{accountName}</span> : null}
      </div>

      {/* ── Audience: the one YouTube will not let you skip ─────────────── */}
      <fieldset className={`${styles.group} ${!isValid ? styles.groupRequired : ''}`}>
        <legend className={styles.legend}>
          Is this video made for kids?
          <span className={styles.required} aria-hidden="true"> *</span>
        </legend>
        <p className={styles.help}>
          Required under COPPA, and YouTube will not treat the video as complete
          without it. There is no default — this is your declaration to make.
        </p>

        <div className={styles.radioRow} role="radiogroup" aria-required="true">
          <label className={styles.radio}>
            <input
              type="radio"
              name={`yt-kids-${accountId}`}
              checked={madeForKids === true}
              onChange={answer(true)}
            />
            <span>Yes, it&apos;s made for kids</span>
          </label>
          <label className={styles.radio}>
            <input
              type="radio"
              name={`yt-kids-${accountId}`}
              checked={madeForKids === false}
              onChange={answer(false)}
            />
            <span>No, it&apos;s not made for kids</span>
          </label>
        </div>

        {!isValid ? (
          <p className={styles.blocker} role="alert">
            Answer this to schedule. Publishing without it leaves the video needing
            manual attention in YouTube Studio.
          </p>
        ) : null}

        {madeForKids === true ? (
          <p className={styles.note}>
            YouTube disables comments, personalised ads and several other features on
            videos marked made for kids. That is YouTube&apos;s behaviour, not ours.
          </p>
        ) : null}
      </fieldset>

      {/* ── Visibility ──────────────────────────────────────────────────── */}
      <fieldset className={styles.group}>
        <legend className={styles.legend}>Visibility</legend>
        <select
          className={styles.select}
          value={privacyStatus}
          onChange={(e) => setPrivacyStatus(e.target.value)}
          disabled={!auditPassed}
        >
          {VISIBILITY.map((v) => (
            <option key={v.value} value={v.value}>{v.label} — {v.hint}</option>
          ))}
        </select>

        {!auditPassed ? (
          <p className={styles.note}>
            Locked to Private until this app passes YouTube&apos;s compliance audit.
            YouTube forces every upload from an unverified project to private, and that
            lock cannot be appealed or lifted later — the only remedy is re-uploading
            after approval, which loses the URL and any views. Offering another choice
            here would be a promise we cannot keep.
          </p>
        ) : null}
      </fieldset>

      {/* ── Category ────────────────────────────────────────────────────── */}
      <fieldset className={styles.group}>
        <legend className={styles.legend}>Category</legend>
        <select
          className={styles.select}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </fieldset>

      {/* ── Altered or synthetic content ────────────────────────────────── */}
      <fieldset className={styles.group}>
        <legend className={styles.legend}>Altered or synthetic content</legend>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={containsSyntheticMedia}
            onChange={(e) => setContainsSyntheticMedia(e.target.checked)}
          />
          <span>This video contains realistic altered or AI-generated content</span>
        </label>
        <p className={styles.help}>
          YouTube requires this only when the content is <em>realistic</em> — a real
          person saying something they never said, a real place altered, an event that
          did not happen. Clips cut from genuine footage are not that. Left unticked,
          we tell YouTube this video contains none.
        </p>
      </fieldset>
    </div>
  );
}
