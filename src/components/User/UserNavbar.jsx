// src/components/User/UserNavbar.jsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Coins, Plus, Search, X } from "lucide-react";
import { supabase } from "../../services/supabaseClient";
import { useAuth } from "../../Context/AuthContext";
import {
  GENERATION_NOTIFICATION_HEADLINES,
  GENERATION_STATUS,
  POST_NOTIFICATION_HEADLINES,
  POST_STATUS,
  USER_NOTIFICATION_TYPE,
} from "../../constants/statuses";
import useHelpStore from "../../stores/HelpStore";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import ProfileMenu from "./ProfileMenu";
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
  if (typeof metadataTitle === "string" && metadataTitle.trim()) {
    return metadataTitle.trim();
  }

  if (typeof generation?.title === "string" && generation.title.trim()) {
    return generation.title.trim();
  }

  return getTitleFromPrompt(generation?.prompt);
}

function formatNotificationTime(timestamp) {
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

function formatSearchDate(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Unknown date";

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildGenerationRoute(generation) {
  const sessionPath = generation?.session_id
    ? `/app/generate/${generation.session_id}`
    : "/app/generate";
  return generation?.id ? `${sessionPath}#${generation.id}` : sessionPath;
}

function normalizePostAccountData(connectedAccount) {
  if (!connectedAccount) return { platform: "Platform", accountName: "Unknown account" };

  if (Array.isArray(connectedAccount)) {
    const first = connectedAccount[0] ?? {};
    return {
      platform: first.platform ?? "Platform",
      accountName: first.account_name ?? "Unknown account",
    };
  }

  return {
    platform: connectedAccount.platform ?? "Platform",
    accountName: connectedAccount.account_name ?? "Unknown account",
  };
}

function BrandosseFlowLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 64 72" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="brandosse-navbar-gradient" x1="8" y1="8" x2="56" y2="64">
          <stop stopColor="#C4B5FD" />
          <stop offset="0.52" stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#4338CA" />
        </linearGradient>
      </defs>
      <path
        d="M22 14C36 14 46 20 46 32C46 43 38 48 25 48H22C14 48 8 42 8 34V28C8 20 14 14 22 14Z"
        stroke="url(#brandosse-navbar-gradient)"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="8"
      />
      <circle cx="22" cy="14" r="10" fill="url(#brandosse-navbar-gradient)" />
      <circle cx="46" cy="32" r="10" fill="url(#brandosse-navbar-gradient)" />
      <circle cx="22" cy="58" r="10" fill="url(#brandosse-navbar-gradient)" />
    </svg>
  );
}

export default function UserNavbar({
  searchQuery = "",
  onSearchQueryChange = () => {},
  searchResults = [],
  searchLoading = false,
  onSearchSelect = () => {},
}) {
  const { navigate } = useAppNavigation();
  const { user, profile } = useAuth();
  const markComplaintsViewed = useHelpStore((state) => state.markComplaintsViewed);
  const userId = user?.id ?? null;

  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationsReady, setNotificationsReady] = useState(false);
  const [videoCredits, setVideoCredits] = useState(null);

  const profileRef = useRef(null);
  const notificationsRef = useRef(null);
  const searchRef = useRef(null);
  const searchInputRef = useRef(null);

  const markTimelineSeen = useCallback((activeUserId) => {
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
      supabase
        .from("connected_accounts")
        .select("id, platform, account_name")
        .eq("user_id", activeUserId),
      supabase
        .from("user_notifications")
        .select("id, type, title, subject, body, metadata, is_read, read_at, created_at")
        .eq("user_id", activeUserId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    if (generationsResult.error) {
      console.error("[UserNavbar] generation notifications query failed:", generationsResult.error.message);
    }
    if (postsResult.error) {
      console.error("[UserNavbar] post notifications query failed:", postsResult.error.message);
    }
    if (accountsResult.error) {
      console.error("[UserNavbar] account lookup query failed:", accountsResult.error.message);
    }
    if (adminNotificationsResult.error && !/user_notifications|permission denied|does not exist/i.test(adminNotificationsResult.error.message || "")) {
      console.error("[UserNavbar] admin notifications query failed:", adminNotificationsResult.error.message);
    }

    const accountById = new Map((accountsResult.data ?? []).map((account) => [account.id, account]));

    const generationNotifications = (generationsResult.data ?? []).map((generation) => {
      const status = generation.status ?? GENERATION_STATUS.PROCESSING;
      const timestamp = generation.updated_at ?? generation.created_at;
      const headline = GENERATION_NOTIFICATION_HEADLINES[status] ?? "Generation update";

      return {
        id: `generation-${generation.id}`,
        timestamp,
        headline,
        detail: getGenerationTitle(generation),
        route: buildGenerationRoute(generation),
      };
    });

    const postNotifications = (postsResult.data ?? [])
      .filter((post) => {
        const normalized = (post.status ?? "").toLowerCase();
        return POST_NOTIFICATION_STATUSES.has(normalized);
      })
      .slice(0, 15)
      .map((post) => {
        const status = (post.status ?? POST_STATUS.SCHEDULED).toLowerCase();
        const timestamp = post.published_at ?? post.scheduled_at ?? post.created_at;
        const accountId = post.account_id;
        const account = normalizePostAccountData(accountById.get(accountId));
        const headline = POST_NOTIFICATION_HEADLINES[status] ?? "Post update";

        return {
          id: `post-${post.id}`,
          timestamp,
          headline,
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
      const itemTime = new Date(item.timestamp).getTime();
      return itemTime > seenAt;
    }).length;
    const adminUnread = adminNotifications.filter((item) => item.unread).length;

    setNotifications(merged);
    setUnreadCount(localUnread + adminUnread);
    setNotificationsReady(true);
  }, []);

  useEffect(() => {
    setNotifications([]);
    setUnreadCount(0);
    setNotificationsReady(false);
    setNotificationsOpen(false);
    setVideoCredits(null);
  }, [userId]);

  useEffect(() => {
    if (!userId) return undefined;

    let active = true;
    supabase
      .from("user_credits")
      .select("balance")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active || error) return;
        setVideoCredits(data?.balance ?? 0);
      });

    const channel = supabase
      .channel(`navbar-video-credits-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "user_credits",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          setVideoCredits(payload.new?.balance ?? 0);
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  useEffect(() => {
    if (!userId || notificationsReady) return undefined;

    const preloadKey = `${NOTIFICATION_STORAGE_KEY}-prefetched-${userId}`;
    if (sessionStorage.getItem(preloadKey)) return undefined;

    const timeoutId = window.setTimeout(() => {
      sessionStorage.setItem(preloadKey, "1");
      fetchNotifications(userId);
    }, 1200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [fetchNotifications, notificationsReady, userId]);

  useEffect(() => {
    if (!notificationsOpen || !userId) return undefined;

    if (!notificationsReady) {
      fetchNotifications(userId);
    }

    markTimelineSeen(userId);
    fetchNotifications(userId);

    return undefined;
  }, [fetchNotifications, markTimelineSeen, notificationsOpen, notificationsReady, userId]);

  useEffect(() => {
    if (!userId) return undefined;

    const channel = supabase
      .channel(`navbar-notifications-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "generations",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          fetchNotifications(userId);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "posts",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          fetchNotifications(userId);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          fetchNotifications(userId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchNotifications, userId]);

  // Close popovers when clicking outside their containers.
  useEffect(() => {
    function handleClickOutside(event) {
      const target = event.target;

      if (profileOpen && profileRef.current && !profileRef.current.contains(target)) {
        setProfileOpen(false);
      }

      if (
        notificationsOpen &&
        notificationsRef.current &&
        !notificationsRef.current.contains(target)
      ) {
        setNotificationsOpen(false);
      }

      if (searchOpen && searchRef.current && !searchRef.current.contains(target)) {
        setSearchOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [profileOpen, notificationsOpen, searchOpen]);

  // Support Ctrl/Cmd + K to focus the search input.
  useEffect(() => {
    function handleShortcut(event) {
      const isCommandOrCtrl = event.metaKey || event.ctrlKey;
      if (!isCommandOrCtrl) return;
      if (event.key.toLowerCase() !== "k") return;

      event.preventDefault();
      searchInputRef.current?.focus();
      setSearchOpen(true);
    }

    document.addEventListener("keydown", handleShortcut);
    return () => {
      document.removeEventListener("keydown", handleShortcut);
    };
  }, []);

  const handleNotificationClick = useCallback(async (notification) => {
    setNotificationsOpen(false);

    if (notification?.source === "user_notification" && notification?.dbId) {
      const { error } = await supabase
        .from("user_notifications")
        .update({
          is_read: true,
          read_at: new Date().toISOString(),
        })
        .eq("id", notification.dbId);

      if (error && !/user_notifications|permission denied|does not exist/i.test(error.message || "")) {
        console.error("[UserNavbar] failed to mark user notification read:", error.message);
      }

      if (notification.type === USER_NOTIFICATION_TYPE.COMPLAINT_RESOLVED && notification.complaintId) {
        markComplaintsViewed([notification.complaintId]).catch(() => {});
      }
    }

    if (notification?.route) {
      navigate(notification.route);
    }

    if (userId) {
      fetchNotifications(userId);
    }
  }, [fetchNotifications, markComplaintsViewed, navigate, userId]);

  const initials = profile?.full_name
    ? profile.full_name
        .trim()
        .split(/\s+/)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "?";

  const hasSearchValue = searchQuery.trim().length > 0;
  const showSearchMenu = searchOpen && hasSearchValue;
  const searchWrapClassName = `navbar-search-wrap ${searchOpen ? "is-open" : ""}`;

  return (
    <header className="app-navbar">
      <a href="#main-content" className="navbar-skip-link">
        Skip to main content
      </a>
      <div className="navbar-brand">
        <a
          href="/app/dashboard"
          className="navbar-logo"
          onClick={(event) => {
            event.preventDefault();
            navigate("/app/dashboard");
          }}
        >
          <span className="navbar-logo-mark">
            <BrandosseFlowLogo />
          </span>
          <span className="navbar-logo-copy">
            <span className="navbar-logo-text">Brandosse</span>
            <span className="navbar-logo-subtext">Command Center</span>
          </span>
        </a>
      </div>

      <div className={searchWrapClassName} ref={searchRef}>
        <Search size={14} className="navbar-search-icon" aria-hidden="true" />

        <input
          ref={searchInputRef}
          type="search"
          className="navbar-search-input"
          placeholder="Search posts, prompts, and generations"
          aria-label="Search posts, prompts, and generations"
          value={searchQuery}
          onChange={(event) => {
            onSearchQueryChange(event.target.value);
            setSearchOpen(true);
          }}
          onFocus={() => setSearchOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setSearchOpen(false);
              return;
            }

            if (event.key === "Enter" && searchResults.length > 0) {
              event.preventDefault();
              onSearchSelect(searchResults[0]);
              onSearchQueryChange("");
              setSearchOpen(false);
            }
          }}
        />

        {hasSearchValue ? (
          <button
            type="button"
            className="navbar-search-clear"
            onClick={() => {
              onSearchQueryChange("");
              setSearchOpen(false);
              searchInputRef.current?.focus();
            }}
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        ) : (
          <>
            <kbd className="navbar-search-kbd">Ctrl+K</kbd>
            <button
              type="button"
              className="navbar-search-mobile-close"
              onClick={() => setSearchOpen(false)}
              aria-label="Close search"
            >
              <X size={14} />
            </button>
          </>
        )}

        {showSearchMenu && (
          <div className="navbar-search-menu" role="listbox" aria-label="Search results">
            {searchLoading ? (
              <div className="navbar-search-empty">Loading results...</div>
            ) : searchResults.length === 0 ? (
              <div className="navbar-search-empty">No matching generations found.</div>
            ) : (
              searchResults.map((result) => (
                <button
                  key={result.id}
                  type="button"
                  role="option"
                  aria-selected="false"
                  className="navbar-search-result"
                  onClick={() => {
                    onSearchSelect(result);
                    onSearchQueryChange("");
                    setSearchOpen(false);
                  }}
                >
                  <span className="navbar-search-result-title">{result.title}</span>
                  <span className="navbar-search-result-meta">
                    {formatSearchDate(result.created_at)}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="navbar-actions">
        <button
          className="navbar-mobile-search-btn"
          onClick={() => {
            setSearchOpen(true);
            window.setTimeout(() => searchInputRef.current?.focus(), 0);
          }}
          aria-label="Open search"
          type="button"
        >
          <Search size={17} aria-hidden="true" />
        </button>

        <button
          className="navbar-credit-pill"
          onClick={() => navigate("/app/billing/credits")}
          type="button"
          aria-label={`Video credits balance${videoCredits == null ? "" : `: ${videoCredits}`}`}
        >
          <Coins size={15} aria-hidden="true" />
          <span>{videoCredits == null ? "Credits" : `${videoCredits} credits`}</span>
        </button>

        <button
          className="navbar-create-btn"
          onClick={() => navigate("/app/generate")}
          aria-label="Create new content"
          type="button"
        >
          <Plus size={15} aria-hidden="true" />
          <span>Generate</span>
        </button>

        <div className="navbar-notification-wrap" ref={notificationsRef}>
          <button
            className={`navbar-icon-btn ${unreadCount > 0 ? "unread" : ""}`}
            aria-label="View notifications"
            type="button"
            onClick={() => {
              setNotificationsOpen((current) => !current);
            }}
          >
            <Bell size={17} aria-hidden="true" />
            {unreadCount > 0 && (
              <span className="navbar-notif-dot" aria-hidden="true">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          {notificationsOpen && (
            <div className="navbar-notif-menu" role="menu" aria-label="Notifications">
              <div className="navbar-notif-header">Recent updates</div>

              {notifications.length === 0 ? (
                <div className="navbar-notif-empty">No notifications yet.</div>
              ) : (
                notifications.map((notification) => (
                  <button
                    key={notification.id}
                    type="button"
                    role="menuitem"
                    className="navbar-notif-item"
                    onClick={() => {
                      handleNotificationClick(notification);
                    }}
                  >
                    <span className="navbar-notif-title">{notification.headline}</span>
                    <span className="navbar-notif-detail">{notification.detail}</span>
                    <span className="navbar-notif-time">
                      {formatNotificationTime(notification.timestamp)}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <div className="navbar-profile-wrap" ref={profileRef}>
          <button
            className={`navbar-avatar-btn ${profileOpen ? "open" : ""}`}
            onClick={() => setProfileOpen((value) => !value)}
            aria-label="Open profile menu"
            aria-expanded={profileOpen}
            aria-haspopup="menu"
            type="button"
          >
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="Your avatar" className="navbar-avatar-img" />
            ) : (
              <span className="navbar-avatar-initials" aria-hidden="true">
                {initials}
              </span>
            )}
            <span className="navbar-avatar-status" aria-hidden="true" />
          </button>

          {profileOpen && (
            <ProfileMenu
              profile={profile}
              initials={initials}
              videoCredits={videoCredits}
              onClose={() => setProfileOpen(false)}
            />
          )}
        </div>
      </div>
    </header>
  );
}
