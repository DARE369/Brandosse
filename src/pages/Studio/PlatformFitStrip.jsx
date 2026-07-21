"use client";

// PlatformFitStrip — the free, deterministic per-platform "fit" check for the
// Post Production panel (see the product-design-critic v1: base caption + a
// compact per-platform status strip, NOT tabs, NOT AI per-platform rewriting).
//
// For each selected platform it shows one chip with a live fit indicator
// against that platform's real caption/title/hashtag limits. Compliant
// platforms stay collapsed and quiet; a non-compliant one surfaces inline with
// what's wrong and a one-tap, credit-free auto-fit that trims the caption for
// that platform only. This catches the bug where one caption silently
// over-runs a platform like X (280) or a TikTok photo title (90) on publish.

import { useMemo, useState } from "react";
import { evaluatePlatformFit, autoFitCaption, getPlatformSpec } from "../../services/platforms/platformCaptionSpecs";
import styles from "./PlatformFitStrip.module.css";

export default function PlatformFitStrip({
  platforms,        // [{ id, platform, label }] — one per selected account
  caption,
  hashtags,
  title,
  mediaType,
  onAutoFit,        // (platformKey, trimmedCaption) => void
}) {
  const [expanded, setExpanded] = useState(null); // platform key

  const fits = useMemo(
    () => (platforms || []).map((p) => ({
      ...p,
      fit: evaluatePlatformFit({ platform: p.platform, caption, hashtags, title, mediaType }),
    })),
    [platforms, caption, hashtags, title, mediaType]
  );

  if (!fits.length) return null;

  const anyProblem = fits.some((f) => !f.fit.ok);

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.label}>Platform fit</span>
        {anyProblem
          ? <span className={styles.headWarn}>Some platforms need attention</span>
          : <span className={styles.headOk}>Fits every selected platform</span>}
      </div>

      <div className={styles.chips}>
        {fits.map(({ id, platform, label, fit }) => {
          const isOpen = expanded === platform;
          const problem = !fit.ok;
          return (
            <button
              key={id || platform}
              type="button"
              className={[styles.chip, problem ? styles.chipWarn : styles.chipOk, isOpen ? styles.chipOpen : ""].join(" ")}
              onClick={() => setExpanded(isOpen ? null : platform)}
              title={problem ? "Needs attention — tap for details" : `Fits ${label}`}
            >
              <span className={styles.chipDot} />
              <span className={styles.chipName}>{label || platform}</span>
              <span className={styles.chipCount}>
                {fit.captionLen}/{fit.captionMax}
              </span>
            </button>
          );
        })}
      </div>

      {/* Inline detail for the expanded (or first problematic) platform */}
      {fits.map(({ platform, label, fit }) => {
        if (expanded !== platform) return null;
        const spec = getPlatformSpec(platform);
        const problems = [];
        if (fit.captionOver) problems.push(`Caption is ${fit.captionLen} chars — ${label} allows ${fit.captionMax}.`);
        if (fit.titleMissing) problems.push(`${label} needs a title.`);
        if (fit.titleOver) problems.push(`Title is ${fit.titleLen} chars — ${label} allows ${fit.titleMax}.`);
        if (fit.hashtagOver) problems.push(`${fit.hashtagCount} hashtags — ${label} works best with ${fit.hashtagMax} or fewer.`);
        return (
          <div key={`detail-${platform}`} className={styles.detail}>
            {problems.length === 0 ? (
              <span className={styles.detailOk}>Good to go on {label}.</span>
            ) : (
              <>
                <ul className={styles.detailList}>
                  {problems.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
                {fit.captionOver && onAutoFit && (
                  <button
                    type="button"
                    className={styles.fitBtn}
                    onClick={() => onAutoFit(platform, autoFitCaption(caption, platform))}
                  >
                    Trim caption for {label} ({spec.captionMax} max)
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
