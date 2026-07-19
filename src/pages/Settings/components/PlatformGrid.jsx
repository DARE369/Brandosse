import React from 'react';
import { ChevronRight } from 'lucide-react';
import PlatformIcon from '../../../components/Shared/PlatformIcon';
import { Badge } from '../../../ui-v2';
import styles from './PlatformGrid.module.css';

export default function PlatformGrid({ platforms = [], connectedAccounts = [], onConnect }) {
  const connectedPlatformMap = new Map(connectedAccounts.map((account) => [account.platform, account]));

  return (
    <div className={styles.grid} role="list" aria-label="Available platforms">
      {platforms.map((platform) => {
        const account = connectedPlatformMap.get(platform.platform_key);
        const isConnected = Boolean(account);
        const isSoon = platform.is_active === false;

        return (
          <button
            key={platform.id || platform.platform_key}
            type="button"
            className={styles.tile}
            style={{ '--tile-accent': platform.brand_color }}
            onClick={() => !isSoon && onConnect?.(platform)}
            disabled={isSoon}
            role="listitem"
          >
            <span className={styles.iconWrap}><PlatformIcon platform={platform.platform_key} size="md" /></span>
            <div className={styles.copy}>
              <strong className={styles.name}>{platform.display_name}</strong>
              <p className={styles.desc}>{platform.mock_login_description || `Connect ${platform.display_name} to Brandosse.`}</p>
            </div>
            {isConnected ? (
              <Badge tone="success">Connected</Badge>
            ) : isSoon ? (
              <Badge tone="neutral">Soon</Badge>
            ) : (
              <ChevronRight size={15} className={styles.chevron} aria-hidden="true" />
            )}
          </button>
        );
      })}
    </div>
  );
}
