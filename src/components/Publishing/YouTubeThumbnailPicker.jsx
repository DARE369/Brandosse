import React, { useCallback, useMemo, useState } from 'react';
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
 */

const MODE_AUTO = 'auto';
const MODE_GENERATE = 'generate';
const MODE_LIBRARY = 'library';

export default function YouTubeThumbnailPicker({
  accountId,
  /** Same shape as QuickPostComposer's own libraryAssets prop. */
  libraryAssets = [],
  onChange,
}) {
  const [mode, setMode] = useState(MODE_AUTO);
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [chosen, setChosen] = useState(null); // { url, source: 'generated'|'library', cost? }
  const [libraryOpen, setLibraryOpen] = useState(false);

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

  const handleGenerate = useCallback(async () => {
    const cleanPrompt = prompt.trim();
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
      emit({ url: image.url, source: 'generated', cost: image.generationCost });
    } catch (err) {
      setGenerateError(err?.message || 'Could not generate a thumbnail. Please try again.');
    } finally {
      setGenerating(false);
    }
  }, [prompt, emit]);

  const handlePickLibraryAsset = useCallback((asset) => {
    emit({ url: asset.thumbnail_url, source: 'library' });
    setLibraryOpen(false);
  }, [emit]);

  const handleClear = useCallback(() => {
    setChosen(null);
    setMode(MODE_AUTO);
    onChange?.(null);
  }, [onChange]);

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
            <span>{chosen.source === 'generated' ? 'Generated' : 'From your Library'}</span>
            {typeof chosen.cost === 'number' ? <span>· {chosen.cost} cr</span> : null}
            <button type="button" className={styles.thumbnailRemove} onClick={handleClear}>
              Remove
            </button>
          </div>
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
