// src/hooks/useUserNotifications.js
// Real notification feed shared by every header — extracted from the original
// src/components/User/UserNavbar.jsx (old design system) so ui-v2 pages (Studio,
// Dashboard, Library, Calendar, and beyond) can show the exact same bell without
// duplicating the generations/posts/admin-message merge logic. Behavior is
// unchanged from UserNavbar: activity items (generation/post updates) are
// "unread" based on a per-user localStorage seen-timestamp, admin messages
// track real is_read/read_at on user_notifications.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../services/supabaseClient";
import {
  GENERATION_NOTIFICATION_HEADLINES,
  GENERATION_STATUS,
  POST_NOTIFICATION_HEADLINES,
  POST_STATUS,
  USER_NOTIFICATION_TYPE,
} from "../constants/statuses";

const NOTIFICATION_STORAGE_KEY = "socialai-notification-seen";
const GENERATION_NOTIFICATION_STATUSES = [
  GENERATION_STATUS.COMPLETED,
  GENERATION_STATUS.PROCESSING,
  GENERATION_STATUS.FAILED,
];
const POST_NOTIFICATION_STATUSES = new Set([
  POST_STATUS.PUBLISHED,
  POST_STATUS.SCHEDULED,
  POST_STATUS.FAILED,
]);

function getTitleFromPrompt(prompt) {
  if (!prompt || typeof prompt !== "string") return "Untitled Generation";
  const words = prompt.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "Untitled Generation";
  const base = words.slice(0, 7).join(" ");
  return words.length > 7 ? `${base}...` : base;
}

function getGenerationTitle(generation) {
  const metadataTitle = generation?.metadata?.title;
  if (typeof metadataTitle === "string" && metadataTitle.trim()) return metadataTitle.trim();
  if (typeof generation?.title === "string" && generation.title.trim()) return generation.title.trim();
  return getTitleFromPrompt(generation?.prompt);
}

export function formatNotificationTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Now";
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function buildGenerationRoute(generation) {
  const sessionPath = generation?.session_id ? `/app/generate/${generation.session_id}` : "/app/generate";
  return generation?.id ? `${sessionPath}#${generation.id}` : sessionPath;
}

function normalizePostAccountData(connectedAccount) {
  if (!connectedAccount) return { platform: "Platform", accountName: "Unknown account" };
  if (Array.isArray(connectedAccount)) {
    const first = connectedAccount[0] ?? {};
    return { platform: first.platform ?? "Platform", accountName: first.account_name ?? "Unknown account" };
  }
  return { platform: connectedAccount.platform ?? "Platform", accountName: connectedAccount.account_name ?? "Unknown account" };
}

/**
 * Real notification feed for the current user: recent generation/post lifecycle
 * updates merged with admin-sent messages (user_notifications table), kept live
 * via realtime subscriptions. Returns everything a bell dropdown needs.
 */
export function useUserNotifications(userId) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [ready, setReady] = useState(false);
  const fetchedOnceRef = useRef(false);

  const markSeen = useCallback((activeUserId) => {
    if (!activeUserId) return;
    localStorage.setItem(`${NOTIFICATION_STORAGE_KEY}-${activeUserId}`, new Date().toISOString());
  }, []);

  const fetchNotifications = useCallback(async (activeUserId) => {
    if (!activeUserId) return;

    const [generationsResult, postsResult, accountsResult, adminNotificationsResult] = await Promise.all([
      supabase
        .from("generations")
        .select("id, session_id, prompt, status, created_at, updated_at, metadata")
        .eq("user_id", activeUserId)
        .is("organization_id", null)
        .in("status", GENERATION_NOTIFICATION_STATUSES)
        .order("updated_at", { ascending: false })
        .limit(15),
      supabase
        .from("posts")
        .select("id, status, account_id, created_at, scheduled_at, published_at")
        .eq("user_id", activeUserId)
        .is("organization_id", null)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase.from("connected_accounts").select("id, platform, account_name").eq("user_id", activeUserId),
      supabase
        .from("user_notifications")
        .select("id, type, title, subject, body, metadata, is_read, read_at, created_at")
        .eq("user_id", activeUserId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    const accountById = new Map((accountsResult.data ?? []).map((account) => [account.id, account]));

    const generationNotifications = (generationsResult.data ?? []).map((generation) => {
      const status = generation.status ?? GENERATION_STATUS.PROCESSING;
      const timestamp = generation.updated_at ?? generation.created_at;
      return {
        id: `generation-${generation.id}`,
        timestamp,
        headline: GENERATION_NOTIFICATION_HEADLINES[status] ?? "Generation update",
        detail: getGenerationTitle(generation),
        route: buildGenerationRoute(generation),
      };
    });

    const postNotifications = (postsResult.data ?? [])
      .filter((post) => POST_NOTIFICATION_STATUSES.has((post.status ?? "").toLowerCase()))
      .slice(0, 15)
      .map((post) => {
        const status = (post.status ?? POST_STATUS.SCHEDULED).toLowerCase();
        const timestamp = post.published_at ?? post.scheduled_at ?? post.created_at;
        const account = normalizePostAccountData(accountById.get(post.account_id));
        return {
          id: `post-${post.id}`,
          timestamp,
          headline: POST_NOTIFICATION_HEADLINES[status] ?? "Post update",
          detail: `${account.platform} - ${account.accountName}`,
          route: "/app/calendar",
        };
      });

    const adminNotifications = (adminNotificationsResult.data ?? []).map((notification) => {
      const notificationType = notification.type || USER_NOTIFICATION_TYPE.ADMIN_MESSAGE;
      const complaintId = notification.metadata?.complaint_id;
      const isComplaintResolved = notificationType === USER_NOTIFICATION_TYPE.COMPLAINT_RESOLVED;
      return {
        id: `admin-${notification.id}`,
        dbId: notification.id,
        source: "user_notification",
        timestamp: notification.created_at,
        headline: isComplaintResolved
          ? `Resolved: ${notification.title || notification.subject || "Support ticket"}`
          : (notification.title || notification.subject || "Admin notification"),
        detail: String(notification.body || "").slice(0, 120),
        route: isComplaintResolved ? "/app/help?tab=tickets" : "/app/dashboard",
        unread: !notification.is_read,
        type: notificationType,
        complaintId,
      };
    });

    const merged = [...generationNotifications, ...postNotifications, ...adminNotifications]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 20);

    const seenAtRaw = localStorage.getItem(`${NOTIFICATION_STORAGE_KEY}-${activeUserId}`);
    const seenAt = seenAtRaw ? new Date(seenAtRaw).getTime() : 0;
    const localUnread = merged.filter((item) => {
      if (item.id.startsWith("admin-")) return false;
      return new Date(item.timestamp).getTime() > seenAt;
    }).length;
    const adminUnread = adminNotifications.filter((item) => item.unread).length;

    setNotifications(merged);
    setUnreadCount(localUnread + adminUnread);
    setReady(true);
  }, []);

  useEffect(() => {
    setNotifications([]);
    setUnreadCount(0);
    setReady(false);
    fetchedOnceRef.current = false;
  }, [userId]);

  useEffect(() => {
    if (!userId || fetchedOnceRef.current) return undefined;
    fetchedOnceRef.current = true;
    const timeoutId = window.setTimeout(() => fetchNotifications(userId), 800);
    return () => window.clearTimeout(timeoutId);
  }, [fetchNotifications, userId]);

  useEffect(() => {
    if (!userId) return undefined;
    const channel = supabase
      .channel(`notif-bell-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "generations", filter: `user_id=eq.${userId}` }, () => fetchNotifications(userId))
      .on("postgres_changes", { event: "*", schema: "public", table: "posts", filter: `user_id=eq.${userId}` }, () => fetchNotifications(userId))
      .on("postgres_changes", { event: "*", schema: "public", table: "user_notifications", filter: `user_id=eq.${userId}` }, () => fetchNotifications(userId))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [fetchNotifications, userId]);

  /** Call when the bell opens: marks activity items seen and re-marks any unread admin rows read. */
  const markAllRead = useCallback(async () => {
    if (!userId) return;
    markSeen(userId);
    const unreadAdminIds = notifications.filter((n) => n.source === "user_notification" && n.unread).map((n) => n.dbId);
    if (unreadAdminIds.length > 0) {
      await supabase
        .from("user_notifications")
        .update({ is_read: true, read_at: new Date().toISOString() })
        .in("id", unreadAdminIds);
    }
    fetchNotifications(userId);
  }, [userId, notifications, markSeen, fetchNotifications]);

  const handleOpen = useCallback(() => {
    if (!userId) return;
    if (!ready) fetchNotifications(userId);
  }, [userId, ready, fetchNotifications]);

  /** Click on a single notification: marks it read (admin messages only) and re-fetches. */
  const markOneRead = useCallback(async (notification) => {
    if (notification?.source === "user_notification" && notification?.dbId) {
      await supabase
        .from("user_notifications")
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq("id", notification.dbId);
    }
    if (userId) fetchNotifications(userId);
  }, [userId, fetchNotifications]);

  return { notifications, unreadCount, ready, markAllRead, markOneRead, handleOpen, refetch: () => fetchNotifications(userId) };
}
