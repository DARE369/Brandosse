import styles from "./EmptyState.module.css";

/** "Nothing here yet" / "No results" pattern — dashed border for true first-use empty, solid for filtered/error empties. */
export function EmptyState({ title, description, dashed = false, actions, className = "" }) {
  const classes = [styles.wrap, dashed ? styles.dashed : "", className].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      <div className={styles.title}>{title}</div>
      {description ? <div className={styles.desc}>{description}</div> : null}
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}
