"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Download, Loader2, Play } from "lucide-react";
import { Button } from "../../../ui-v2";
import { formatDuration, formatTimecode, normaliseScore } from "../videoShared";
import styles from "./ClipRow.module.css";

/**
 * One clip, as a row rather than a card.
 *
 * ── Why a row ───────────────────────────────────────────────────────────────
 * Triage is comparison. A row puts rank, title, hook score, duration, source
 * timecode, and the first words of the transcript on one scan line, so six
 * clips can be judged against each other without opening any of them. A poster
 * grid cannot do that — it shows six thumbnails of a talking head, which are
 * indistinguishable.
 *
 * ── What is shown here that never was ───────────────────────────────────────
 * The transcript excerpt and the source timecode were both stored on every clip
 * since the table was created and displayed nowhere. Reading four lines is
 * faster than watching forty seconds, and the timecode answers "which part of
 * my video is this".
 *
 * ── Editing before keeping ──────────────────────────────────────────────────
 * Nobody posts a machine-written caption verbatim. The title is editable at the
 * point of decision so the edit rides along into the Library asset, rather than
 * requiring a round trip through Library afterwards. The edit is NOT written
 * back to video_clips: RLS forbids user updates to that table
 * ("Users cannot update clips directly"), and the clip row is the pipeline's
 * record of what it produced, not the user's copy.
 */

export function ClipRow({
  clip,
  rank,
  selected,
  checked,
  kept,
  onSelect,
  onToggleCheck,
  onKeep,
  onSchedule,
  onRefreshUrl,
  onRerunJob,
}) {
  const failed = clip.render_status === "failed";
  const pending = clip.render_status === "pending" || clip.render_status === "rendering";

  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState("");
  const [title, setTitle] = useState(clip.ai_title || "");
  const [editing, setEditing] = useState(false);
  const videoRef = useRef(null);

  useEffect(() => {
    setTitle(clip.ai_title || "");
  }, [clip.ai_title]);

  const overall = normaliseScore(clip.overall_score);
  const hook = normaliseScore(clip.hook_score);
  const flow = normaliseScore(clip.flow_score);
  const value = normaliseScore(clip.content_score);
  const trend = normaliseScore(clip.trend_score);

  const displayTitle = title || `Clip ${(clip.clip_index ?? 0) + 1}`;
  const overrides = { ai_title: displayTitle };

  async function run(kind, fn) {
    setBusy(kind);
    try {
      await fn();
    } finally {
      setBusy("");
    }
  }

  if (failed) {
    return (
      <div className={`${styles.row} ${styles.rowFailed}`}>
        <span className={styles.checkSlot} aria-hidden="true" />
        <span className={styles.thumb} aria-hidden="true" />
        <div className={styles.body}>
          <div className={styles.titleLine}>
            <span className={styles.rank}>—</span>
            <span className={styles.titleFailed}>{clip.ai_title || "Untitled"} — did not render</span>
          </div>
          <p className={styles.failNote}>
            {clip.error_message ? `${clip.error_message}. ` : ""}You were not charged for this clip.
          </p>
        </div>
        <div className={styles.scores}>
          {clip.start_time_secs !== null && clip.start_time_secs !== undefined ? (
            <span className={styles.mono}>
              {formatTimecode(clip.start_time_secs)} – {formatTimecode(clip.end_time_secs)}
            </span>
          ) : null}
        </div>
        <div className={styles.actions}>
          {/* There is no per-clip re-render in this pipeline — the worker
              renders whole jobs. Offering "retry this clip, free" would promise
              work the system cannot do, so the honest action is the real one,
              with its real price. */}
          <Button size="sm" variant="subtle" onClick={onRerunJob}>Run the video again</Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={[styles.row, selected ? styles.rowSelected : "", checked ? styles.rowChecked : ""].filter(Boolean).join(" ")}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter") onSelect();
      }}
    >
      <span className={styles.checkSlot} onClick={(event) => event.stopPropagation()}>
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggleCheck}
          aria-label={`Select ${displayTitle}`}
        />
      </span>

      <div className={styles.thumb} onClick={(event) => event.stopPropagation()}>
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
            className={styles.playButton}
            onClick={() => setPlaying(true)}
            disabled={pending || !clip.public_url}
            aria-label={`Play ${displayTitle}`}
            style={clip.thumbnail_url ? { backgroundImage: `url(${clip.thumbnail_url})` } : undefined}
          >
            {pending ? <Loader2 size={14} className={styles.spin} /> : <Play size={14} fill="currentColor" />}
            <span className={styles.thumbDuration}>{formatDuration(clip.duration_secs)}</span>
          </button>
        )}
      </div>

      <div className={styles.body}>
        <div className={styles.titleLine}>
          <span className={styles.rank}>{rank !== null ? String(rank).padStart(2, "0") : "—"}</span>
          {editing ? (
            <input
              className={styles.titleInput}
              value={title}
              autoFocus
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => setEditing(false)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === "Escape") setEditing(false);
                event.stopPropagation();
              }}
              onClick={(event) => event.stopPropagation()}
              aria-label="Clip title"
              maxLength={120}
            />
          ) : (
            <button
              type="button"
              className={styles.title}
              onClick={(event) => { event.stopPropagation(); setEditing(true); }}
              title="Click to edit before you keep it"
            >
              {displayTitle}
            </button>
          )}
          {kept ? <span className={styles.keptTag}>KEPT</span> : null}
        </div>

        {clip.transcript_excerpt ? (
          <p className={styles.excerpt}>“{clip.transcript_excerpt}”</p>
        ) : clip.ai_caption ? (
          <p className={styles.excerpt}>{clip.ai_caption}</p>
        ) : null}

        {selected && clip.why_this_works ? (
          <p className={styles.why}>{clip.why_this_works}</p>
        ) : null}
      </div>

      <div className={styles.scores}>
        {/* Hook leads because it is the strongest single predictor of whether a
            clip gets watched. An absent score reads as unknown, never as zero. */}
        <span className={hook === null ? styles.scoreUnknown : styles.scoreHook}>
          {hook === null ? "NO SCORE" : `HOOK ${hook}`}
        </span>
        <span className={styles.mono}>
          {[
            flow === null ? null : `F ${flow}`,
            value === null ? null : `C ${value}`,
            trend === null ? null : `T ${trend}`,
            overall === null ? null : `Σ ${overall}`,
          ].filter(Boolean).join(" · ") || "—"}
        </span>
        <span className={styles.mono}>
          {formatTimecode(clip.start_time_secs)} – {formatTimecode(clip.end_time_secs)}
        </span>
        {clip.platform_target ? <span className={styles.platform}>{clip.platform_target}</span> : null}
      </div>

      <div className={styles.actions} onClick={(event) => event.stopPropagation()}>
        <Button
          size="sm"
          variant={kept ? "subtle" : "solid"}
          onClick={() => run("keep", () => onKeep(overrides))}
          disabled={busy === "keep" || kept}
        >
          {busy === "keep" ? <Loader2 size={13} className={styles.spin} aria-hidden="true" />
            : kept ? <Check size={13} aria-hidden="true" /> : null}
          {kept ? "Kept" : "Keep"}
        </Button>
        <Button size="sm" variant="subtle" onClick={() => run("schedule", () => onSchedule(overrides))} disabled={busy === "schedule"}>
          {busy === "schedule" ? <Loader2 size={13} className={styles.spin} aria-hidden="true" /> : null}
          Schedule
        </Button>
        {clip.public_url ? (
          <a
            className={styles.iconLink}
            href={clip.public_url}
            download={`${displayTitle}.mp4`}
            aria-label={`Download ${displayTitle}`}
            title="Download MP4"
          >
            <Download size={14} aria-hidden="true" />
          </a>
        ) : null}
      </div>
    </div>
  );
}
