"use client";

import { useState } from "react";
import { Dropdown } from "../primitives/Dropdown";
import { useLogout } from "../../hooks/useLogout";
import styles from "./AvatarMenu.module.css";

const LINKS = [
  { label: "Analytics", href: "/app/analytics" },
  { label: "Settings", href: "/app/settings" },
  { label: "Billing & credits", href: "/app/billing" },
  { label: "Help & support", href: "/app/help" },
];

/**
 * Reference links that leave the app shell. `newTab` is not decoration: /legal
 * is a public page outside the signed-in product, so navigating to it in place
 * tears down the shell and drops whatever the user was doing. Someone checking
 * a clause mid-task should come back to the task.
 *
 * One entry, pointing at the hub, rather than six pointing at each document —
 * a dropdown with six policy links is a dropdown nobody reads.
 */
const REFERENCE_LINKS = [{ label: "Legal & policies", href: "/legal", newTab: true }];

/**
 * Real avatar dropdown menu — every mockup's header links Analytics/Settings/
 * Billing/Help + Sign out from here. Previously `AppHeader`'s Avatar just
 * navigated straight to /app/profile with no menu at all.
 */
export function AvatarMenu({ initials, name, email, onNavigate }) {
  const [open, setOpen] = useState(false);
  const { initiateLogout } = useLogout();

  return (
    <Dropdown
      open={open}
      onClose={() => setOpen(false)}
      align="right"
      width="210px"
      trigger={
        <button type="button" className={styles.avatar} onClick={() => setOpen((v) => !v)}>
          {initials}
        </button>
      }
    >
      <div className={styles.header}>
        <div className={styles.name}>{name || "Creator"}</div>
        <div className={styles.sub}>{email || "Solo creator"}</div>
      </div>
      {LINKS.map((link) => (
        <button
          key={link.href}
          type="button"
          className={styles.item}
          onClick={() => {
            setOpen(false);
            onNavigate?.(link.href);
          }}
        >
          {link.label}
        </button>
      ))}
      <div className={styles.separator} />
      {REFERENCE_LINKS.map((link) => (
        <a
          key={link.href}
          href={link.href}
          className={styles.item}
          target={link.newTab ? "_blank" : undefined}
          rel={link.newTab ? "noopener noreferrer" : undefined}
          onClick={() => setOpen(false)}
        >
          {link.label}
        </a>
      ))}
      <div className={styles.separator} />
      <button
        type="button"
        className={[styles.item, styles.danger].join(" ")}
        onClick={() => {
          setOpen(false);
          initiateLogout();
        }}
      >
        Sign out
      </button>
    </Dropdown>
  );
}
