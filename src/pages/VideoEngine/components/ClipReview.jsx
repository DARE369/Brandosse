"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, Download, Loader2, Play, SkipForward } from "lucide-react";
import { Button } from "../../../ui-v2";
import {
  aspectRatioCss,
  aspectRatioValue,
  clipDisplayTitle,
  clipScores,
  formatDuration,
  formatTimecode,
  scoreBand,
} from "../videoShared";
import styles from "./ClipReview.module.css";

/**
 * One clip, everything known about it, and the two decisions that matter.
 *
 * ── Why this view exists at all ─────────────────────────────────────────────
 * The rows and the grid are for scanning; neither can hold a rationale, a
 * transcript, and a caption without becoming unreadable. Yet all three are
 * already stored on every clip and were shown nowhere, which meant the only way
 * to judge a clip was to watch forty seconds of it. Reading four lines is
 * faster, and the source timecode answers "which part of my video is this".
 *
 * ── Keep and skip are not symmetrical ───────────────────────────────────────
 * Keep is real: it copies the file into the Library, which does not expire.
 * Skip is a marker for this pass — it records that you have judged the clip so
 * the progress count means something, and it is deliberately NOT persisted or
 * dressed up as one. Nothing is deleted by skipping, and the screen says so.
 */

export function ClipReview({
  clip,
  aspectRatio,
  rank,
  position,
  total,
  kept,
  skipped,
  busy,
  onKeep,
  onSkip,
  onSchedule,
  onPrev,
  onNext,
  onTitleChange,
  onRefreshUrl,
  onCopyCaption,
  strip,
  atStart,
  atEnd,
  playToken,
}) {
  const scores = clipScores(clip);

  // A landscape clip in a 268px rail is a postage stamp, and a portrait clip in
  // a wide one is a column of empty space either side. The player column is
  // sized to the shape it has to hold — as a custom property, so the one-column
  // layout at 820px can still override it.
  const ratio = aspectRatioValue(aspectRatio);
  const playerColumn = ratio >= 1.2 ? "480px" : ratio >= 0.9 ? "360px" : "268px";
  const frameRatio = aspectRatioCss(aspectRatio);

  const [playing, setPlaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(clipDisplayTitle(clip));
  const videoRef = useRef(null);

  // Moving to another clip must not leave the previous one's video mounted, and
  // must not carry the previous one's edited title onto it.
  useEffect(() => {
    setPlaying(false);
    setEditing(false);
    setTitle(clipDisplayTitle(clip));
  }, [clip.id, clip.ai_title]);

  // Space plays from anywhere on the screen, which is only useful if the
  // keypress reaches the element that can actually play. The parent bumps a
  // token rather than calling in, so the shortcut works before the video has
  // been mounted at all.
  useEffect(() => {
    if (!playToken || !clip.public_url) return;
    if (!playing) {
      setPlaying(true);
      return;
    }
    const node = videoRef.current;
    if (!node) return;
    if (node.paused) node.play().catch(() => {});
    else node.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playToken]);

  function commitTitle() {
    setEditing(false);
    const next = title.trim();
    if (next && next !== clipDisplayTitle(clip)) onTitleChange(next);
    else setTitle(clipDisplayTitle(clip));
  }

  const failed = clip.render_status === "failed";
  const decision = failed ? "failed" : kept ? "kept" : skipped ? "skipped" : "open";

  return (
    <section className={styles.wrap}>
      <div className={styles.pager}>
        <span className={styles.mono}>Clip {position} of {total}</span>
        <div className={styles.pagerButtons}>
          <button type="button" className={styles.step} onClick={onPrev} disabled={atStart} aria-label="Previous clip">
            <ChevronLeft size={13} aria-hidden="true" /> K
          </button>
          <button type="button" className={styles.step} onClick={onNext} disabled={atEnd} aria-label="Next clip">
            J <ChevronRight size={13} aria-hidden="true" />
          </button>
        </div>
        <span className={styles.hints}>S keep · X skip · Space play · D download</span>
      </div>

      <div className={styles.grid} style={{ "--player-column": playerColumn }}>
        <div className={styles.left}>
          <div className={styles.player} style={{ aspectRatio: frameRatio }}>
            {playing && clip.public_url ? (
              <video
                ref={videoRef}
                src={clip.public_url}
                poster={clip.thumbnail_url || undefined}
                controls
                autoPlay
                className={styles.video}
                // A signed clip link lasts 48 hours and is renewed in the
                // background. Renewal is a normal event, not a broken video.
                onError={onRefreshUrl}
              />
            ) : (
              <button
                type="button"
                className={styles.poster}
                onClick={() => setPlaying(true)}
                disabled={!clip.public_url}
                aria-label={`Play ${title}`}
                style={clip.thumbnail_url ? { backgroundImage: `url(${clip.thumbnail_url})` } : undefined}
              >
                {aspectRatio ? <span className={styles.ratioTag}>{aspectRatio}</span> : null}
                <span className={styles.playRing} aria-hidden="true">
                  <Play size={14} fill="currentColor" />
                </span>
                <span className={styles.posterDuration}>{formatDuration(clip.duration_secs)}</span>
              </button>
            )}
          </div>

          <div className={styles.decide}>
            <Button
              className={styles.keepButton}
              variant={kept ? "subtle" : "solid"}
              onClick={onKeep}
              disabled={kept || failed || busy === "keep" || !clip.public_url}
            >
              {busy === "keep" ? <Loader2 size={14} className={styles.spin} aria-hidden="true" />
                : kept ? <Check size={14} aria-hidden="true" /> : null}
              {kept ? "Kept" : "Keep"}
              <kbd className={styles.kbd}>S</kbd>
            </Button>
            <Button variant={skipped ? "subtle" : "ghost"} onClick={onSkip} disabled={failed}>
              <SkipForward size={14} aria-hidden="true" />
              {skipped ? "Skipped" : "Skip"}
              <kbd className={styles.kbd}>X</kbd>
            </Button>
            {clip.public_url ? (
              <a
                className={styles.iconLink}
                href={clip.public_url}
                download={`${title}.mp4`}
                title="Download MP4 · D"
                aria-label={`Download ${title}`}
              >
                <Download size={14} aria-hidden="true" />
              </a>
            ) : null}
          </div>

          <Button
            className={styles.scheduleButton}
            variant="subtle"
            onClick={onSchedule}
            disabled={failed || busy === "schedule" || !clip.public_url}
          >
            {busy === "schedule" ? <Loader2 size={14} className={styles.spin} aria-hidden="true" /> : null}
            Schedule this clip
          </Button>
          {/* Scheduling implies keeping, so the save happens silently — but the
              person should not have to discover that afterwards. */}
          <p className={styles.scheduleNote}>Scheduling keeps the clip first, so it survives the 7-day sweep.</p>
        </div>

        <div className={styles.right}>
          <div className={styles.metaLine}>
            <span className={styles.rankTag}>{rank === null ? "NO RANK" : `RANK ${rank}`}</span>
            <span className={styles.mono}>
              {formatDuration(clip.duration_secs)} · {formatTimecode(clip.start_time_secs)} – {formatTimecode(clip.end_time_secs)}
              {clip.platform_target ? ` · ${clip.platform_target}` : ""}
            </span>
            <span className={`${styles.decisionTag} ${styles[`decision_${decision}`]}`}>
              {failed ? "FAILED" : kept ? "KEPT" : skipped ? "SKIPPED" : "UNDECIDED"}
            </span>
          </div>

          <div className={styles.titleBlock}>
            {editing ? (
              <input
                className={styles.titleInput}
                value={title}
                autoFocus
                maxLength={120}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={commitTitle}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Enter") commitTitle();
                  if (event.key === "Escape") { setTitle(clipDisplayTitle(clip)); setEditing(false); }
                }}
                aria-label="Clip title"
              />
            ) : (
              <button type="button" className={styles.title} onClick={() => setEditing(true)}>
                {title}
              </button>
            )}
            <span className={styles.editHint}>
              {kept ? "Already kept — edit the copy in your Library" : "Click to edit before you keep it"}
            </span>
          </div>

          <div className={styles.scores}>
            {[
              { key: "hook", label: "HOOK", value: scores.hook, lead: true },
              { key: "flow", label: "FLOW", value: scores.flow },
              { key: "content", label: "CONTENT", value: scores.content },
              { key: "trend", label: "TREND", value: scores.trend },
              { key: "overall", label: "OVERALL", value: scores.overall },
            ].map((score) => (
              <div key={score.key} className={score.lead ? styles.scoreLead : styles.score}>
                <span className={styles.scoreLabel}>{score.label}</span>
                <span
                  className={`${styles.scoreValue} ${score.lead ? styles.scoreAccent : styles[`band_${scoreBand(score.value)}`]}`}
                >
                  {/* Absent reads as unknown. Never 0 — that is a verdict the
                      pipeline did not make. */}
                  {score.value === null ? "—" : score.value}
                </span>
              </div>
            ))}
          </div>

          {clip.why_this_works ? (
            <div className={styles.why}>
              <span className={styles.sectionLabel}>Why this works</span>
              <p>{clip.why_this_works}</p>
            </div>
          ) : null}

          {clip.transcript_excerpt ? (
            <div>
              <span className={styles.sectionLabel}>
                Transcript · {formatTimecode(clip.start_time_secs)} – {formatTimecode(clip.end_time_secs)}
              </span>
              <p className={styles.transcript}>{`“${clip.transcript_excerpt}”`}</p>
            </div>
          ) : null}

          {clip.ai_caption ? (
            <div>
              <div className={styles.captionHead}>
                <span className={styles.sectionLabel}>Suggested caption</span>
                <button type="button" className={styles.copy} onClick={() => onCopyCaption(clip.ai_caption)}>
                  <Copy size={12} aria-hidden="true" /> Copy
                </button>
              </div>
              <p className={styles.caption}>{clip.ai_caption}</p>
            </div>
          ) : null}

          {failed ? (
            <p className={styles.failNote}>
              {clip.error_message ? `${clip.error_message}. ` : ""}
              This clip did not render, and you were not charged for it.
            </p>
          ) : null}
        </div>
      </div>

      {/* The filmstrip is the only place the whole set stays visible while you
          are inside one clip, so it carries each clip's decision as a dot. */}
      <div className={styles.strip}>
        {strip.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.active ? styles.stripItemActive : styles.stripItem}
            style={{ aspectRatio: frameRatio, ...(item.thumbnail ? { backgroundImage: `url(${item.thumbnail})` } : {}) }}
            onClick={item.onSelect}
            aria-label={`Go to ${item.title}`}
            aria-current={item.active ? "true" : undefined}
            title={item.title}
          >
            <span className={styles.stripRank}>{item.label}</span>
            <span className={`${styles.stripDot} ${styles[`dot_${item.decision}`]}`} aria-hidden="true" />
            <span className={styles.stripDuration}>{item.duration}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
