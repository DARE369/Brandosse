"use client";

import { Check, Loader2 } from "lucide-react";
import { Button } from "../../../ui-v2";
import { clipDisplayTitle, clipScores, formatDuration, formatTimecode, scoreBand } from "../videoShared";
import styles from "./ClipTable.module.css";

/**
 * Five numbers across every clip, sortable.
 *
 * ── Why a table and not thirty-five gauges ──────────────────────────────────
 * Each clip carries hook, flow, content, trend and overall. Drawn as rings or
 * radar plots that is thirty-five pieces of chartjunk on a seven-clip job, and
 * comparing any two of them by eye is impossible. A table with tabular numerals
 * is the only honest way to answer "which of these actually scored better on
 * flow", which is the question this view exists for.
 *
 * An absent score prints "—". It is never rendered as 0 and never sorts as 0:
 * missing means the model did not score it, and treating that as the worst
 * possible value would silently push those clips to the bottom of every sort.
 */

const COLUMNS = [
  { key: "rank", label: "#", align: "left", cls: "cRank" },
  { key: "title", label: "Clip", align: "left", cls: "cTitle" },
  { key: "duration", label: "Length", align: "right", cls: "cLen" },
  { key: "start", label: "In – out", align: "right", cls: "cTc" },
  { key: "hook", label: "Hook", align: "right", cls: "cScore" },
  { key: "flow", label: "Flow", align: "right", cls: "cFlow" },
  { key: "content", label: "Content", align: "right", cls: "cContent" },
  { key: "trend", label: "Trend", align: "right", cls: "cTrend" },
  { key: "overall", label: "Overall", align: "right", cls: "cScore" },
];

export function ClipTable({
  clips,
  activeId,
  sortKey,
  sortDir,
  onSort,
  decisionOf,
  keptIds,
  checkedIds,
  onToggleCheck,
  busyId,
  onOpen,
  onKeep,
}) {
  return (
    <section className={styles.table}>
      <div className={`${styles.row} ${styles.head}`}>
        <span className={styles.cCheck} />
        {COLUMNS.map((column) => (
          <button
            key={column.key}
            type="button"
            className={`${styles[column.cls]} ${styles.headCell} ${sortKey === column.key ? styles.headActive : ""}`}
            style={{ textAlign: column.align }}
            onClick={() => onSort(column.key)}
            aria-sort={sortKey === column.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
          >
            {column.label}
            {sortKey === column.key ? <span aria-hidden="true">{sortDir === "asc" ? " ↑" : " ↓"}</span> : null}
          </button>
        ))}
        <span className={styles.cState}>State</span>
        <span className={styles.cAction} />
      </div>

      {clips.map((clip) => {
        const scores = clipScores(clip);
        const failed = clip.render_status === "failed";
        const kept = keptIds.has(clip.id);
        const decision = decisionOf(clip);
        const title = clipDisplayTitle(clip);

        return (
          <div
            key={clip.id}
            className={[
              styles.row,
              styles.bodyRow,
              clip.id === activeId ? styles.rowActive : "",
              checkedIds.has(clip.id) ? styles.rowChecked : "",
              decision === "skipped" ? styles.rowSkipped : "",
            ].filter(Boolean).join(" ")}
          >
            <span className={styles.cCheck}>
              <input
                type="checkbox"
                checked={checkedIds.has(clip.id)}
                onChange={() => onToggleCheck(clip.id)}
                aria-label={`Select ${title}`}
                disabled={failed}
              />
            </span>

            <span className={`${styles.cRank} ${styles.mono}`}>
              {clip.rank === null ? "—" : String(clip.rank).padStart(2, "0")}
            </span>

            <button type="button" className={`${styles.cTitle} ${styles.titleCell}`} onClick={() => onOpen(clip)}>
              <span className={styles.titleText}>{title}</span>
              <span className={styles.titleSub}>{clip.platform_target || (failed ? "did not render" : "—")}</span>
            </button>

            <span className={`${styles.cLen} ${styles.num}`}>{formatDuration(clip.duration_secs)}</span>
            <span className={`${styles.cTc} ${styles.num}`}>
              {formatTimecode(clip.start_time_secs)} – {formatTimecode(clip.end_time_secs)}
            </span>

            {[
              ["cScore", scores.hook],
              ["cFlow", scores.flow],
              ["cContent", scores.content],
              ["cTrend", scores.trend],
              ["cScore", scores.overall],
            ].map(([cls, value], index) => (
              // eslint-disable-next-line react/no-array-index-key
              <span key={index} className={`${styles[cls]} ${styles.num} ${styles[`band_${scoreBand(value)}`]}`}>
                {value === null ? "—" : value}
              </span>
            ))}

            <span className={`${styles.cState} ${styles.mono} ${styles[`state_${decision}`]}`}>
              {failed ? "FAILED" : kept ? "KEPT" : decision === "skipped" ? "SKIPPED" : "UNDECIDED"}
            </span>

            <span className={styles.cAction}>
              <Button
                size="sm"
                variant={kept || failed ? "subtle" : "solid"}
                onClick={() => onKeep(clip)}
                disabled={kept || failed || busyId === clip.id || !clip.public_url}
              >
                {busyId === clip.id ? <Loader2 size={13} className={styles.spin} aria-hidden="true" />
                  : kept ? <Check size={13} aria-hidden="true" /> : null}
                {kept ? "Kept" : "Keep"}
              </Button>
            </span>
          </div>
        );
      })}

      <div className={styles.foot}>
        <span>{clips.length} shown · click a column to sort</span>
        <span>Absent scores read as —, never 0</span>
      </div>
    </section>
  );
}
