import React from 'react';
import {
  BellRing,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  MessageSquareText,
  Workflow,
  X,
} from 'lucide-react';

function formatRelativeTime(value) {
  const nextDate = new Date(value);
  if (Number.isNaN(nextDate.getTime())) return 'Now';

  const diffMinutes = Math.floor((Date.now() - nextDate.getTime()) / 60000);
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return nextDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getNotificationIcon(notification) {
  const type = String(notification?.requested_type || notification?.type || '').toLowerCase();
  if (notification?.source === 'common_room') return MessageSquareText;
  if (type.includes('pipeline') || type.includes('revision')) return Workflow;
  if (type.includes('task') || type.includes('scheduled') || type.includes('published')) return Clock3;
  return BellRing;
}

function getNotificationLabel(notification) {
  const type = String(notification?.requested_type || notification?.type || '').toLowerCase();
  if (notification?.source === 'common_room') return 'Common Room';
  if (type.includes('task')) return 'Task';
  if (type.includes('pipeline') || type.includes('revision')) return 'Pipeline';
  if (type.includes('scheduled') || type.includes('published')) return 'Calendar';
  if (type.includes('invitation')) return 'Invite';
  return 'Notification';
}

export default function OrgNotificationCenter({
  open,
  notifications = [],
  unreadCount = 0,
  loading = false,
  error = '',
  onClose,
  onMarkAllRead,
  onOpenNotification,
  onMarkOneRead,
  onDismissOne,
  onSnoozeOne,
  onOpenCommonRoom,
}) {
  if (!open) return null;

  return (
    <div className="org-notification-center" role="dialog" aria-label="Notifications">
      <div className="org-notification-center-header">
        <div>
          <h3>Notifications</h3>
          <p>{unreadCount} unread</p>
        </div>
        <div className="org-notification-center-actions">
          <button type="button" className="org-text-button" onClick={onOpenCommonRoom}>
            Common Room
          </button>
          <button type="button" className="org-text-button" onClick={onMarkAllRead}>
            <CheckCheck size={14} />
            Mark all read
          </button>
        </div>
      </div>

      {loading ? <div className="org-notification-empty">Loading notifications...</div> : null}
      {!loading && error ? <div className="org-notification-empty">{error}</div> : null}

      {!loading && !error ? (
        notifications.length ? (
          <div className="org-notification-list">
            {notifications.map((notification) => {
              const Icon = getNotificationIcon(notification);
              const unreadCountForItem = Number(notification?.unread_count || 0);
              const unread = unreadCountForItem > 0;
              const canMutate = notification.source === 'user_notification';

              return (
                <article
                  key={notification.id}
                  className={`org-notification-item ${unread ? 'unread' : ''}`.trim()}
                >
                  <div className="org-notification-item-main">
                    <div className="org-notification-item-icon">
                      <Icon size={15} />
                    </div>

                    <button
                      type="button"
                      className="org-notification-open"
                      onClick={() => onOpenNotification(notification)}
                    >
                      <div className="org-notification-item-copy">
                        <div className="org-notification-item-title-row">
                          <h4>{notification.title}</h4>
                          <span className="org-notification-item-time">{formatRelativeTime(notification.created_at)}</span>
                        </div>
                        <p>{notification.body || 'Open to view details.'}</p>
                        <div className="org-notification-item-meta">
                          <span className="org-notification-item-tag">{getNotificationLabel(notification)}</span>
                          {notification.source === 'common_room' ? (
                            <span className="org-notification-item-count">{unreadCountForItem} unread</span>
                          ) : null}
                        </div>
                      </div>
                      <ChevronRight size={14} />
                    </button>
                  </div>

                  <div className="org-notification-item-actions">
                    {canMutate && unread ? (
                      <button type="button" className="org-text-button" onClick={() => onMarkOneRead(notification.id)}>
                        <Check size={14} />
                        Read
                      </button>
                    ) : null}

                    {canMutate ? (
                      <button type="button" className="org-text-button" onClick={() => onSnoozeOne(notification.id)}>
                        <Clock3 size={14} />
                        Snooze 1d
                      </button>
                    ) : null}

                    {canMutate ? (
                      <button type="button" className="org-text-button danger" onClick={() => onDismissOne(notification.id)}>
                        <X size={14} />
                        Dismiss
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="org-notification-empty">No notifications right now.</div>
        )
      ) : null}

      <button type="button" className="org-text-button org-notification-close" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
