import styles from "./IconButton.module.css";

/** Square icon-only button used in the header (theme toggle, notif bell, video jobs, etc). */
export function IconButton({ children, title, showDot = false, className = "", ...rest }) {
  const classes = [styles.iconBtn, className].filter(Boolean).join(" ");
  return (
    <button type="button" className={classes} title={title} aria-label={title} {...rest}>
      {children}
      {showDot ? <span className={styles.dot} /> : null}
    </button>
  );
}
