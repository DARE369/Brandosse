import React from 'react';
import PlatformIcon from '../../../components/Shared/PlatformIcon';

const DEFAULT_PLATFORM_ACCENT = 'var(--color-primary)';

function PlatformBadge({ platform }) {
  if (platform?.icon_url) {
    return <img src={platform.icon_url} alt={platform.display_name} className="connected-platform-logo" />;
  }

  return (
    <span className="connected-platform-logo connected-platform-logo-fallback" style={{ color: platform?.brand_color || DEFAULT_PLATFORM_ACCENT }}>
      <PlatformIcon platform={platform?.platform_key} size="md" />
    </span>
  );
}

export default function PlatformGrid({
  platforms = [],
  connectedAccounts = [],
  onConnect,
}) {
  const connectedPlatformMap = new Map(
    connectedAccounts.map((account) => [account.platform, account]),
  );

  return (
    <div className="connected-platform-grid" role="list" aria-label="Available platforms">
      {platforms.map((platform) => {
        const account = connectedPlatformMap.get(platform.platform_key);
        const isConnected = Boolean(account);
        const isSoon = platform.is_active === false;

        return (
          <button
            key={platform.id || platform.platform_key}
            type="button"
            className={`connected-platform-card ${isConnected ? 'is-connected' : ''} ${isSoon ? 'is-soon' : ''}`.trim()}
            style={{ '--connected-platform-accent': platform.brand_color || DEFAULT_PLATFORM_ACCENT }}
            onClick={() => !isSoon && onConnect?.(platform)}
            disabled={isSoon}
            role="listitem"
          >
            <span className={`connected-platform-chip ${isConnected ? 'connected' : isSoon ? 'soon' : ''}`.trim()}>
              {isConnected ? 'Connected' : isSoon ? 'Soon' : 'Connect'}
            </span>

            <PlatformBadge platform={platform} />

            <div className="connected-platform-copy">
              <strong>{platform.display_name}</strong>
              <p>{platform.mock_login_description || `Connect ${platform.display_name} to SocialAI.`}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
