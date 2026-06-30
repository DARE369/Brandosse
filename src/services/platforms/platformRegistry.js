import { supabase } from '../supabaseClient';
import { comparePlatforms } from './platformUtils';

let platformCache = [];
let platformMap = new Map();
let inFlightPromise = null;

const DEFAULT_PLATFORM_REGISTRY = [
  {
    id: 'instagram',
    platform_key: 'instagram',
    display_name: 'Instagram',
    brand_color: '#E1306C',
    supported_profile_types: ['Business', 'Creator', 'Personal'],
    supported_content_types: ['image', 'video', 'carousel', 'story', 'reel'],
    character_limit: 2200,
    supports_scheduling: true,
    supports_stories: true,
    supports_reels: true,
    supports_carousels: true,
    mock_login_headline: 'Sign in to Instagram',
    mock_login_description: 'Connect your Instagram account to SocialAI to schedule and publish content.',
    is_active: true,
    display_order: 1,
  },
  {
    id: 'tiktok',
    platform_key: 'tiktok',
    display_name: 'TikTok',
    brand_color: '#010101',
    supported_profile_types: ['Business', 'Creator', 'Personal'],
    supported_content_types: ['video'],
    character_limit: 2200,
    supports_scheduling: true,
    supports_stories: false,
    supports_reels: false,
    supports_carousels: false,
    mock_login_headline: 'Sign in to TikTok',
    mock_login_description: 'Connect your TikTok account to SocialAI to schedule videos.',
    is_active: true,
    display_order: 2,
  },
  {
    id: 'youtube',
    platform_key: 'youtube',
    display_name: 'YouTube',
    brand_color: '#FF0000',
    supported_profile_types: ['Business', 'Creator'],
    supported_content_types: ['video'],
    character_limit: 5000,
    supports_scheduling: true,
    supports_stories: false,
    supports_reels: false,
    supports_carousels: false,
    mock_login_headline: 'Sign in to YouTube',
    mock_login_description: 'Connect your YouTube channel to SocialAI to publish videos.',
    is_active: true,
    display_order: 3,
  },
  {
    id: 'facebook',
    platform_key: 'facebook',
    display_name: 'Facebook',
    brand_color: '#1877F2',
    supported_profile_types: ['Business', 'Personal'],
    supported_content_types: ['image', 'video', 'carousel'],
    character_limit: 63206,
    supports_scheduling: true,
    supports_stories: true,
    supports_reels: false,
    supports_carousels: true,
    mock_login_headline: 'Sign in to Facebook',
    mock_login_description: 'Connect your Facebook Page to SocialAI to manage and schedule posts.',
    is_active: true,
    display_order: 4,
  },
  {
    id: 'linkedin',
    platform_key: 'linkedin',
    display_name: 'LinkedIn',
    brand_color: '#0A66C2',
    supported_profile_types: ['Business', 'Personal'],
    supported_content_types: ['image', 'video'],
    character_limit: 3000,
    supports_scheduling: true,
    supports_stories: false,
    supports_reels: false,
    supports_carousels: true,
    mock_login_headline: 'Sign in to LinkedIn',
    mock_login_description: 'Connect your LinkedIn profile or company page to SocialAI.',
    is_active: true,
    display_order: 5,
  },
  {
    id: 'twitter',
    platform_key: 'twitter',
    display_name: 'X (Twitter)',
    brand_color: '#000000',
    supported_profile_types: ['Business', 'Personal'],
    supported_content_types: ['image', 'video'],
    character_limit: 280,
    supports_scheduling: true,
    supports_stories: false,
    supports_reels: false,
    supports_carousels: false,
    mock_login_headline: 'Sign in to X',
    mock_login_description: 'Connect your X account to SocialAI to schedule tweets.',
    is_active: true,
    display_order: 6,
  },
  {
    id: 'pinterest',
    platform_key: 'pinterest',
    display_name: 'Pinterest',
    brand_color: '#E60023',
    supported_profile_types: ['Business', 'Creator', 'Personal'],
    supported_content_types: ['image', 'video'],
    character_limit: 500,
    supports_scheduling: true,
    supports_stories: false,
    supports_reels: false,
    supports_carousels: false,
    mock_login_headline: 'Sign in to Pinterest',
    mock_login_description: 'Connect your Pinterest account to SocialAI to schedule pins.',
    is_active: true,
    display_order: 7,
  },
  {
    id: 'threads',
    platform_key: 'threads',
    display_name: 'Threads',
    brand_color: '#101010',
    supported_profile_types: ['Business', 'Creator', 'Personal'],
    supported_content_types: ['image', 'video'],
    character_limit: 500,
    supports_scheduling: true,
    supports_stories: false,
    supports_reels: false,
    supports_carousels: false,
    mock_login_headline: 'Sign in to Threads',
    mock_login_description: 'Connect your Threads account to SocialAI to schedule posts.',
    is_active: true,
    display_order: 8,
  },
];

function isMissingRegistryError(error) {
  const message = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return message.includes('platform_registry')
    || message.includes('does not exist')
    || message.includes('could not find')
    || message.includes('pgrst');
}

function setPlatformCache(rows) {
  platformCache = [...rows].sort(comparePlatforms);
  platformMap = new Map(platformCache.map((row) => [row.platform_key, row]));
  return platformCache;
}

async function fetchPlatformRegistry() {
  const { data, error } = await supabase
    .from('platform_registry')
    .select('*')
    .order('display_order', { ascending: true });

  if (error) {
    if (isMissingRegistryError(error)) {
      return setPlatformCache(DEFAULT_PLATFORM_REGISTRY);
    }
    throw error;
  }
  return setPlatformCache(Array.isArray(data) ? data : []);
}

export async function getAllPlatforms(options = {}) {
  const { includeInactive = false, forceRefresh = false } = options;

  if (!forceRefresh && platformCache.length > 0) {
    return includeInactive
      ? [...platformCache]
      : platformCache.filter((platform) => platform.is_active !== false);
  }

  if (!inFlightPromise || forceRefresh) {
    inFlightPromise = fetchPlatformRegistry().finally(() => {
      inFlightPromise = null;
    });
  }

  const rows = await inFlightPromise;
  return includeInactive
    ? [...rows]
    : rows.filter((platform) => platform.is_active !== false);
}

export async function getPlatform(platformKey) {
  const key = String(platformKey || '').trim().toLowerCase();
  if (!key) return null;
  if (platformMap.has(key)) return platformMap.get(key) || null;
  await getAllPlatforms({ includeInactive: true });
  return platformMap.get(key) || null;
}

export function getPlatformColor(platformKey) {
  return platformMap.get(String(platformKey || '').trim().toLowerCase())?.brand_color || '#6366f1';
}

export function getPlatformIcon(platformKey) {
  return platformMap.get(String(platformKey || '').trim().toLowerCase())?.icon_url || null;
}

export function clearPlatformRegistryCache() {
  platformCache = [];
  platformMap = new Map();
  inFlightPromise = null;
}
