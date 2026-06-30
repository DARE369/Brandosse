import React, { useEffect, useRef, useState } from 'react';
import { Bell, Search, ChevronDown, LogOut, Repeat2, Loader2, Menu, X } from 'lucide-react';
import { useAuth } from '../../Context/AuthContext';
import { useAppNavigation } from '../../Context/AppNavigationContext';
import WorkspaceSwitcherMenu from '../../components/Shared/WorkspaceSwitcherMenu';
import useOrgCredits from '../hooks/useOrgCredits';
import useOrgContext from '../hooks/useOrgContext';
import useOrgNotifications from '../hooks/useOrgNotifications';
import OrgNotificationCenter from './OrgNotificationCenter';
import BrandProjectSelector from './BrandProjectSelector';
import CreditPill from './CreditPill';
import { resolveOrgNotificationTarget } from '../services/orgNotificationService';
import { searchOrganizationWorkspace } from '../services/orgSearchService';
import { buildDeepLink } from '../../utils/buildDeepLink';

const SEARCH_GROUPS = [
  { key: 'pipeline_items', label: 'Pipeline' },
  { key: 'org_tasks', label: 'Tasks' },
  { key: 'drafts', label: 'Drafts' },
  { key: 'calendar_posts', label: 'Calendar' },
  { key: 'assets', label: 'Assets' },
];

function createEmptySearchGroups() {
  return {
    pipeline_items: [],
    org_tasks: [],
    drafts: [],
    calendar_posts: [],
    assets: [],
  };
}

function safeGroupArray(value) {
  return Array.isArray(value) ? value : [];
}

function getInitials(name = '') {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'U';
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function formatSearchDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function flattenSearchGroups(groups) {
  const flattened = [];
  SEARCH_GROUPS.forEach((group) => {
    safeGroupArray(groups?.[group.key]).forEach((item) => {
      flattened.push({ groupKey: group.key, item });
    });
  });
  return flattened;
}

function getSearchResultTitle(groupKey, item) {
  if (groupKey === 'assets') return item?.name || item?.label || 'Asset';
  if (groupKey === 'org_tasks') return item?.title || item?.label || 'Task';
  if (groupKey === 'pipeline_items') return item?.title || item?.label || 'Pipeline item';
  if (groupKey === 'drafts') return item?.title || item?.caption || item?.label || 'Draft';
  if (groupKey === 'calendar_posts') return item?.title || item?.caption || item?.label || 'Calendar post';
  return item?.label || 'Result';
}

function getSearchResultMeta(groupKey, item) {
  const updatedLabel = formatSearchDate(item?.updated_at);

  if (groupKey === 'pipeline_items') {
    const status = String(item?.status || 'pending').replace(/_/g, ' ');
    return `${status}${updatedLabel ? ` / ${updatedLabel}` : ''}`;
  }

  if (groupKey === 'org_tasks') {
    const priority = String(item?.priority || '').trim();
    const status = String(item?.status_id || '').trim();
    const left = [priority, status].filter(Boolean).join(' / ');
    return left || updatedLabel || 'Task';
  }

  if (groupKey === 'drafts' || groupKey === 'calendar_posts') {
    const status = String(item?.status || '').trim().replace(/_/g, ' ');
    return status ? `${status}${updatedLabel ? ` / ${updatedLabel}` : ''}` : (updatedLabel || 'Post');
  }

  if (groupKey === 'assets') {
    const approval = String(item?.approval_status || '').trim().replace(/_/g, ' ');
    return approval ? `${approval}${updatedLabel ? ` / ${updatedLabel}` : ''}` : (updatedLabel || 'Asset');
  }

  return updatedLabel || '';
}

function buildSearchNavigationTarget({
  groupKey,
  item,
  organizationId,
  searchQuery,
}) {
  const itemId = String(item?.id || '').trim();
  if (!organizationId || !itemId) return null;

  if (groupKey === 'pipeline_items') {
    return buildDeepLink({
      path: `/app/org/${organizationId}/pipeline?pipelineItemId=${encodeURIComponent(itemId)}`,
      source: 'org_global_search',
      target: 'org_pipeline_item',
      params: { pipelineItemId: itemId },
    });
  }

  if (groupKey === 'org_tasks') {
    return buildDeepLink({
      path: `/app/org/${organizationId}/pipeline/tasks?taskId=${encodeURIComponent(itemId)}`,
      source: 'org_global_search',
      target: 'org_task',
      params: { taskId: itemId },
    });
  }

  if (groupKey === 'drafts') {
    return buildDeepLink({
      path: `/app/org/${organizationId}/office?draftId=${encodeURIComponent(itemId)}`,
      source: 'org_global_search',
      target: 'org_draft',
      params: { draftId: itemId },
    });
  }

  if (groupKey === 'calendar_posts') {
    return buildDeepLink({
      path: `/app/org/${organizationId}/calendar?postId=${encodeURIComponent(itemId)}`,
      source: 'org_global_search',
      target: 'org_calendar_post',
      params: { postId: itemId },
    });
  }

  if (groupKey === 'assets') {
    const query = String(searchQuery || '').trim();
    const searchParam = query ? `&search=${encodeURIComponent(query)}` : '';
    return buildDeepLink({
      path: `/app/org/${organizationId}/library?assetId=${encodeURIComponent(itemId)}${searchParam}`,
      source: 'org_global_search',
      target: 'org_asset',
      params: { assetId: itemId, search: query || undefined },
    });
  }

  return null;
}

export default function OrgTopNavbar({
  mobileNavOpen = false,
  onMobileNavToggle,
}) {
  const { navigate } = useAppNavigation();
  const {
    profile,
    signOut,
    availableWorkspaces = [],
    activeWorkspace,
    switchWorkspace,
  } = useAuth();
  const {
    organization,
    organizationId,
    brandProjects,
    activeBrandProject,
    isAgency,
    setActiveBrandProjectId,
  } = useOrgContext();
  const { organizationCreditsUsed, organizationCreditPool } = useOrgCredits();
  const [contextOpen, setContextOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchGroups, setSearchGroups] = useState(() => createEmptySearchGroups());
  const rootRef = useRef(null);
  const searchInputRef = useRef(null);
  const searchRequestIdRef = useRef(0);
  const {
    notifications,
    unreadCount,
    loading: notificationsLoading,
    error: notificationsError,
    markOneRead,
    markAllRead,
    snoozeOneDay,
    dismissOne,
    acknowledgeCommonRoom,
  } = useOrgNotifications();

  useEffect(() => {
    function handleClick(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setContextOpen(false);
        setProfileOpen(false);
        setNotificationsOpen(false);
        setSearchOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    function handleSearchShortcut(event) {
      const isCommandOrCtrl = event.metaKey || event.ctrlKey;
      if (!isCommandOrCtrl) return;
      if (event.key.toLowerCase() !== 'k') return;

      event.preventDefault();
      searchInputRef.current?.focus();
      setSearchOpen(true);
      setContextOpen(false);
      setProfileOpen(false);
      setNotificationsOpen(false);
    }

    document.addEventListener('keydown', handleSearchShortcut);
    return () => document.removeEventListener('keydown', handleSearchShortcut);
  }, []);

  useEffect(() => {
    const normalizedQuery = String(searchQuery || '').trim();
    const brandProjectId = activeBrandProject?.id || null;
    const requestId = ++searchRequestIdRef.current;

    if (!organizationId || normalizedQuery.length < 2) {
      setSearchLoading(false);
      setSearchError('');
      setSearchGroups(createEmptySearchGroups());
      return undefined;
    }

    setSearchLoading(true);
    setSearchError('');

    const timeoutId = window.setTimeout(async () => {
      try {
        const result = await searchOrganizationWorkspace({
          organizationId,
          brandProjectId,
          query: normalizedQuery,
        });

        if (searchRequestIdRef.current !== requestId) return;
        setSearchGroups(result?.groups || createEmptySearchGroups());
      } catch (error) {
        if (searchRequestIdRef.current !== requestId) return;
        setSearchGroups(createEmptySearchGroups());
        setSearchError(error?.message || 'Could not run workspace search.');
      } finally {
        if (searchRequestIdRef.current === requestId) {
          setSearchLoading(false);
        }
      }
    }, 260);

    return () => window.clearTimeout(timeoutId);
  }, [activeBrandProject?.id, organizationId, searchQuery]);

  const initials = getInitials(profile?.full_name || profile?.email || 'User');
  const normalizedSearchQuery = String(searchQuery || '').trim();
  const flattenedSearchResults = flattenSearchGroups(searchGroups);
  const firstSearchResult = flattenedSearchResults[0] || null;
  const hasSearchValue = normalizedSearchQuery.length > 0;
  const showSearchMenu = searchOpen && (hasSearchValue || searchLoading || Boolean(searchError));

  const handleOpenNotification = async (notification) => {
    const target = resolveOrgNotificationTarget(notification, organizationId);

    if (notification?.source === 'user_notification' && notification?.id && Number(notification?.unread_count || 0) > 0) {
      await markOneRead(notification.id);
    }

    if (notification?.source === 'common_room' && notification?.id) {
      acknowledgeCommonRoom(notification.id);
    }

    setNotificationsOpen(false);

    if (target?.external && target.href) {
      window.location.assign(target.href);
      return;
    }

    if (target?.path) {
      navigate(target.path, target.state ? { state: target.state } : undefined);
    }
  };

  const handleSearchResultSelect = (groupKey, item) => {
    const target = buildSearchNavigationTarget({
      groupKey,
      item,
      organizationId,
      searchQuery: normalizedSearchQuery,
    });

    if (!target?.path) return;

    setSearchOpen(false);
    setSearchQuery('');
    setContextOpen(false);
    setProfileOpen(false);
    setNotificationsOpen(false);
    navigate(target.path, target.state ? { state: target.state } : undefined);
  };

  return (
    <header className="org-top-navbar" ref={rootRef}>
      <div className="org-top-left">
        <button
          type="button"
          className="org-mobile-menu-button"
          aria-label={mobileNavOpen ? 'Close organization navigation' : 'Open organization navigation'}
          aria-expanded={mobileNavOpen}
          onClick={() => {
            onMobileNavToggle?.();
            setContextOpen(false);
            setProfileOpen(false);
            setNotificationsOpen(false);
            setSearchOpen(false);
          }}
        >
          {mobileNavOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
        </button>

        <div className="org-context-switcher">
          <button
            type="button"
            className="org-context-trigger"
            aria-label="Open workspace switcher"
            aria-expanded={contextOpen}
            onClick={() => {
              setContextOpen((value) => !value);
              setProfileOpen(false);
              setNotificationsOpen(false);
              setSearchOpen(false);
            }}
          >
            <span className="org-context-avatar">
              {organization?.logoUrl ? <img src={organization.logoUrl} alt={organization.name} /> : initials}
            </span>
            <span className="org-context-copy">
              <strong>{organization?.name || 'Organization'}</strong>
              <small>Workspace</small>
            </span>
            <ChevronDown size={15} />
          </button>

          {contextOpen ? (
            <div className="org-context-menu">
              <WorkspaceSwitcherMenu
                workspaces={availableWorkspaces}
                activeWorkspace={activeWorkspace}
                heading={null}
                onSelect={async (workspace) => {
                  const nextPath = await switchWorkspace(workspace);
                  setContextOpen(false);
                  if (nextPath) navigate(nextPath);
                }}
              />
            </div>
          ) : null}
        </div>

        <div className="org-global-search-shell">
          <div className="org-global-search">
            <Search size={14} />
            <input
              ref={searchInputRef}
              type="search"
              placeholder="Search tasks, pipeline, drafts, and assets..."
              aria-label="Global workspace search"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => {
                setSearchOpen(true);
                setContextOpen(false);
                setProfileOpen(false);
                setNotificationsOpen(false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setSearchOpen(false);
                  return;
                }

                if (event.key === 'Enter' && firstSearchResult && normalizedSearchQuery.length >= 2 && !searchLoading) {
                  event.preventDefault();
                  handleSearchResultSelect(firstSearchResult.groupKey, firstSearchResult.item);
                }
              }}
            />

            {hasSearchValue ? (
              <button
                type="button"
                className="org-global-search-clear"
                onClick={() => {
                  setSearchQuery('');
                  setSearchError('');
                  setSearchGroups(createEmptySearchGroups());
                  searchInputRef.current?.focus();
                }}
                aria-label="Clear search"
              >
                <X size={13} />
              </button>
            ) : (
              <kbd className="org-global-search-shortcut">Ctrl+K</kbd>
            )}
          </div>

          {showSearchMenu ? (
            <div className="org-global-search-menu" role="listbox" aria-label="Workspace search results">
              {normalizedSearchQuery.length < 2 ? (
                <div className="org-global-search-empty">
                  Type at least 2 characters to search the workspace.
                </div>
              ) : searchLoading ? (
                <div className="org-global-search-empty">
                  <Loader2 size={14} className="org-spin" />
                  Searching workspace...
                </div>
              ) : searchError ? (
                <div className="org-global-search-empty error">
                  {searchError}
                </div>
              ) : flattenedSearchResults.length === 0 ? (
                <div className="org-global-search-empty">
                  No matching items found.
                </div>
              ) : (
                SEARCH_GROUPS.map((group) => {
                  const results = safeGroupArray(searchGroups[group.key]);
                  if (results.length === 0) return null;

                  return (
                    <section key={group.key} className="org-global-search-group">
                      <div className="org-global-search-group-head">
                        <strong>{group.label}</strong>
                        <span>{results.length}</span>
                      </div>
                      <div className="org-global-search-group-list">
                        {results.map((item) => (
                          <button
                            key={`${group.key}:${item.id}`}
                            type="button"
                            className="org-global-search-result"
                            onClick={() => handleSearchResultSelect(group.key, item)}
                          >
                            <span className="org-global-search-result-title">
                              {getSearchResultTitle(group.key, item)}
                            </span>
                            <span className="org-global-search-result-meta">
                              {getSearchResultMeta(group.key, item)}
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>
                  );
                })
              )}
            </div>
          ) : null}
        </div>
      </div>

      <div className="org-top-right">
        {isAgency ? (
          <BrandProjectSelector
            projects={brandProjects}
            activeProject={activeBrandProject}
            onSelect={setActiveBrandProjectId}
          />
        ) : null}

        <CreditPill
          used={organizationCreditsUsed}
          total={organizationCreditPool}
          onClick={() => navigate(`/app/org/${organizationId}/admin/credits`)}
        />

        <div className="org-notification-wrap">
          <button
            type="button"
            className="org-icon-button"
            onClick={() => {
              setNotificationsOpen((value) => !value);
              setContextOpen(false);
              setProfileOpen(false);
              setSearchOpen(false);
            }}
            title="Notifications"
            aria-label="Open notifications"
          >
            <Bell size={16} />
            {unreadCount > 0 ? <span className="org-icon-badge">{unreadCount > 99 ? '99+' : unreadCount}</span> : null}
          </button>

          <OrgNotificationCenter
            open={notificationsOpen}
            notifications={notifications}
            unreadCount={unreadCount}
            loading={notificationsLoading}
            error={notificationsError}
            onClose={() => setNotificationsOpen(false)}
            onMarkAllRead={markAllRead}
            onOpenNotification={handleOpenNotification}
            onMarkOneRead={markOneRead}
            onDismissOne={dismissOne}
            onSnoozeOne={snoozeOneDay}
            onOpenCommonRoom={() => {
              setNotificationsOpen(false);
              navigate(`/app/org/${organizationId}/common-room`);
            }}
          />
        </div>

        <div className="org-profile-menu">
          <button
            type="button"
            className="org-profile-trigger"
            aria-label="Open profile menu"
            aria-expanded={profileOpen}
            onClick={() => {
              setProfileOpen((value) => !value);
              setContextOpen(false);
              setNotificationsOpen(false);
              setSearchOpen(false);
            }}
          >
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt={profile.full_name || 'User'} />
            ) : (
              <span>{initials}</span>
            )}
          </button>

          {profileOpen ? (
            <div className="org-profile-dropdown">
              <button type="button" onClick={() => navigate(`/app/org/${organizationId}/workspace`)}>
                <Repeat2 size={14} />
                View My Workspace
              </button>
              {availableWorkspaces
                .filter((workspace) => workspace.id !== activeWorkspace?.id)
                .slice(0, 2)
                .map((workspace) => (
                  <button
                    key={workspace.id}
                    type="button"
                    onClick={async () => {
                      const nextPath = await switchWorkspace(workspace);
                      setProfileOpen(false);
                      if (nextPath) navigate(nextPath);
                    }}
                  >
                    <Repeat2 size={14} />
                    {workspace.label}
                  </button>
                ))}
              <button type="button" onClick={() => signOut()}>
                <LogOut size={14} />
                Sign Out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
