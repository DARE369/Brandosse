import React, { useEffect, useMemo, useState } from 'react';
import { Link2 } from 'lucide-react';
import { useAuth } from '../../Context/AuthContext';
import { useAppNavigation } from '../../Context/AppNavigationContext';
import { getAllPlatforms } from '../../services/platforms/platformRegistry';
import {
  disconnectAccount,
  getAccountsForUser,
  triggerReconnect,
} from '../../services/platforms/connectionService';
import PlatformGrid from './components/PlatformGrid';
import MockOAuthScreen from './components/MockOAuthScreen';
import ConnectedAccountCard from './components/ConnectedAccountCard';
import AccountHealthModal from './components/AccountHealthModal';

export default function ConnectedAccountsTab({ onToast }) {
  const { navigate } = useAppNavigation();
  const { user, orgMemberships } = useAuth();
  const [loading, setLoading] = useState(true);
  const [platforms, setPlatforms] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [selectedPlatform, setSelectedPlatform] = useState(null);
  const [editingAccount, setEditingAccount] = useState(null);
  const [healthAccountId, setHealthAccountId] = useState(null);

  const platformMap = useMemo(
    () => new Map(platforms.map((platform) => [platform.platform_key, platform])),
    [platforms],
  );

  const loadData = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const [platformRows, accountRows] = await Promise.all([
        getAllPlatforms(),
        getAccountsForUser(user.id, 'personal'),
      ]);
      setPlatforms(platformRows);
      setAccounts(accountRows);
    } catch (error) {
      onToast?.(error?.message || 'Could not load connected accounts.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [user?.id]);

  const handleReconnect = async (account) => {
    try {
      await triggerReconnect(account.id, user?.id);
      onToast?.(`${account.display_name || account.account_name} reconnected.`, 'success');
      await loadData();
    } catch (error) {
      onToast?.(error?.message || 'Could not reconnect this account.', 'error');
    }
  };

  const handleRemove = async (account) => {
    const confirmed = window.confirm(`Disconnect ${account.display_name || account.account_name || account.platform}?`);
    if (!confirmed) return;

    try {
      await disconnectAccount(account.id, user?.id);
      onToast?.(`${account.display_name || account.account_name} disconnected.`, 'success');
      await loadData();
    } catch (error) {
      onToast?.(error?.message || 'Could not disconnect this account.', 'error');
    }
  };

  const activeAccountCount = accounts.length;

  const getOrgNavigationTarget = (membership) => {
    if (membership?.role === 'org_owner' || membership?.role === 'org_admin') {
      return `/app/org/${membership.organizationId}/admin/settings`;
    }
    return `/app/org/${membership.organizationId}/workspace`;
  };

  return (
    <section className="connected-accounts-tab">
      <header className="connected-accounts-header">
        <div>
          <h1>Connected Accounts</h1>
          <p>Connect social accounts for scheduling, publishing, and multi-user workflows.</p>
        </div>
        <span className="connected-accounts-badge">{activeAccountCount} connected</span>
      </header>

      {Array.isArray(orgMemberships) && orgMemberships.length > 0 ? (
        <div className="connected-account-org-banners">
          {orgMemberships.map((membership) => (
            <article key={membership.id} className="connected-account-org-banner">
              <Link2 size={16} />
              <div>
                <strong>{membership.organization?.name || 'Organization workspace'}</strong>
                <p>Organization accounts are managed inside the org workspace settings.</p>
              </div>
              <button
                type="button"
                onClick={() => navigate(getOrgNavigationTarget(membership))}
              >
                {membership?.role === 'org_owner' || membership?.role === 'org_admin'
                  ? 'View Org Accounts'
                  : 'Open Workspace'}
              </button>
            </article>
          ))}
        </div>
      ) : null}

      {loading ? <div className="connected-accounts-empty">Loading connected accounts...</div> : null}

      {!loading && accounts.length > 0 ? (
        <section className="connected-account-section">
          <div className="connected-account-section-heading">
            <h2>Your Connected Accounts</h2>
            <span>{accounts.length} total</span>
          </div>

          <div className="connected-account-list">
            {accounts.map((account) => (
              <ConnectedAccountCard
                key={account.id}
                account={account}
                platform={platformMap.get(account.platform)}
                onViewHealth={(nextAccount) => setHealthAccountId(nextAccount.id)}
                onReconnect={handleReconnect}
                onEdit={(nextAccount) => setEditingAccount(nextAccount)}
                onRemove={handleRemove}
              />
            ))}
          </div>
        </section>
      ) : null}

      {!loading ? (
        <section className="connected-account-section">
          <div className="connected-account-section-heading">
            <h2>Add an Account</h2>
            <span>Live OAuth is used when configured; otherwise demo mode is available.</span>
          </div>
          <PlatformGrid
            platforms={platforms}
            connectedAccounts={accounts}
            onConnect={(platform) => {
              setEditingAccount(null);
              setSelectedPlatform(platform);
            }}
          />
        </section>
      ) : null}

      <MockOAuthScreen
        open={Boolean(selectedPlatform) || Boolean(editingAccount)}
        platform={selectedPlatform || platformMap.get(editingAccount?.platform)}
        account={editingAccount}
        mode={editingAccount ? 'edit' : 'connect'}
        userId={user?.id}
        onError={(message) => onToast?.(message, 'error')}
        onClose={() => {
          setSelectedPlatform(null);
          setEditingAccount(null);
        }}
        onSaved={async () => {
          await loadData();
          onToast?.(
            editingAccount
              ? 'Connected account updated.'
              : `${selectedPlatform?.display_name || 'Platform'} connected successfully.`,
            'success',
          );
        }}
      />

      <AccountHealthModal
        open={Boolean(healthAccountId)}
        accountId={healthAccountId}
        onClose={() => setHealthAccountId(null)}
      />
    </section>
  );
}
