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
  video_quality: 'standard',
  match_brand_kit: true,
  image_model: 'auto',
  style_lock: false,
  reference_images: [],
  default_platforms: [],
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
    video_quality: String(source.video_quality || DEFAULT_GENERATION_DEFAULTS.video_quality),
    match_brand_kit: normalizeBoolean(source.match_brand_kit, DEFAULT_GENERATION_DEFAULTS.match_brand_kit),
    image_model: String(source.image_model || DEFAULT_GENERATION_DEFAULTS.image_model),
    style_lock: normalizeBoolean(source.style_lock, DEFAULT_GENERATION_DEFAULTS.style_lock),
    reference_images: Array.isArray(source.reference_images)
      ? source.reference_images.filter((u) => typeof u === 'string' && u).slice(0, 6)
      : DEFAULT_GENERATION_DEFAULTS.reference_images,
    default_platforms: Array.isArray(source.default_platforms)
      ? source.default_platforms.filter((p) => typeof p === 'string')
      : DEFAULT_GENERATION_DEFAULTS.default_platforms,
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

// ── Account requests (Settings > Data & privacy) ─────────────────────────────
// Request-only: no automated deletion/export pipeline exists yet. Submitting
// records a real row an admin actions manually — see
// supabase/migrations/20260716120000_user_account_requests.sql.
export async function fetchPendingAccountRequests(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('user_account_requests')
    .select('id, request_type, status, note, created_at')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function submitAccountRequest(userId, requestType, note = '') {
  if (!userId) throw new Error('User ID is required to submit an account request.');
  if (!['deletion', 'export'].includes(requestType)) {
    throw new Error('Invalid account request type.');
  }

  const { data, error } = await supabase
    .from('user_account_requests')
    .insert({ user_id: userId, request_type: requestType, note: note || null })
    .select('id, request_type, status, note, created_at')
    .single();

  if (error) throw error;
  return data;
}

export async function cancelAccountRequest(requestId) {
  const { error } = await supabase
    .from('user_account_requests')
    .update({ status: 'cancelled' })
    .eq('id', requestId);

  if (error) throw error;
}

// ── Onboarding wizard (first login) ──────────────────────────────────────────
export async function fetchOnboardingCompleted(userId) {
  if (!userId) return true;
  const { data, error } = await supabase
    .from('user_settings')
    .select('onboarding_completed_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data?.onboarding_completed_at);
}

export async function markOnboardingCompleted(userId) {
  if (!userId) return;
  const { error } = await supabase
    .from('user_settings')
    .upsert({ user_id: userId, onboarding_completed_at: new Date().toISOString() }, { onConflict: 'user_id' });

  if (error) throw error;
}
