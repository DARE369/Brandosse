/**
 * socialProviders.js — the one place that knows how to talk OAuth to each
 * platform. SERVER ONLY.
 *
 * Lives under app/api/_lib/ for the same reason oauthState.js does: it reads
 * client SECRETS. Anything under src/ is client-bundleable, so a component
 * importing this from there would ship a full account-takeover primitive to
 * the browser. scripts/check-env-security.cjs enforces the boundary; the
 * underscore prefix keeps Next from treating this as a route.
 *
 * ── Why a registry rather than per-route constants ──────────────────────────
 * Four platforms x (connect, callback, refresh, revoke, publish) is twenty
 * places to get an endpoint, a scope string or an API version wrong. This
 * repository's dominant defect is disconnection, and its second is drift —
 * platformCaptionSpecs already exists as two mirrored copies with a comment
 * asking that they be kept in sync by hand. One registry, imported everywhere,
 * is how that is avoided rather than documented.
 *
 * ── Fail closed ─────────────────────────────────────────────────────────────
 * requireProvider() throws when credentials are absent. It never falls back to
 * a mock, a default, or a partially-configured provider. The audit found
 * fail-open defaults to be a recurring source of silent compromise here, and a
 * half-configured OAuth client is worse than an absent one: it produces a
 * connect flow that appears to work and yields an account that cannot publish.
 *
 * ── Meta covers two platform tiles ──────────────────────────────────────────
 * Instagram professional accounts are reached THROUGH Facebook Login. There is
 * one Meta OAuth client and one redirect URI; `facebook` and `instagram` are
 * presentation-level tiles that both start the `meta` flow and diverge only at
 * sub-account selection. Keeping that fact here, once, stops it being
 * rediscovered in four call sites.
 */

/** Platforms the UI offers, mapped to the OAuth provider that serves them. */
const PLATFORM_TO_PROVIDER = {
  facebook: 'meta',
  instagram: 'meta',
  meta: 'meta',
  tiktok: 'tiktok',
  linkedin: 'linkedin',
  youtube: 'youtube',
};

/**
 * API versions are pinned, never floating.
 *
 * Meta deprecates Graph versions on a roughly two-year clock, and an
 * unversioned call silently follows their default forward — the same failure
 * shape as a `-latest` model alias, which LOCK L4.7 already forbids for
 * exactly this reason. A pinned version fails loudly on the day it dies
 * instead of changing behaviour underneath a working integration.
 */
const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';

const PROVIDERS = {
  meta: {
    id: 'meta',
    label: 'Meta',
    platforms: ['facebook', 'instagram'],
    clientId: () => process.env.META_APP_ID,
    clientSecret: () => process.env.META_APP_SECRET,
    authorizeUrl: `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`,
    tokenUrl: `https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`,
    apiBase: `https://graph.facebook.com/${META_GRAPH_VERSION}`,
    scopes: [
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_posts',
      'business_management',
      'instagram_basic',
      'instagram_content_publish',
    ],
    // Meta returns a short-lived token that must be exchanged for a ~60-day
    // one. There is no refresh token: the long-lived token is re-exchanged
    // before expiry, so token_expires_at is load-bearing, not decorative.
    refreshStyle: 'reexchange',
    // Forces the account chooser instead of silently reusing whichever Facebook
    // session the browser already has. Without it, a user connecting a second
    // Page is handed the first account again with no way to switch.
    extraAuthParams: { auth_type: 'rerequest' },
  },

  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    platforms: ['tiktok'],
    clientId: () => process.env.TIKTOK_CLIENT_KEY,
    clientSecret: () => process.env.TIKTOK_CLIENT_SECRET,
    authorizeUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    apiBase: 'https://open.tiktokapis.com/v2',
    scopes: ['user.info.basic', 'video.publish'],
    refreshStyle: 'refresh_token',
    // TikTok names the client credential `client_key`, not `client_id`, on
    // both the authorize and token endpoints. Getting this wrong yields an
    // opaque error that reads like a bad secret.
    clientIdParam: 'client_key',
    // HTTPS only — TikTok rejects localhost redirect URIs outright, so local
    // development needs a tunnel. See PLATFORM-CREDENTIALS-SETUP.md §1.2.
    requiresHttps: true,
  },

  linkedin: {
    id: 'linkedin',
    label: 'LinkedIn',
    platforms: ['linkedin'],
    clientId: () => process.env.LINKEDIN_CLIENT_ID,
    clientSecret: () => process.env.LINKEDIN_CLIENT_SECRET,
    authorizeUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    apiBase: 'https://api.linkedin.com/v2',
    scopes: ['openid', 'profile', 'w_member_social'],
    // LinkedIn issues no refresh token on the standard tier. Tokens last ~60
    // days and then the user must re-authorize by hand. That makes the
    // "Expiring soon" account state the only thing standing between a user and
    // a silently dead integration — it is a functional requirement here, not a
    // nicety.
    refreshStyle: 'none',
    tokenLifetimeDays: 60,
  },

  youtube: {
    id: 'youtube',
    label: 'YouTube',
    platforms: ['youtube'],
    clientId: () => process.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    apiBase: 'https://www.googleapis.com/youtube/v3',
    scopes: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly',
    ],
    refreshStyle: 'refresh_token',
    // Google only returns a refresh token when it is asked to, and only on the
    // FIRST authorization unless prompted again. Omitting either parameter
    // produces an integration that works for one hour and then dies with no
    // way to recover short of a full reconnect.
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  },
};

/** Resolve a UI platform key to its OAuth provider config. */
export function providerForPlatform(platform) {
  const key = PLATFORM_TO_PROVIDER[String(platform || '').trim().toLowerCase()];
  return key ? PROVIDERS[key] : null;
}

/** Is this provider's credential pair present in this environment? */
export function isConfigured(platform) {
  const p = providerForPlatform(platform);
  return Boolean(p && p.clientId() && p.clientSecret());
}

/**
 * Fetch a provider, or refuse.
 *
 * Throws rather than returning null so a caller cannot accidentally proceed
 * with a partially-configured provider. The error names the missing variable,
 * because "OAuth failed" with no cause is the single least useful thing this
 * flow could say to whoever is setting up an environment.
 */
export function requireProvider(platform) {
  const p = providerForPlatform(platform);
  if (!p) throw new Error(`unsupported_platform:${platform}`);

  const missing = [];
  if (!p.clientId()) missing.push(p.id === 'meta' ? 'META_APP_ID'
    : p.id === 'tiktok' ? 'TIKTOK_CLIENT_KEY'
    : p.id === 'linkedin' ? 'LINKEDIN_CLIENT_ID'
    : 'GOOGLE_OAUTH_CLIENT_ID');
  if (!p.clientSecret()) missing.push(p.id === 'meta' ? 'META_APP_SECRET'
    : p.id === 'tiktok' ? 'TIKTOK_CLIENT_SECRET'
    : p.id === 'linkedin' ? 'LINKEDIN_CLIENT_SECRET'
    : 'GOOGLE_OAUTH_CLIENT_SECRET');

  if (missing.length) {
    throw new Error(
      `app_not_configured:${p.id} — missing ${missing.join(', ')}. ` +
      'Connect is disabled for this platform until they are set; ' +
      'see PLATFORM-CREDENTIALS-SETUP.md.',
    );
  }
  return p;
}

/**
 * Build the redirect URI for a provider.
 *
 * Platforms match this EXACTLY against an allowlist registered in their
 * dashboard, so it must be derived from one value and never assembled ad hoc.
 * A trailing slash, a preview-deployment hostname, or http-vs-https is enough
 * to fail the exchange with an error that names none of those causes.
 */
export function redirectUriFor(providerId, appUrl) {
  const base = String(appUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('missing_app_url');
  const uri = `${base}/api/auth/social/${providerId}/callback`;

  const p = PROVIDERS[providerId];
  if (p?.requiresHttps && !uri.startsWith('https://')) {
    throw new Error(
      `${p.label} rejects non-HTTPS redirect URIs, so "${uri}" cannot work. ` +
      'Use a tunnel that gives a stable HTTPS hostname for local development.',
    );
  }
  return uri;
}

/** Which platforms are usable in this environment — powers the connect UI. */
export function configuredPlatforms() {
  return Object.keys(PLATFORM_TO_PROVIDER)
    .filter((k) => k !== 'meta')
    .filter(isConfigured);
}

export { PROVIDERS, PLATFORM_TO_PROVIDER, META_GRAPH_VERSION };
