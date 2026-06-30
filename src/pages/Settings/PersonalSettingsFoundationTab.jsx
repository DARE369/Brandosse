import { useEffect, useMemo, useState } from 'react';
import { BellRing, Loader2, Save, SlidersHorizontal, UserRound } from 'lucide-react';
import { useAuth } from '../../Context/AuthContext';
import { useTheme } from '../../Context/ThemeContext';
import {
  ALLOWED_WORKSPACE_ROUTES,
  DEFAULT_USER_SETTINGS,
  fetchUserSettings,
  saveUserSettings,
  updateUserProfileSettings,
} from '../../services/userSettingsService';

const SECTION_META = {
  profile: {
    icon: UserRound,
    title: 'Profile & Identity',
    description: 'Control how your identity appears across personal and org workspaces.',
  },
  preferences: {
    icon: SlidersHorizontal,
    title: 'Workspace Preferences',
    description: 'Choose your timezone, theme, and default landing page after sign in.',
  },
  notifications: {
    icon: BellRing,
    title: 'Notification Preferences',
    description: 'Set which product updates should alert you in-app.',
  },
};

const WORKSPACE_ROUTE_OPTIONS = [
  { value: '/app/dashboard', label: 'Dashboard' },
  { value: '/app/generate', label: 'Generate' },
  { value: '/app/calendar', label: 'Calendar' },
  { value: '/app/library', label: 'Library' },
  { value: '/app/help', label: 'Help' },
  { value: '/app/settings', label: 'Settings' },
];

const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const LOCALE_OPTIONS = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'fr-FR', label: 'French' },
  { value: 'de-DE', label: 'German' },
  { value: 'es-ES', label: 'Spanish' },
];

function getDefaultTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch (_error) {
    return 'UTC';
  }
}

function normalizeRouteValue(value) {
  return ALLOWED_WORKSPACE_ROUTES.includes(value)
    ? value
    : DEFAULT_USER_SETTINGS.defaultWorkspaceRoute;
}

function normalizeErrorMessage(error) {
  const message = error?.message || String(error || 'Unknown error');
  if (/relation .*user_settings.* does not exist|column .*user_settings/i.test(message)) {
    return 'Settings storage is not ready in this environment. Apply Stage 11 migration first.';
  }
  return message;
}

export default function PersonalSettingsFoundationTab({
  section = 'profile',
  onToast = () => {},
}) {
  const { user, profile, refreshAccess } = useAuth();
  const { themePreference, setThemePreference } = useTheme();

  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [savingNotifications, setSavingNotifications] = useState(false);

  const [settings, setSettings] = useState(DEFAULT_USER_SETTINGS);
  const [profileForm, setProfileForm] = useState({
    fullName: '',
    avatarUrl: '',
  });
  const [preferenceForm, setPreferenceForm] = useState({
    timezone: getDefaultTimezone(),
    locale: DEFAULT_USER_SETTINGS.locale,
    themePreference: DEFAULT_USER_SETTINGS.themePreference,
    defaultWorkspaceRoute: DEFAULT_USER_SETTINGS.defaultWorkspaceRoute,
  });
  const [notificationForm, setNotificationForm] = useState({
    content_updates: true,
    approvals: true,
    tasks: true,
    system_alerts: true,
    weekly_digest: false,
  });

  useEffect(() => {
    let mounted = true;
    if (!user?.id) {
      setLoading(false);
      return undefined;
    }

    async function loadSettings() {
      setLoading(true);
      try {
        const loaded = await fetchUserSettings(user.id);
        if (!mounted) return;

        setSettings(loaded);
        setPreferenceForm({
          timezone: loaded.timezone || getDefaultTimezone(),
          locale: loaded.locale || DEFAULT_USER_SETTINGS.locale,
          themePreference: loaded.themePreference || themePreference || DEFAULT_USER_SETTINGS.themePreference,
          defaultWorkspaceRoute: normalizeRouteValue(loaded.defaultWorkspaceRoute),
        });
        setNotificationForm({
          content_updates: Boolean(loaded.notificationPreferences.content_updates),
          approvals: Boolean(loaded.notificationPreferences.approvals),
          tasks: Boolean(loaded.notificationPreferences.tasks),
          system_alerts: Boolean(loaded.notificationPreferences.system_alerts),
          weekly_digest: Boolean(loaded.notificationPreferences.weekly_digest),
        });
      } catch (error) {
        if (!mounted) return;
        onToast(normalizeErrorMessage(error), 'error');
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void loadSettings();

    return () => {
      mounted = false;
    };
  }, [onToast, themePreference, user?.id]);

  useEffect(() => {
    setProfileForm({
      fullName: String(profile?.full_name || ''),
      avatarUrl: String(profile?.avatar_url || ''),
    });
  }, [profile?.avatar_url, profile?.full_name]);

  const sectionMeta = SECTION_META[section] || SECTION_META.profile;
  const SectionIcon = sectionMeta.icon;

  const profileDirty = useMemo(() => {
    return (
      String(profileForm.fullName || '').trim() !== String(profile?.full_name || '').trim()
      || String(profileForm.avatarUrl || '').trim() !== String(profile?.avatar_url || '').trim()
    );
  }, [profile?.avatar_url, profile?.full_name, profileForm.avatarUrl, profileForm.fullName]);

  const preferencesDirty = useMemo(() => {
    return (
      String(preferenceForm.timezone || '') !== String(settings.timezone || '')
      || String(preferenceForm.locale || '') !== String(settings.locale || '')
      || String(preferenceForm.themePreference || '') !== String(settings.themePreference || '')
      || String(preferenceForm.defaultWorkspaceRoute || '') !== String(settings.defaultWorkspaceRoute || '')
    );
  }, [preferenceForm.defaultWorkspaceRoute, preferenceForm.locale, preferenceForm.themePreference, preferenceForm.timezone, settings.defaultWorkspaceRoute, settings.locale, settings.themePreference, settings.timezone]);

  const notificationsDirty = useMemo(() => {
    return (
      notificationForm.content_updates !== Boolean(settings.notificationPreferences.content_updates)
      || notificationForm.approvals !== Boolean(settings.notificationPreferences.approvals)
      || notificationForm.tasks !== Boolean(settings.notificationPreferences.tasks)
      || notificationForm.system_alerts !== Boolean(settings.notificationPreferences.system_alerts)
      || notificationForm.weekly_digest !== Boolean(settings.notificationPreferences.weekly_digest)
    );
  }, [notificationForm.approvals, notificationForm.content_updates, notificationForm.system_alerts, notificationForm.tasks, notificationForm.weekly_digest, settings.notificationPreferences.approvals, settings.notificationPreferences.content_updates, settings.notificationPreferences.system_alerts, settings.notificationPreferences.tasks, settings.notificationPreferences.weekly_digest]);

  const handleSaveProfile = async () => {
    if (!user?.id) return;
    setSavingProfile(true);
    try {
      const fullName = String(profileForm.fullName || '').trim();
      if (!fullName) {
        onToast('Full name is required.', 'error');
        return;
      }

      await updateUserProfileSettings(user.id, {
        fullName,
        avatarUrl: profileForm.avatarUrl,
      });
      await refreshAccess(user);
      onToast('Profile settings saved.', 'success');
    } catch (error) {
      onToast(normalizeErrorMessage(error), 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSavePreferences = async () => {
    if (!user?.id) return;
    setSavingPreferences(true);
    try {
      const saved = await saveUserSettings(user.id, {
        timezone: preferenceForm.timezone,
        locale: preferenceForm.locale,
        themePreference: preferenceForm.themePreference,
        defaultWorkspaceRoute: normalizeRouteValue(preferenceForm.defaultWorkspaceRoute),
      });

      setSettings(saved);
      setPreferenceForm({
        timezone: saved.timezone,
        locale: saved.locale,
        themePreference: saved.themePreference,
        defaultWorkspaceRoute: saved.defaultWorkspaceRoute,
      });
      setThemePreference(saved.themePreference);
      onToast('Workspace preferences saved.', 'success');
    } catch (error) {
      onToast(normalizeErrorMessage(error), 'error');
    } finally {
      setSavingPreferences(false);
    }
  };

  const handleSaveNotifications = async () => {
    if (!user?.id) return;
    setSavingNotifications(true);
    try {
      const saved = await saveUserSettings(user.id, {
        notificationPreferences: { ...notificationForm },
      });
      setSettings(saved);
      setNotificationForm({
        content_updates: Boolean(saved.notificationPreferences.content_updates),
        approvals: Boolean(saved.notificationPreferences.approvals),
        tasks: Boolean(saved.notificationPreferences.tasks),
        system_alerts: Boolean(saved.notificationPreferences.system_alerts),
        weekly_digest: Boolean(saved.notificationPreferences.weekly_digest),
      });
      onToast('Notification preferences saved.', 'success');
    } catch (error) {
      onToast(normalizeErrorMessage(error), 'error');
    } finally {
      setSavingNotifications(false);
    }
  };

  if (!user) {
    return (
      <section className="settings-foundation-tab">
        <div className="connected-accounts-empty">Sign in to manage personal settings.</div>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="settings-foundation-tab">
        <div className="settings-foundation-loading">
          <Loader2 size={16} className="org-spin" />
          Loading settings...
        </div>
      </section>
    );
  }

  return (
    <section className="settings-foundation-tab">
      <header className="settings-foundation-header">
        <div className="settings-foundation-header-icon">
          <SectionIcon size={16} />
        </div>
        <div>
          <h1>{sectionMeta.title}</h1>
          <p>{sectionMeta.description}</p>
        </div>
      </header>

      {section === 'profile' ? (
        <article className="settings-foundation-card">
          <div className="settings-foundation-grid">
            <label className="settings-foundation-field">
              <span>Full Name</span>
              <input
                type="text"
                value={profileForm.fullName}
                onChange={(event) => setProfileForm((current) => ({ ...current, fullName: event.target.value }))}
                placeholder="Your display name"
              />
            </label>

            <label className="settings-foundation-field">
              <span>Avatar URL</span>
              <input
                type="url"
                value={profileForm.avatarUrl}
                onChange={(event) => setProfileForm((current) => ({ ...current, avatarUrl: event.target.value }))}
                placeholder="https://..."
              />
            </label>
          </div>

          <div className="settings-foundation-actions">
            <button
              type="button"
              className="settings-primary"
              onClick={() => void handleSaveProfile()}
              disabled={savingProfile || !profileDirty}
            >
              {savingProfile ? <Loader2 size={14} className="org-spin" /> : <Save size={14} />}
              {savingProfile ? 'Saving...' : 'Save Profile'}
            </button>
          </div>
        </article>
      ) : null}

      {section === 'preferences' ? (
        <article className="settings-foundation-card">
          <div className="settings-foundation-grid">
            <label className="settings-foundation-field">
              <span>Timezone</span>
              <input
                type="text"
                value={preferenceForm.timezone}
                onChange={(event) => setPreferenceForm((current) => ({ ...current, timezone: event.target.value }))}
                placeholder="Africa/Lagos"
              />
            </label>

            <label className="settings-foundation-field">
              <span>Locale</span>
              <select
                value={preferenceForm.locale}
                onChange={(event) => setPreferenceForm((current) => ({ ...current, locale: event.target.value }))}
              >
                {LOCALE_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>

            <label className="settings-foundation-field">
              <span>Theme Preference</span>
              <select
                value={preferenceForm.themePreference}
                onChange={(event) => setPreferenceForm((current) => ({ ...current, themePreference: event.target.value }))}
              >
                {THEME_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>

            <label className="settings-foundation-field">
              <span>Default Landing Page</span>
              <select
                value={preferenceForm.defaultWorkspaceRoute}
                onChange={(event) => setPreferenceForm((current) => ({ ...current, defaultWorkspaceRoute: event.target.value }))}
              >
                {WORKSPACE_ROUTE_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="settings-foundation-actions">
            <button
              type="button"
              className="settings-primary"
              onClick={() => void handleSavePreferences()}
              disabled={savingPreferences || !preferencesDirty}
            >
              {savingPreferences ? <Loader2 size={14} className="org-spin" /> : <Save size={14} />}
              {savingPreferences ? 'Saving...' : 'Save Preferences'}
            </button>
          </div>
        </article>
      ) : null}

      {section === 'notifications' ? (
        <article className="settings-foundation-card">
          <div className="settings-toggle-list">
            <label className="settings-toggle-row">
              <div>
                <strong>Content Updates</strong>
                <p>Generation and post lifecycle updates.</p>
              </div>
              <input
                type="checkbox"
                checked={notificationForm.content_updates}
                onChange={(event) => setNotificationForm((current) => ({ ...current, content_updates: event.target.checked }))}
              />
            </label>

            <label className="settings-toggle-row">
              <div>
                <strong>Approval Events</strong>
                <p>Approval, rejection, and revision workflow updates.</p>
              </div>
              <input
                type="checkbox"
                checked={notificationForm.approvals}
                onChange={(event) => setNotificationForm((current) => ({ ...current, approvals: event.target.checked }))}
              />
            </label>

            <label className="settings-toggle-row">
              <div>
                <strong>Task Reminders</strong>
                <p>Due-soon task and assignment reminders.</p>
              </div>
              <input
                type="checkbox"
                checked={notificationForm.tasks}
                onChange={(event) => setNotificationForm((current) => ({ ...current, tasks: event.target.checked }))}
              />
            </label>

            <label className="settings-toggle-row">
              <div>
                <strong>System Alerts</strong>
                <p>Operational alerts and service-level warnings.</p>
              </div>
              <input
                type="checkbox"
                checked={notificationForm.system_alerts}
                onChange={(event) => setNotificationForm((current) => ({ ...current, system_alerts: event.target.checked }))}
              />
            </label>

            <label className="settings-toggle-row">
              <div>
                <strong>Weekly Digest</strong>
                <p>Weekly summary of activity and pending actions.</p>
              </div>
              <input
                type="checkbox"
                checked={notificationForm.weekly_digest}
                onChange={(event) => setNotificationForm((current) => ({ ...current, weekly_digest: event.target.checked }))}
              />
            </label>
          </div>

          <div className="settings-foundation-actions">
            <button
              type="button"
              className="settings-primary"
              onClick={() => void handleSaveNotifications()}
              disabled={savingNotifications || !notificationsDirty}
            >
              {savingNotifications ? <Loader2 size={14} className="org-spin" /> : <Save size={14} />}
              {savingNotifications ? 'Saving...' : 'Save Notifications'}
            </button>
          </div>
        </article>
      ) : null}
    </section>
  );
}
