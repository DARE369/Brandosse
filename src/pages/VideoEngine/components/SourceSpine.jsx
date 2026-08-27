"use client";

import { useMemo } from "react";
import styles from "./SourceSpine.module.css";
import { formatTimecode } from "../videoShared";

/**
 * The source video, end to end, with every cut marked on it.
 *
 * ── Why this element exists ─────────────────────────────────────────────────
 * `video_clips.start_time_secs` and `end_time_secs` have been stored on every
 * clip since the table was created and displayed nowhere. They answer the one
 * question a person always has looking at a set of clips — "which part of my
 * video is this?" — from data we already had.
 *
 * It earns its place three times over: it answers that question, it doubles as
 * the progress indicator while a job runs, and it is the only element in this
 * surface that no generic dashboard has. Everything around it is deliberately
 * flat, so this is the one place the eye is drawn.
 *
 * ── Honesty rules ───────────────────────────────────────────────────────────
 * Nothing is drawn from a guess. With no source duration there are no true
 * positions, so the spine renders its track and no segments rather than
 * spreading clips evenly and inventing a picture of the video. A clip missing
 * its timestamps is skipped for the same reason.
 */

const MIN_SEGMENT_PERCENT = 0.45; // a 30s clip inside a 3h source is still findable

export function SourceSpine({
  durationSecs,
  clips = [],
  selectedClipId = null,
  onSelectClip,
  /** 0–100 while downloading; drives the fill behind the segments. */
  progressPercent = null,
  /** Fraction 0–1 of the source reached before a failure, if known. */
  failedAtFraction = null,
  label = "Source spine",
  note = null,
}) {
  const duration = Number(durationSecs);
  const hasScale = Number.isFinite(duration) && duration > 0;

  const segments = useMemo(() => {
    if (!hasScale) return [];

    return clips
      .map((clip) => {
        const start = Number(clip.start_time_secs);
        const end = Number(clip.end_time_secs);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

        const left = Math.max(0, Math.min(100, (start / duration) * 100));
        const width = Math.max(MIN_SEGMENT_PERCENT, Math.min(100 - left, ((end - start) / duration) * 100));

        return {
          id: clip.id,
          left,
          width,
          failed: clip.render_status === "failed",
          pending: clip.render_status === "pending" || clip.render_status === "rendering",
          title: clip.ai_title || "Untitled clip",
          range: `${formatTimecode(start)} – ${formatTimecode(end)}`,
        };
      })
      .filter(Boolean);
  }, [clips, duration, hasScale]);

  return (
    <section className={styles.wrap} aria-label={label}>
      <header className={styles.head}>
        <span className={styles.label}>{label}</span>
        {note ? <span className={styles.note}>{note}</span> : null}
      </header>

      <div className={styles.track}>
        <div className={styles.ticks} aria-hidden="true" />

        {progressPercent !== null && Number.isFinite(progressPercent) ? (
          <div
            className={styles.progress}
            style={{ width: `${Math.max(0, Math.min(100, progressPercent))}%` }}
            aria-hidden="true"
          />
        ) : null}

        {failedAtFraction !== null && Number.isFinite(failedAtFraction) ? (
          <>
            <div
              className={styles.failedRegion}
              style={{ width: `${Math.max(0, Math.min(100, failedAtFraction * 100))}%` }}
              aria-hidden="true"
            />
            <div
              className={styles.failedMark}
              style={{ left: `${Math.max(0, Math.min(100, failedAtFraction * 100))}%` }}
              aria-hidden="true"
            />
          </>
        ) : null}

        {segments.map((segment) => {
          const isSelected = segment.id === selectedClipId;
          const className = [
            styles.segment,
            segment.failed ? styles.segmentFailed : "",
            segment.pending ? styles.segmentPending : "",
            isSelected ? styles.segmentSelected : "",
          ]
            .filter(Boolean)
            .join(" ");

          // A segment is only interactive when something can happen. In the
          // progress view there is nothing to select yet, so it stays a mark.
          if (!onSelectClip) {
            return (
              <span
                key={segment.id}
                className={className}
                style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
                aria-hidden="true"
              />
            );
          }

          return (
            <button
              key={segment.id}
              type="button"
              className={className}
              style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
              onClick={() => onSelectClip(segment.id)}
              aria-pressed={isSelected}
              title={`${segment.title} · ${segment.range}`}
              aria-label={`${segment.title}, ${segment.range}`}
            />
          );
        })}
      </div>

      <footer className={styles.scale} aria-hidden="true">
        <span>0:00</span>
        {hasScale ? <span>{formatTimecode(duration / 2)}</span> : <span className={styles.unknown}>length unknown</span>}
        <span>{hasScale ? formatTimecode(duration) : "—"}</span>
      </footer>
    </section>
  );
}
