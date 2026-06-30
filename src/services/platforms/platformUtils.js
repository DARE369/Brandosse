export const RAW_CONNECTED_ACCOUNT_STATUS = {
  ACTIVE: 'active',
  MOCK: 'mock',
  EXPIRED: 'expired',
  ERROR: 'error',
  RECONNECTING: 'reconnecting',
  REVOKED: 'revoked',
  DISCONNECTED: 'disconnected',
};

export function normalizeConnectedAccountStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  return value || RAW_CONNECTED_ACCOUNT_STATUS.ACTIVE;
}

export function getConnectedAccountSemanticStatus(status) {
  const normalized = normalizeConnectedAccountStatus(status);
  if (normalized === RAW_CONNECTED_ACCOUNT_STATUS.REVOKED) return 'disconnected';
  if (normalized === RAW_CONNECTED_ACCOUNT_STATUS.MOCK) return 'connected';
  return normalized;
}

export function isConnectedAccountUsable(status) {
  const normalized = normalizeConnectedAccountStatus(status);
  return normalized === RAW_CONNECTED_ACCOUNT_STATUS.ACTIVE || normalized === RAW_CONNECTED_ACCOUNT_STATUS.MOCK;
}

export function isConnectedAccountTerminal(status) {
  const normalized = normalizeConnectedAccountStatus(status);
  return normalized === RAW_CONNECTED_ACCOUNT_STATUS.REVOKED
    || normalized === RAW_CONNECTED_ACCOUNT_STATUS.DISCONNECTED;
}

export function isMockConnectedAccount(account) {
  if (!account || typeof account !== 'object') return false;
  return Boolean(
    account.is_mock
    || String(account.connection_status || '').trim().toLowerCase() === RAW_CONNECTED_ACCOUNT_STATUS.MOCK
    || account.platform_metadata?.mock === true,
  );
}

export function getConnectedAccountDisplayName(account) {
  return account?.display_name
    || account?.account_name
    || account?.username
    || account?.platform_display_name
    || account?.platform
    || 'Connected account';
}

export function getConnectedAccountAvatar(account) {
  return account?.profile_picture_url || account?.avatar_url || '';
}

export function normalizeConnectedAccountRow(row) {
  if (!row || typeof row !== 'object') return null;
  const normalizedStatus = normalizeConnectedAccountStatus(row.connection_status);
  const semanticStatus = getConnectedAccountSemanticStatus(normalizedStatus);

  return {
    ...row,
    account_name: row.account_name || row.display_name || row.username || row.platform || 'Connected account',
    display_name: row.display_name || row.account_name || row.username || row.platform || 'Connected account',
    avatar_url: row.avatar_url || row.profile_picture_url || '',
    profile_picture_url: row.profile_picture_url || row.avatar_url || '',
    connection_status: normalizedStatus,
    semantic_status: semanticStatus,
    is_mock: isMockConnectedAccount(row),
  };
}

export function comparePlatforms(left, right) {
  const leftOrder = Number(left?.display_order || 0);
  const rightOrder = Number(right?.display_order || 0);
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  return String(left?.display_name || left?.platform_key || '').localeCompare(
    String(right?.display_name || right?.platform_key || ''),
  );
}
