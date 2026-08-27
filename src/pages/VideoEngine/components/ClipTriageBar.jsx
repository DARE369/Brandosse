"use client";

import styles from "./ClipTriageBar.module.css";

/**
 * The one strip above the clips that says how far through the set you are, and
 * how you want to look at them.
 *
 * ── Why a progress count at all ─────────────────────────────────────────────
 * The real verb on this screen is not "look at seven clips", it is "keep these
 * four and bin the rest". That is a task with a finish line, and a task with a
 * finish line that never says how close you are gets abandoned halfway. The
 * count is derived from real decisions — a clip is decided when it has been
 * kept (a Library asset exists) or skipped, and a clip that failed to render is
 * decided for you.
 *
 * ── Four views, because triage is three different jobs ──────────────────────
 * Review is one clip at a time with everything known about it, which is how you
 * judge. List and Grid are for scanning. Table is for comparing five numbers
 * across seven clips, which no card layout can do honestly. They are views of
 * one selection, not four screens: keeping in any of them keeps the same clip.
 */

const VIEWS = [
  { key: "review", label: "Review", hint: "1" },
  { key: "grid", label: "Grid", hint: "2" },
  { key: "list", label: "List", hint: "3" },
  { key: "table", label: "Table", hint: "4" },
];

export function ClipTriageBar({
  view,
  onViewChange,
  filter,
  onFilterChange,
  counts,
}) {
  const { total, decided, kept, skipped, failed, undecided } = counts;
  const pct = total > 0 ? Math.round((decided / total) * 100) : 0;

  const filters = [
    { key: "all", label: `All ${total}` },
    { key: "kept", label: `Kept ${kept}` },
    { key: "undecided", label: `Undecided ${undecided}` },
    // A filter for a set that is empty is a dead end, so the failed pill only
    // exists on jobs that actually had a clip fail.
    ...(failed > 0 ? [{ key: "failed", label: `Failed ${failed}` }] : []),
  ];

  return (
    <div className={styles.bar}>
      <div className={styles.progress}>
        <span className={styles.progressCount}>{decided} of {total} reviewed</span>
        <span className={styles.track} role="progressbar" aria-valuenow={decided} aria-valuemin={0} aria-valuemax={total}>
          <span className={styles.fill} style={{ width: `${pct}%` }} />
        </span>
        <span className={styles.progressNote}>
          {kept} kept · {skipped} skipped
        </span>
      </div>

      <div className={styles.views} role="tablist" aria-label="How to view the clips">
        {VIEWS.map((option) => (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={view === option.key}
            className={view === option.key ? styles.viewActive : styles.view}
            onClick={() => onViewChange(option.key)}
          >
            {option.label}
            <kbd className={styles.kbd}>{option.hint}</kbd>
          </button>
        ))}
      </div>

      <div className={styles.filters}>
        {filters.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={filter === option.key}
            className={filter === option.key ? styles.pillActive : styles.pill}
            onClick={() => onFilterChange(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
