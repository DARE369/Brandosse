import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { generateImages } from '../../services/media.service';
import styles from './YouTubeOptionsPanel.module.css';

/**
 * YouTubeThumbnailPicker — an optional custom thumbnail, generated or chosen
 * from the Library.
 *
 * ── Why this is a SEPARATE component from YouTubeOptionsPanel ──────────────
 * That panel's own header says what it is: "the per-post settings a YouTube
 * upload legally needs" — made-for-kids, visibility, category. A thumbnail is
 * not legally required; it is an enhancement, and bundling it into the legal
 * panel would blur which fields block scheduling (the audience question does;
 * this never should).
 *
 * ── Why the cost is not shown before generating ─────────────────────────────
 * The house rule on this product is "every button that spends says the number
 * before you press it" — and that rule is kept here by NOT pretending to know
 * a number this component cannot see. The credit cost of an image generation
 * is decided server-side by the generateImage edge function and returned only
 * after the call (generateImages()'s `generationCost`); nothing in this
 * codebase computes it client-side ahead of time for ANY generation entry
 * point, this one included. Showing "1 cr" here would be a guess dressed as a
 * fact — the real cost is shown the moment it is known, immediately after
 * generating, rather than invented before.
 *
 * ── Why a channel-eligibility notice sits here, not just in the error path ──
 * YouTube gates custom thumbnails behind channel-level phone verification,
 * confirmed live 2026-09-22 by actually attempting it — HTTP 403, domain
 * "youtube.thumbnail", reason "forbidden" — entirely separate from any OAuth
 * scope. That failure is handled non-fatally in the adapter (see
 * classifyThumbnailError in _shared/youtube.service.ts: the video still
 * publishes, only the thumbnail step can fail), but a user who picks a
 * thumbnail and only finds out AFTER publishing that their channel cannot use
 * one has been let down by the UI, not just YouTube. Saying it up front is
 * cheaper than a confused support message after the fact.
 *
 * ── Data shape emitted ───────────────────────────────────────────────────────
 * onChange(thumbnailUrl | null). null means "no custom thumbnail, YouTube
 * picks a frame" — the exact meaning readOptions() in the adapter gives an
 * absent thumbnail_url, so the parent composer can merge this straight into
 * the same platformOptions.youtube object it already builds for
 * YouTubeOptionsPanel, no new field name to keep in sync elsewhere.
 *
 * ── Auto-generation on selection (2026-09-25) ───────────────────────────────
 * Founder ask: a thumbnail should exist the moment YouTube is selected, not
 * only after the user finds this panel and types a prompt. `contentSeed`
 * (the post's title, or its caption) drives a one-shot auto-generation the
 * first time this mounts with nothing chosen yet and Auto still selected —
 * never on a re-render, never over a thumbnail the user already picked or
 * removed (autoAttempted below is a ref, not state, so it survives without
 * re-triggering the effect that reads it).
 *
 * Still respects "every button that spends says the number before you press
 * it": there is no button here, so the number is shown the same way a
 * manual generation already shows it — immediately once known, labelled
 * "Auto-generated" so it reads as a default, not a hidden charge, with
 * Remove (reverting to the free platform-picked frame) always one click away.
 */

const MODE_AUTO = 'auto';
const MODE_GENERATE = 'generate';
const MODE_LIBRARY = 'library';

/**
 * A CTR-informed default prompt for the unattended, first-selection
 * generation — used before the user has typed anything of their own.
 *
 * Encodes what the current published research on thumbnail click-through
 * actually credits (vidiq.com, touhfa.art, humbleandbrag.com — 2026):
 * ONE clear subject carrying visible emotion (a face reads 20-30% higher
 * than a flat object shot), high contrast separating subject from
 * background, and a composition that still reads at the size it is actually
 * judged at — a shrunk mobile-feed thumbnail, not full-screen.
 *
 * Deliberately excludes an instruction to render specific words. Diffusion
 * image models render literal on-image text unreliably; a garbled word baked
 * into a thumbnail is worse than none, and — per the same research — a
 * strong subject is the larger lever besides. Getting legible text right
 * needs a text-capable renderer this pipeline doesn't have wired in today,
 * not a prompt-engineering trick.
 */
function buildCtrThumbnailPrompt(seed) {
  const topic = String(seed || '').trim().slice(0, 200);
  return (
    `YouTube thumbnail for a video about: ${topic}. `
    + 'One clear subject filling most of the frame, with a visibly emotional, '
    + 'expressive face if a person fits the subject — otherwise one bold, '
    + 'unmistakable focal object. Bright, high-contrast colors separating the '
    + 'subject from the background. Punchy, dynamic framing rather than a '
    + 'flat, neutral shot. No clutter, no busy background detail, no text or '
    + 'lettering of any kind — composition only. Must read clearly shrunk to '
    + 'a small thumbnail, not just at full size. 16:9.'
  );
}

export default function YouTubeThumbnailPicker({
  accountId,
  /** Same shape as QuickPostComposer's own libraryAssets prop. */
  libraryAssets = [],
  /**
   * The post's title, falling back to its caption — the text the
   * auto-generated first thumbnail is based on. Absent or empty: no
   * auto-generation runs, and the picker starts on the same free Auto
   * default it always has.
   */
  contentSeed = '',
  onChange,
}) {
  const [mode, setMode] = useState(MODE_AUTO);
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [chosen, setChosen] = useState(null); // { url, source: 'generated'|'library'|'auto-generated', cost? }
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [isAutoRun, setIsAutoRun] = useState(false);
  const autoAttempted = useRef(false);

  // A thumbnail must be a static image. A video asset cannot be used as its
  // own thumbnail source through this control — offering it would only fail
  // silently later when the adapter's expectContentType rejects it.
  const imageAssets = useMemo(
    () => libraryAssets.filter((a) => a?.media_type === 'image'),
    [libraryAssets],
  );

  const emit = useCallback((next) => {
    setChosen(next);
    onChange?.(next?.url || null);
  }, [onChange]);

  // overridePrompt lets the auto-generation effect below fire with a value
  // it just computed, rather than the `prompt` state var — which a `setPrompt`
  // two lines earlier in the same tick has not actually updated yet (React
  // batches it), so reading `prompt` here would generate from an empty string.
  const runGenerate = useCallback(async (overridePrompt, source = 'generated') => {
    const cleanPrompt = String(overridePrompt ?? prompt).trim();
    if (!cleanPrompt) {
      setGenerateError('Describe the thumbnail you want first.');
      return;
    }
    setGenerating(true);
    setGenerateError('');
    try {
      const [image] = await generateImages({
        prompt: cleanPrompt,
        aspectRatio: '16:9', // YouTube's thumbnail ratio
        numImages: 1,
        category: 'image',
      });
      emit({ url: image.url, source, cost: image.generationCost });
    } catch (err) {
      setGenerateError(err?.message || 'Could not generate a thumbnail. Please try again.');
    } finally {
      setGenerating(false);
    }
  }, [prompt, emit]);

  const handleGenerate = useCallback(() => runGenerate(undefined, 'generated'), [runGenerate]);

  // One-shot: the first time this mounts with a real topic to work from,
  // nothing already chosen, and Auto still untouched, generate a thumbnail
  // without waiting for the user to find this panel. autoAttempted is a ref
  // so setting it does not itself re-run this effect, and it is NOT reset if
  // contentSeed changes later — a caption edit after the thumbnail already
  // exists must not silently regenerate and spend again behind the user.
  useEffect(() => {
    if (autoAttempted.current) return;
    if (chosen || mode !== MODE_AUTO) return;
    const seed = String(contentSeed || '').trim();
    if (!seed) return; // nothing to base a smart prompt on — stays on free Auto
    autoAttempted.current = true;
    const derived = buildCtrThumbnailPrompt(seed);
    setMode(MODE_GENERATE);
    setPrompt(derived);
    setIsAutoRun(true);
    runGenerate(derived, 'auto-generated');
    // runGenerate is intentionally omitted: it closes over `prompt`, which
    // would make this fire again on every keystroke in the manual textarea.
    // autoAttempted already guarantees this runs at most once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentSeed, chosen, mode]);

  const handlePickLibraryAsset = useCallback((asset) => {
    setIsAutoRun(false);
    emit({ url: asset.thumbnail_url, source: 'library' });
    setLibraryOpen(false);
  }, [emit]);

  const handleClear = useCallback(() => {
    setIsAutoRun(false);
    setChosen(null);
    setMode(MODE_AUTO);
    onChange?.(null);
  }, [onChange]);

  const handleRegenerate = useCallback(() => {
    setIsAutoRun(false);
    setChosen(null);
    setMode(MODE_GENERATE);
  }, []);

  return (
    <fieldset className={styles.group} data-account={accountId}>
      <legend className={styles.legend}>Custom thumbnail</legend>
      <p className={styles.help}>
        Optional. Leave this on Auto and YouTube picks a frame from the video itself.
      </p>

      {chosen ? (
        <div className={styles.thumbnailPreview}>
          <img src={chosen.url} alt="Selected thumbnail" className={styles.thumbnailPreviewImage} />
          <div className={styles.thumbnailPreviewMeta}>
            <span>
              {chosen.source === 'auto-generated' ? 'Auto-generated' : (
                chosen.source === 'generated' ? 'Generated' : 'From your Library'
              )}
            </span>
            {typeof chosen.cost === 'number' ? <span>· {chosen.cost} cr</span> : null}
            {chosen.source === 'auto-generated' ? (
              <button type="button" className={styles.thumbnailRemove} onClick={handleRegenerate}>
                Try another
              </button>
            ) : null}
            <button type="button" className={styles.thumbnailRemove} onClick={handleClear}>
              Remove
            </button>
          </div>
          {chosen.source === 'auto-generated' ? (
            <p className={styles.help}>
              Generated automatically for you, based on your post and what tends to earn
              clicks (a clear subject, expressive emotion, high contrast). Keep it, try
              another, remove it, or write your own prompt below.
            </p>
          ) : null}
        </div>
      ) : (
        <div className={styles.radioRow} role="radiogroup" aria-label="Thumbnail source">
          <label className={styles.radio}>
            <input
              type="radio"
              name={`yt-thumb-mode-${accountId}`}
              checked={mode === MODE_AUTO}
              onChange={() => setMode(MODE_AUTO)}
            />
            <span>Auto</span>
          </label>
          <label className={styles.radio}>
            <input
              type="radio"
              name={`yt-thumb-mode-${accountId}`}
              checked={mode === MODE_GENERATE}
              onChange={() => setMode(MODE_GENERATE)}
            />
            <span>Generate with AI</span>
          </label>
          <label className={styles.radio}>
            <input
              type="radio"
              name={`yt-thumb-mode-${accountId}`}
              checked={mode === MODE_LIBRARY}
              onChange={() => { setMode(MODE_LIBRARY); setLibraryOpen(true); }}
              disabled={imageAssets.length === 0}
            />
            <span>Pick from Library{imageAssets.length === 0 ? ' (no images saved yet)' : ''}</span>
          </label>
        </div>
      )}

      {!chosen && mode === MODE_GENERATE ? (
        <div className={styles.thumbnailGenerate}>
          {isAutoRun && generating ? (
            <p className={styles.help}>
              Generating a thumbnail for you automatically, based on your post's title —
              no action needed. You can replace the prompt below and generate your own
              instead, at any point.
            </p>
          ) : null}
          <textarea
            className={styles.select}
            rows={2}
            placeholder={'Describe the thumbnail — e.g. close-up shot, bold red arrow pointing at the product, shocked expression'}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={generating}
          />
          <button
            type="button"
            className={styles.thumbnailGenerateBtn}
            onClick={handleGenerate}
            disabled={generating || !prompt.trim()}
          >
            {generating ? 'Generating…' : 'Generate'}
          </button>
          {generateError ? (
            <p className={styles.blocker} role="alert">{generateError}</p>
          ) : null}
          <p className={styles.help}>
            Spends credits on generation, same as any image — the amount is shown once
            it&apos;s generated, because that is when it is actually known.
          </p>
        </div>
      ) : null}

      {!chosen && mode === MODE_LIBRARY && libraryOpen ? (
        <div className={styles.thumbnailLibraryGrid}>
          {imageAssets.length === 0 ? (
            <p className={styles.help}>No image assets in your Library yet.</p>
          ) : (
            imageAssets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                className={styles.thumbnailLibraryItem}
                onClick={() => handlePickLibraryAsset(asset)}
                title={asset.name}
              >
                <img src={asset.thumbnail_url} alt={asset.name || 'Library image'} />
              </button>
            ))
          )}
        </div>
      ) : null}

      <p className={styles.note}>
        Some YouTube channels are not yet eligible for custom thumbnails until their owner
        completes phone verification on YouTube — a YouTube requirement, unrelated to this
        app. If that applies here, the video still publishes normally; only the thumbnail
        step is skipped, and the post will say so.
      </p>
    </fieldset>
  );
}
