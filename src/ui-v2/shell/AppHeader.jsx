import styles from "./AppHeader.module.css";

/**
 * Shared top chrome for all v2 screens: brand mark, nav links (with mobile
 * burger fallback under 900px), an optional slot for search/extra controls,
 * and a right-side slot for credits/theme-toggle/notif/avatar — each screen
 * composes its own right-side controls from primitives (IconButton, Dropdown,
 * etc.) since the exact set differs per mockup (e.g. Studio has a video-jobs
 * button, Dashboard has a search box, Library/Calendar have neither).
 */
export function AppHeader({
  brandLabel = "Studio",
  brandMark = "S",
  navItems = [],
  activeKey,
  onNavClick,
  onBurgerClick,
  leftExtra,
  right,
  className = "",
}) {
  return (
    <header className={[styles.header, className].filter(Boolean).join(" ")}>
      <div className={styles.brand}>
        <span className={styles.mark}>{brandMark}</span>
        <span className={styles.wordmark}>{brandLabel}</span>
      </div>

      <nav className={styles.navLinks}>
        {navItems.map((item) => (
          <NavLink key={item.key} active={item.key === activeKey} onClick={() => onNavClick?.(item)}>
            {item.label}
          </NavLink>
        ))}
      </nav>

      {navItems.length > 0 ? (
        <button type="button" className={styles.burger} onClick={onBurgerClick} aria-label="Open menu">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}

      {leftExtra ? <div className={styles.leftExtra}>{leftExtra}</div> : null}

      <div className={styles.right}>{right}</div>
    </header>
  );
}

export function NavLink({ active, onClick, children }) {
  return (
    <button
      type="button"
      className={[styles.navLink, active ? styles.navLinkActive : ""].filter(Boolean).join(" ")}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Credit balance pill shown in every header's right slot. */
export function CreditPill({ pct, label }) {
  return (
    <div className={styles.creditPill}>
      <span className={styles.creditTrack}>
        <span className={styles.creditFill} style={{ width: pct }} />
      </span>
      <span className={styles.creditLabel}>{label}</span>
    </div>
  );
}

export function Avatar({ initials, onClick, ...rest }) {
  return (
    <button type="button" className={styles.avatar} onClick={onClick} {...rest}>
      {initials}
    </button>
  );
}
