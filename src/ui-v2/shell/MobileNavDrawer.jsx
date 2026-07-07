"use client";

import { Drawer } from "../primitives/Drawer";
import styles from "./MobileNavDrawer.module.css";

/** Slide-out nav for the &lt;900px burger fallback — mirrors AppHeader's navItems/activeKey/onNavClick contract. */
export function MobileNavDrawer({ open, onClose, navItems, activeKey, onNavClick }) {
  return (
    <Drawer open={open} onClose={onClose} title="Menu" width="min(280px, 84vw)">
      <nav className={styles.list}>
        {navItems.map((item) => (
          <button
            key={item.key}
            type="button"
            className={[styles.link, item.key === activeKey ? styles.linkActive : ""].join(" ")}
            onClick={() => { onNavClick(item); onClose(); }}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </Drawer>
  );
}
