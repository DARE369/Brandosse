import React from 'react';
import { Facebook, Instagram, Linkedin, Twitter, Video, Youtube } from 'lucide-react';

const ICON_MAP = {
  youtube: Youtube,
  tiktok: Video,
  facebook: Facebook,
  x: Twitter,
  twitter: Twitter,
  instagram: Instagram,
  linkedin: Linkedin,
};

const SIZE_MAP = {
  xs: 14,
  sm: 18,
  md: 24,
  lg: 32,
};

const LABEL_MAP = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  x: 'X',
  twitter: 'X',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  pinterest: 'Pinterest',
  threads: 'Threads',
};

function normalizePlatform(platform) {
  const key = String(platform || '').toLowerCase().trim();
  if (key === 'twitter') return 'x';
  return key || 'unknown';
}

export default function PlatformIcon({
  platform,
  size = 'sm',
  showLabel = false,
  className = '',
}) {
  const key = normalizePlatform(platform);
  const Icon = ICON_MAP[key] || null;
  const px = SIZE_MAP[size] || SIZE_MAP.sm;
  const label = LABEL_MAP[key] || 'Platform';

  return (
    <span className={`platform-icon-wrap ${className}`.trim()}>
      <span
        className={`platform-icon platform-${key}`}
        aria-label={label}
        title={label}
      >
        {Icon ? <Icon size={px} /> : <span className="platform-icon-fallback-text">{label.slice(0, 1)}</span>}
      </span>
      {showLabel && <span className="platform-icon-label">{label}</span>}
    </span>
  );
}
