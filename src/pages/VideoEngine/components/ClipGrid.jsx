"use client";

import { Check, Loader2, Play } from "lucide-react";
import { Button } from "../../../ui-v2";
import { aspectRatioCss, clipDisplayTitle, clipScores, formatDuration, formatTimecode, scoreBand } from "../videoShared";
import styles from "./ClipGrid.module.css";

/**
 * The clips as posters.
 *
 * ── Why this is a view and not the default ──────────────────────────────────
 * A poster grid of one job is six thumbnails of the same talking head, which is
 * why the rows lead. It earns its place for the one thing rows are bad at:
 * seeing the whole set at once on a wide screen, and picking the one you want to
 * open. So every tile carries the two things that DO differ between clips —
 * rank and hook score — burned into the corners, rather than relying on the
 * frame to distinguish them.
 */

export function ClipGrid({ clips, aspectRatio, activeId, decisionOf, keptIds, busyId, onOpen, onKeep }) {
  return (
    <div className={styles.grid}>
      {clips.map((clip) => {
        const scores = clipScores(clip);
        const failed = clip.render_status === "failed";
        const kept = keptIds.has(clip.id);
        const decision = decisionOf(clip);
        const title = clipDisplayTitle(clip);

        return (
          <article
            key={clip.id}
            className={[
              styles.clipCard,
              clip.id === activeId ? styles.cardActive : "",
              failed ? styles.cardFailed : "",
              decision === "skipped" ? styles.cardSkipped : "",
            ].filter(Boolean).join(" ")}
          >
            <button
              type="button"
              className={styles.poster}
              onClick={() => onOpen(clip)}
              aria-label={`Review ${title}`}
              style={{
                aspectRatio: aspectRatioCss(aspectRatio),
                ...(clip.thumbnail_url ? { backgroundImage: `url(${clip.thumbnail_url})` } : {}),
              }}
            >
              <span className={styles.rank}>{clip.rank === null ? "—" : String(clip.rank).padStart(2, "0")}</span>
              <span className={`${styles.hook} ${styles[`band_${scoreBand(scores.hook)}`]}`}>
                {scores.hook === null ? "NO SCORE" : `HOOK ${scores.hook}`}
              </span>
              <span className={styles.playMark} aria-hidden="true">
                <Play size={16} fill="currentColor" />
              </span>
              <span className={styles.duration}>{formatDuration(clip.duration_secs)}</span>
              <span className={`${styles.state} ${styles[`state_${decision}`]}`}>
                {failed ? "FAILED" : kept ? "KEPT" : decision === "skipped" ? "SKIPPED" : "UNDECIDED"}
              </span>
            </button>

            <div className={styles.body}>
              <h3 className={styles.title}>{title}</h3>
              <span className={styles.meta}>
                {formatTimecode(clip.start_time_secs)} – {formatTimecode(clip.end_time_secs)}
                {clip.platform_target ? ` · ${clip.platform_target}` : ""}
              </span>
              <div className={styles.actions}>
                <Button
                  size="sm"
                  className={styles.keep}
                  variant={kept || failed ? "subtle" : "solid"}
                  onClick={() => onKeep(clip)}
                  disabled={kept || failed || busyId === clip.id || !clip.public_url}
                >
                  {busyId === clip.id ? <Loader2 size={13} className={styles.spin} aria-hidden="true" />
                    : kept ? <Check size={13} aria-hidden="true" /> : null}
                  {kept ? "Kept" : "Keep"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onOpen(clip)}>Review</Button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
