import { supabase } from './supabaseClient';

export const ALLOWED_WORKSPACE_ROUTES = [
  '/app/dashboard',
  '/app/generate',
  '/app/calendar',
  '/app/library',
  '/app/help',
  '/app/settings',
];

const ALLOWED_THEME_PREFERENCES = ['system', 'light', 'dark'];

const DEFAULT_NOTIFICATION_PREFERENCES = {
  content_updates: true,
  approvals: true,
  tasks: true,
  system_alerts: true,
  weekly_digest: false,
};

const DEFAULT_GENERATION_DEFAULTS = {
  media_type: 'image',
  aspect_ratio: '1:1',
};

const DEFAULT_CALENDAR_DEFAULTS = {
  default_view: 'month',
  week_starts_on: 'monday',
};

const DEFAULT_PRIVACY_PREFERENCES = {
  profile_visibility: 'team',
};

export const DEFAULT_USER_SETTINGS = {
  timezone: 'UTC',
  locale: 'en-US',
  themePreference: 'system',
  defaultWorkspaceRoute: '/app/dashboard',
  notificationPreferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
  generationDefaults: { ...DEFAULT_GENERATION_DEFAULTS },
  calendarDefaults: { ...DEFAULT_CALENDAR_DEFAULTS },
  privacyPreferences: { ...DEFAULT_PRIVACY_PREFERENCES },
};

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  return fallback;
}

function normalizeTimezone(value) {
  const normalized = String(value || '').trim();
  return normalized || DEFAULT_USER_SETTINGS.timezone;
}

function normalizeLocale(value) {
  const normalized = String(value || '').trim();
  return normalized || DEFAULT_USER_SETTINGS.locale;
}

function normalizeThemePreference(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ALLOWED_THEME_PREFERENCES.includes(normalized)
    ? normalized
    : DEFAULT_USER_SETTINGS.themePreference;
}

export function normalizeDefaultWorkspaceRoute(value) {
  const normalized = String(value || '').trim();
  return ALLOWED_WORKSPACE_ROUTES.includes(normalized)
    ? normalized
    : DEFAULT_USER_SETTINGS.defaultWorkspaceRoute;
}

function normalizeNotificationPreferences(value) {
  const source = safeObject(value);
  return {
    content_updates: normalizeBoolean(
      source.content_updates,
      DEFAULT_NOTIFICATION_PREFERENCES.content_updates,
    ),
    approvals: normalizeBoolean(
      source.approvals,
      DEFAULT_NOTIFICATION_PREFERENCES.approvals,
    ),
    tasks: normalizeBoolean(
      source.tasks,
      DEFAULT_NOTIFICATION_PREFERENCES.tasks,
    ),
    system_alerts: normalizeBoolean(
      source.system_alerts,
      DEFAULT_NOTIFICATION_PREFERENCES.system_alerts,
    ),
    weekly_digest: normalizeBoolean(
      source.weekly_digest,
      DEFAULT_NOTIFICATION_PREFERENCES.weekly_digest,
    ),
  };
}

function normalizeGenerationDefaults(value) {
  const source = safeObject(value);
  return {
    media_type: String(source.media_type || DEFAULT_GENERATION_DEFAULTS.media_type),
    aspect_ratio: String(source.aspect_ratio || DEFAULT_GENERATION_DEFAULTS.aspect_ratio),
  };
}

function normalizeCalendarDefaults(value) {
  const source = safeObject(value);
  return {
    default_view: String(source.default_view || DEFAULT_CALENDAR_DEFAULTS.default_view),
    week_starts_on: String(source.week_starts_on || DEFAULT_CALENDAR_DEFAULTS.week_starts_on),
  };
}

function normalizePrivacyPreferences(value) {
  const source = safeObject(value);
  return {
    profile_visibility: String(source.profile_visibility || DEFAULT_PRIVACY_PREFERENCES.profile_visibility),
  };
}

export function normalizeUserSettingsRow(row = null) {
  const source = safeObject(row);
  return {
    timezone: normalizeTimezone(source.timezone),
    locale: normalizeLocale(source.locale),
    themePreference: normalizeThemePreference(source.theme_preference),
    defaultWorkspaceRoute: normalizeDefaultWorkspaceRoute(source.default_workspace_route),
    notificationPreferences: normalizeNotificationPreferences(source.notification_preferences),
    generationDefaults: normalizeGenerationDefaults(source.generation_defaults),
    calendarDefaults: normalizeCalendarDefaults(source.calendar_defaults),
    privacyPreferences: normalizePrivacyPreferences(source.privacy_preferences),
  };
}

function toDbPayload(userId, settings) {
  return {
    user_id: userId,
    timezone: settings.timezone,
    locale: settings.locale,
    theme_preference: settings.themePreference,
    default_workspace_route: settings.defaultWorkspaceRoute,
    notification_preferences: settings.notificationPreferences,
    generation_defaults: settings.generationDefaults,
    calendar_defaults: settings.calendarDefaults,
    privacy_preferences: settings.privacyPreferences,
  };
}

function mergeSettings(current, patch = {}) {
  const next = {
    timezone: patch.timezone ?? current.timezone,
    locale: patch.locale ?? current.locale,
    themePreference: patch.themePreference ?? current.themePreference,
    defaultWorkspaceRoute: patch.defaultWorkspaceRoute ?? current.defaultWorkspaceRoute,
    notificationPreferences: {
      ...current.notificationPreferences,
      ...safeObject(patch.notificationPreferences),
    },
    generationDefaults: {
      ...current.generationDefaults,
      ...safeObject(patch.generationDefaults),
    },
    calendarDefaults: {
      ...current.calendarDefaults,
      ...safeObject(patch.calendarDefaults),
    },
    privacyPreferences: {
      ...current.privacyPreferences,
      ...safeObject(patch.privacyPreferences),
    },
  };

  return normalizeUserSettingsRow({
    timezone: next.timezone,
    locale: next.locale,
    theme_preference: next.themePreference,
    default_workspace_route: next.defaultWorkspaceRoute,
    notification_preferences: next.notificationPreferences,
    generation_defaults: next.generationDefaults,
    calendar_defaults: next.calendarDefaults,
    privacy_preferences: next.privacyPreferences,
  });
}

async function ensureUserSettingsRow(userId) {
  const defaults = normalizeUserSettingsRow(DEFAULT_USER_SETTINGS);
  const payload = toDbPayload(userId, defaults);
  const { error } = await supabase
    .from('user_settings')
    .upsert(payload, { onConflict: 'user_id' });

  if (error) {
    throw error;
  }
}

export async function fetchUserSettings(userId) {
  if (!userId) {
    throw new Error('User ID is required to load settings.');
  }

  const { data, error } = await supabase
    .from('user_settings')
    .select('user_id, timezone, locale, theme_preference, default_workspace_route, notification_preferences, generation_defaults, calendar_defaults, privacy_preferences')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    await ensureUserSettingsRow(userId);
    return { ...normalizeUserSettingsRow(DEFAULT_USER_SETTINGS) };
  }

  return normalizeUserSettingsRow(data);
}

export async function saveUserSettings(userId, patch = {}) {
  if (!userId) {
    throw new Error('User ID is required to save settings.');
  }

  const current = await fetchUserSettings(userId);
  const merged = mergeSettings(current, patch);
  const payload = toDbPayload(userId, merged);

  const { data, error } = await supabase
    .from('user_settings')
    .upsert(payload, { onConflict: 'user_id' })
    .select('user_id, timezone, locale, theme_preference, default_workspace_route, notification_preferences, generation_defaults, calendar_defaults, privacy_preferences')
    .maybeSingle();

  if (error) {
    throw error;
  }

  return normalizeUserSettingsRow(data || payload);
}

export async function updateUserProfileSettings(userId, patch = {}) {
  if (!userId) {
    throw new Error('User ID is required to update profile settings.');
  }

  const updates = {};
  const nextName = String(patch.fullName || '').trim();
  const nextAvatar = String(patch.avatarUrl || '').trim();

  if (nextName) {
    updates.full_name = nextName;
  }
  updates.avatar_url = nextAvatar || null;

  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select('id, full_name, avatar_url')
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || {
    id: userId,
    full_name: updates.full_name || null,
    avatar_url: updates.avatar_url || null,
  };
}
