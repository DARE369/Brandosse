/**
 * GET /api/auth/oauth/available?platform=instagram
 *
 * Returns whether real OAuth credentials are configured for the platform.
 * The frontend calls this before deciding to use real vs. mock OAuth.
 */
const PLATFORM_CREDENTIAL_MAP = {
  instagram: ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET'],
  facebook:  ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET'],
  linkedin:  ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
  x:         ['X_CLIENT_ID', 'X_CLIENT_SECRET'],
  twitter:   ['X_CLIENT_ID', 'X_CLIENT_SECRET'],
  tiktok:    ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'],
};

function hasStateSigningSecret() {
  return Boolean(
    process.env.OAUTH_STATE_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.NEXTAUTH_SECRET,
  );
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const platform = searchParams.get('platform')?.toLowerCase();

  if (!platform) {
    return Response.json({ error: 'platform is required' }, { status: 400 });
  }

  const requiredKeys = PLATFORM_CREDENTIAL_MAP[platform];
  if (!requiredKeys) {
    return Response.json({ available: false, reason: 'unsupported_platform' });
  }

  const credentialsConfigured = requiredKeys.every((key) => Boolean(process.env[key]));
  const stateConfigured = hasStateSigningSecret();
  const available = credentialsConfigured && stateConfigured;

  return Response.json({
    available,
    platform,
    reason: available
      ? null
      : credentialsConfigured
        ? 'missing_state_signing_secret'
        : 'missing_platform_credentials',
  });
}
