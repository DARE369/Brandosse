import React from "react";
import {
  AlertTriangle,
  BellRing,
  CheckCheck,
  CircleAlert,
  ExternalLink,
  ShieldAlert,
  Ticket,
} from "lucide-react";
import { ADMIN_NOTIFICATION_TYPE, RISK_LEVEL_LABEL } from "../../constants/statuses";
import { formatRelativeTime } from "../utils/formatDate";

const TYPE_ICON = {
  [ADMIN_NOTIFICATION_TYPE.RISK_ALERT]: ShieldAlert,
  [ADMIN_NOTIFICATION_TYPE.COMPLAINT_SUBMITTED]: Ticket,
  [ADMIN_NOTIFICATION_TYPE.COMPLAINT_STALE]: AlertTriangle,
};

function getNotificationSections(notifications) {
  const riskAlerts = [];
  const activity = [];

  (notifications || []).forEach((notification) => {
    if (notification.type === ADMIN_NOTIFICATION_TYPE.RISK_ALERT) {
      riskAlerts.push(notification);
      return;
    }
    activity.push(notification);
  });

  return [
    { title: "Risk Alerts", items: riskAlerts },
    { title: "Activity", items: activity },
  ];
}

function getActionLabel(notification) {
  if (notification.type === ADMIN_NOTIFICATION_TYPE.RISK_ALERT) return "View in Logs";
  if (notification.type === ADMIN_NOTIFICATION_TYPE.COMPLAINT_SUBMITTED) return "Go to Complaint";
  return "Open";
}

export default function AdminNotificationCenter({
  open,
  notifications,
  unreadCount,
  onClose,
  onMarkAllRead,
  onMarkOneRead,
  onOpenEntity,
}) {
  if (!open) return null;

  const sections = getNotificationSections(notifications);

  return (
    <div className="admin-popover admin-notification-center" role="dialog" aria-label="Admin notifications">
      <div className="admin-popover-header">
        <div>
          <h3>Notifications</h3>
          <p>{unreadCount} unread</p>
        </div>
        <button type="button" className="admin-inline-button" onClick={onMarkAllRead}>
          <CheckCheck size={14} />
          Mark all read
        </button>
      </div>

      {sections.map((section) => (
        <section key={section.title} className="admin-notification-group">
          <div className="admin-popover-subheader">
            <span>{section.title}</span>
            <span>{section.items.length}</span>
          </div>

          {section.items.length ? (
            section.items.map((notification) => {
              const Icon = TYPE_ICON[notification.type] || (notification.severity === "high" || notification.severity === "very_high" ? CircleAlert : BellRing);
              const isRead = Boolean(notification.read);
              const severity = notification.severity || "low";

              return (
                <article
                  key={notification.id}
                  className={`admin-notification-item ${isRead ? "" : "unread"} severity-${severity}`}
                >
                  <div className="admin-notification-severity" />

                  <div className="admin-notification-icon">
                    <Icon size={15} />
                  </div>

                  <div className="admin-notification-copy">
                    <div className="admin-notification-title-row">
                      <h4>{notification.title}</h4>
                      <span className={`admin-notification-risk severity-${severity}`}>
                        {RISK_LEVEL_LABEL[severity] || severity}
                      </span>
                    </div>
                    <p>{notification.body || "No additional detail."}</p>
                    <span>{formatRelativeTime(notification.created_at)}</span>
                  </div>

                  <div className="admin-notification-actions">
                    {(notification.type === ADMIN_NOTIFICATION_TYPE.RISK_ALERT || notification.metadata?.complaint_id || notification.entity_id) ? (
                      <button
                        type="button"
                        className="admin-inline-button"
                        onClick={() => onOpenEntity(notification)}
                      >
                        <ExternalLink size={14} />
                        {getActionLabel(notification)}
                      </button>
                    ) : null}
                    {!isRead ? (
                      <button
                        type="button"
                        className="admin-inline-button"
                        onClick={() => onMarkOneRead(notification.id)}
                      >
                        Read
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })
          ) : (
            <div className="admin-empty-inline">Nothing here.</div>
          )}
        </section>
      ))}

      <button type="button" className="admin-popover-dismiss" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
