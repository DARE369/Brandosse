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
import { Card, Badge, Button, Modal, EmptyState } from '../../ui-v2';
import styles from './ConnectedAccountsTab.module.css';

export default function ConnectedAccountsTab({ onToast }) {
  const { navigate } = useAppNavigation();
  const { user, orgMemberships } = useAuth();
  const [loading, setLoading] = useState(true);
  const [platforms, setPlatforms] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [editingAccount, setEditingAccount] = useState(null);
  const [healthAccountId, setHealthAccountId] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [removing, setRemoving] = useState(false);

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

  const confirmRemove = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await disconnectAccount(removeTarget.id, user?.id);
      onToast?.(`${removeTarget.display_name || removeTarget.account_name} disconnected.`, 'success');
      setRemoveTarget(null);
      await loadData();
    } catch (error) {
      onToast?.(error?.message || 'Could not disconnect this account.', 'error');
    } finally {
      setRemoving(false);
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
    <div className={styles.wrap}>
      <div className={styles.headRow}>
        <div>
          <div className={styles.title}>Connected Accounts</div>
          <div className={styles.sub}>Connect social accounts for scheduling, publishing, and multi-user workflows.</div>
        </div>
        <Badge tone="accent">{activeAccountCount} connected</Badge>
      </div>

      {Array.isArray(orgMemberships) && orgMemberships.length > 0 ? (
        orgMemberships.map((membership) => (
          <Card key={membership.id}>
            <div className={styles.orgBanner}>
              <Link2 size={16} aria-hidden="true" />
              <div className={styles.orgBannerCopy}>
                <strong>{membership.organization?.name || 'Organization workspace'}</strong>
                <p>Organization accounts are managed inside the org workspace settings.</p>
              </div>
              <Button variant="subtle" size="sm" onClick={() => navigate(getOrgNavigationTarget(membership))}>
                {membership?.role === 'org_owner' || membership?.role === 'org_admin' ? 'View Org Accounts' : 'Open Workspace'}
              </Button>
            </div>
          </Card>
        ))
      ) : null}

      {loading ? <Card><div className={styles.loading}>Loading connected accounts…</div></Card> : null}

      {!loading && accounts.length > 0 ? (
        <Card>
          <div className={styles.sectionHead}>
            <span className={styles.sectionTitle}>Your Connected Accounts</span>
            <span className={styles.sectionCount}>{accounts.length} total</span>
          </div>
          <div className={styles.list}>
            {accounts.map((account) => (
              <ConnectedAccountCard
                key={account.id}
                account={account}
                platform={platformMap.get(account.platform)}
                onViewHealth={(nextAccount) => setHealthAccountId(nextAccount.id)}
                onReconnect={handleReconnect}
                onEdit={(nextAccount) => setEditingAccount(nextAccount)}
                onRemove={(nextAccount) => setRemoveTarget(nextAccount)}
              />
            ))}
          </div>
        </Card>
      ) : !loading ? (
        <Card><EmptyState dashed title="No accounts connected yet" description="Connect a platform below to start scheduling and publishing." /></Card>
      ) : null}

      {!loading ? (
        <Card>
          <div className={styles.sectionHead}>
            <span className={styles.sectionTitle}>Add an Account</span>
            <span className={styles.sectionHint}>Live OAuth is used when configured; otherwise demo mode is available.</span>
          </div>
          <PlatformGrid
            platforms={platforms}
            connectedAccounts={accounts}
            onConnect={(platform) => navigate(`/app/settings/connect?platform=${encodeURIComponent(platform.platform_key)}`)}
          />
        </Card>
      ) : null}

      {/* New connections go through the dedicated /app/settings/connect flow
          (see ConnectAccountFlow.jsx) — this modal now only handles editing
          an already-connected account's details. */}
      <MockOAuthScreen
        open={Boolean(editingAccount)}
        platform={platformMap.get(editingAccount?.platform)}
        account={editingAccount}
        mode="edit"
        userId={user?.id}
        onError={(message) => onToast?.(message, 'error')}
        onClose={() => setEditingAccount(null)}
        onSaved={async () => {
          await loadData();
          onToast?.('Connected account updated.', 'success');
        }}
      />

      <AccountHealthModal
        open={Boolean(healthAccountId)}
        accountId={healthAccountId}
        onClose={() => setHealthAccountId(null)}
      />

      <Modal
        open={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(null)}
        title="Disconnect this account?"
        description={removeTarget ? `${removeTarget.display_name || removeTarget.account_name || removeTarget.platform} will stop scheduling and publishing through Brandosse. You can reconnect it later.` : ''}
        actions={(
          <>
            <Button variant="ghost" onClick={() => setRemoveTarget(null)} disabled={removing}>Cancel</Button>
            <Button variant="dangerSolid" onClick={confirmRemove} disabled={removing}>{removing ? 'Disconnecting…' : 'Disconnect'}</Button>
          </>
        )}
      />
    </div>
  );
}
