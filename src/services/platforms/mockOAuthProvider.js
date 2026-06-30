const PLATFORM_PREFIX = {
  instagram: 'ig',
  tiktok: 'tt',
  youtube: 'yt',
  facebook: 'fb',
  linkedin: 'li',
  twitter: 'x',
  pinterest: 'pin',
  threads: 'thr',
};

const PLATFORM_SCOPES = {
  instagram: ['instagram_basic', 'instagram_content_publish'],
  tiktok: ['user.info.basic', 'video.upload', 'video.publish'],
  youtube: ['youtube.upload', 'youtube.readonly'],
  facebook: ['pages_manage_posts', 'pages_read_engagement'],
  linkedin: ['w_member_social', 'r_basicprofile'],
  twitter: ['tweet.read', 'tweet.write', 'users.read'],
  pinterest: ['pins:read', 'pins:write'],
  threads: ['threads_basic', 'threads_content_publish'],
};

function randomHex(length = 8) {
  return Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

function buildMockProfilePictureUrl(seed) {
  return `https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(seed)}`;
}

function toUsername(value, fallback) {
  const normalized = String(value || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .toLowerCase();

  return normalized || fallback;
}

function toPositiveInt(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) && next >= 0 ? Math.round(next) : fallback;
}

function buildMetadata(platform, formData, username, displayName) {
  const followerCount = toPositiveInt(formData?.followerCount, Math.floor(Math.random() * 90000) + 1000);

  return {
    mock: true,
    account_category: formData?.accountCategory || null,
    display_name: displayName,
    profile_type: formData?.profileType || 'Business',
    follower_count: followerCount,
    platform_user_id: `${PLATFORM_PREFIX[platform] || 'acct'}_${randomHex(12)}`,
    scopes: PLATFORM_SCOPES[platform] || [],
    stats: {
      followers: followerCount,
      posts: Math.floor(Math.random() * 300) + 10,
      impressions: Math.floor(Math.random() * 400000) + 5000,
    },
    username,
  };
}

export async function authenticate(platform, formData = {}) {
  const platformKey = String(platform || '').trim().toLowerCase();
  const prefix = PLATFORM_PREFIX[platformKey] || 'acct';
  const username = toUsername(
    formData.username,
    `${prefix}_${randomHex(6)}`,
  );
  const displayName = String(formData.displayName || formData.accountName || username)
    .trim()
    || username;
  const token = `mock_${platformKey}_${Date.now()}_${randomHex(8)}`;
  const tokenExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const profilePictureUrl = String(formData.profilePictureUrl || '').trim() || buildMockProfilePictureUrl(`${platformKey}-${username}`);
  const metadata = buildMetadata(platformKey, formData, username, displayName);

  await new Promise((resolve) => window.setTimeout(resolve, 850));

  return {
    success: true,
    token,
    tokenExpiresAt,
    platformUserId: metadata.platform_user_id,
    username,
    displayName,
    profilePictureUrl,
    followerCount: metadata.follower_count,
    accountCategory: metadata.account_category,
    profileType: metadata.profile_type,
    scopes: metadata.scopes,
    metadata,
  };
}

export async function refreshToken(account = {}) {
  const platformKey = String(account.platform || '').trim().toLowerCase();
  const token = `mock_${platformKey}_${Date.now()}_${randomHex(8)}`;
  const tokenExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  await new Promise((resolve) => window.setTimeout(resolve, 650));

  return {
    success: true,
    token,
    tokenExpiresAt,
  };
}

export function generateMockPostId(platform) {
  const prefixMap = {
    instagram: 'IG_POST',
    tiktok: 'TT_POST',
    youtube: 'YT_POST',
    facebook: 'FB_POST',
    linkedin: 'LI_POST',
    twitter: 'X_POST',
    pinterest: 'PIN_POST',
    threads: 'THR_POST',
  };

  return `${prefixMap[String(platform || '').toLowerCase()] || 'POST'}_${randomHex(8)}`;
}
