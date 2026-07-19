"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { IconButton } from "../primitives/IconButton";
import { Dropdown } from "../primitives/Dropdown";
import { useUserNotifications, formatNotificationTime } from "../../hooks/useUserNotifications";
import styles from "./NotificationBell.module.css";

/**
 * Real notification bell for every ui-v2 header — same feed as the old
 * UserNavbar (src/components/User/UserNavbar.jsx), reskinned per the
 * Studio.dc.html mockup's notif dropdown (unread dot, mark-all-read, list).
 */
export function NotificationBell({ userId, onNavigate }) {
  const [open, setOpen] = useState(false);
  const { notifications, unreadCount, markAllRead, markOneRead, handleOpen } = useUserNotifications(userId);

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      if (next) handleOpen();
      return next;
    });
  };

  return (
    <Dropdown
      open={open}
      onClose={() => setOpen(false)}
      align="right"
      width="300px"
      trigger={
        <IconButton title="Notifications" showDot={unreadCount > 0} onClick={toggle}>
          <Bell size={15} />
        </IconButton>
      }
    >
      <div className={styles.head}>
        <span className={styles.title}>Notifications</span>
        <button type="button" className={styles.markRead} onClick={() => markAllRead()}>
          Mark all read
        </button>
      </div>
      <div className={styles.list}>
        {notifications.length === 0 ? (
          <div className={styles.empty}>No notifications yet.</div>
        ) : (
          notifications.map((n) => (
            <button
              key={n.id}
              type="button"
              className={styles.item}
              onClick={() => {
                setOpen(false);
                markOneRead(n);
                if (n.route) onNavigate?.(n.route);
              }}
            >
              <span className={[styles.dot, n.unread === true ? styles.dotUnread : ""].join(" ")} />
              <span className={styles.body}>
                <span className={styles.headline}>{n.headline}</span>
                {n.detail ? <span className={styles.detail}>{n.detail}</span> : null}
                <span className={styles.time}>{formatNotificationTime(n.timestamp)}</span>
              </span>
            </button>
          ))
        )}
      </div>
    </Dropdown>
  );
}
