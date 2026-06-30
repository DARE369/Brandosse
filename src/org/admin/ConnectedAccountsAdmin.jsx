import React, { useEffect, useMemo, useState } from 'react';
import { Plus, WifiOff } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import { getAllPlatforms } from '../../services/platforms/platformRegistry';
import {
  disconnectAccount,
  getAccountsForOrganization,
  triggerReconnect,
} from '../../services/platforms/connectionService';
import MockOAuthScreen from '../../pages/Settings/components/MockOAuthScreen';
import AccountHealthModal from '../../pages/Settings/components/AccountHealthModal';
import OrgAccountCard from '../components/OrgAccountCard';
import GrantAccessModal from '../components/GrantAccessModal';
import {
  fetchOrganizationMembers,
  resolveOrgPermissions,
} from '../services/orgService';

function getMemberDisplayName(member) {
  return member?.profile?.full_name || member?.profile?.email || 'Team member';
}

function canMemberPublish(member) {
  const effectivePermissions = resolveOrgPermissions({
    role: member?.role,
    overrides: member?.permissions,
  });
  return Boolean(effectivePermissions.can_publish);
}

export default function ConnectedAccountsAdmin({
  organizationId,
  currentUserId,
  onToast,
}) {
  const [loading, setLoading] = useState(true);
  const [platforms, setPlatforms] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [members, setMembers] = useState([]);
  const [activityByAccount, setActivityByAccount] = useState(new Map());
  const [selectedPlatform, setSelectedPlatform] = useState(null);
  const [editingAccount, setEditingAccount] = useState(null);
  const [healthAccountId, setHealthAccountId] = useState(null);
  const [accessAccount, setAccessAccount] = useState(null);

  const platformMap = useMemo(
    () => new Map(platforms.map((platform) => [platform.platform_key, platform])),
    [platforms],
  );

  const publishEligibleMembers = useMemo(
    () => members.filter(canMemberPublish),
    [members],
  );

  const loadData = async () => {
    if (!organizationId) {
      setPlatforms([]);
      setAccounts([]);
      setMembers([]);
      setActivityByAccount(new Map());
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [platformRows, accountRows, memberRows] = await Promise.all([
        getAllPlatforms(),
        getAccountsForOrganization(organizationId),
        fetchOrganizationMembers(organizationId),
      ]);

      setPlatforms(platformRows);
      setAccounts(accountRows);
      setMembers(memberRows);

      const accountIds = accountRows.map((account) => account.id).filter(Boolean);
      if (accountIds.length === 0) {
        setActivityByAccount(new Map());
        return;
      }

      const { data: posts, error: postsError } = await supabase
        .from('posts')
        .select('account_id, user_id, published_at, status')
        .eq('organization_id', organizationId)
        .eq('status', 'published')
        .in('account_id', accountIds)
        .order('published_at', { ascending: false });

      if (postsError) throw postsError;

      const memberMap = new Map(memberRows.map((member) => [member.userId, member]));
      const nextActivityByAccount = new Map();
      for (const post of posts || []) {
        if (!post?.account_id || nextActivityByAccount.has(post.account_id)) continue;
        nextActivityByAccount.set(post.account_id, {
          lastPublishedAt: post.published_at || null,
          lastPublishedBy: getMemberDisplayName(memberMap.get(post.user_id)),
        });
      }

      setActivityByAccount(nextActivityByAccount);
    } catch (error) {
      console.error('Failed to load org connected accounts:', error);
      onToast?.(error?.message || 'Could not load organization accounts.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [organizationId]);

  const handleReconnect = async (account) => {
    try {
      await triggerReconnect(account.id, currentUserId);
      onToast?.(`${account.display_name || account.account_name} reconnected.`, 'success');
      await loadData();
    } catch (error) {
      onToast?.(error?.message || 'Could not reconnect this shared account.', 'error');
    }
  };

  const handleRemove = async (account) => {
    const confirmed = window.confirm(
      `Disconnect ${account.display_name || account.account_name || account.platform}?`,
    );
    if (!confirmed) return;

    try {
      await disconnectAccount(account.id, currentUserId);
      onToast?.(`${account.display_name || account.account_name} disconnected.`, 'success');
      await loadData();
    } catch (error) {
      onToast?.(error?.message || 'Could not disconnect this shared account.', 'error');
    }
  };

  return (
    <section className="org-connected-accounts-panel">
      <div className="org-connected-accounts-header">
        <div>
          <span className="org-section-kicker">Connected Accounts</span>
          <h2>Shared social destinations</h2>
          <p>Connect org-scoped mock accounts, manage posting access, and monitor shared publishing health.</p>
        </div>

        <button
          type="button"
          className="org-primary-button"
          onClick={() => {
            setEditingAccount(null);
            setSelectedPlatform(platforms[0] || null);
          }}
        >
          <Plus size={16} />
          Add Account
        </button>
      </div>

      <div className="org-connected-accounts-summary">
        <article className="org-note-card">
          <strong>{accounts.length}</strong>
          <p>Shared accounts</p>
        </article>
        <article className="org-note-card">
          <strong>{publishEligibleMembers.length}</strong>
          <p>Members with publish permission</p>
        </article>
        <article className="org-note-card">
          <strong>{accounts.filter((account) => Number(account.consecutive_failure_count || 0) > 0 || account.semantic_status !== 'connected').length}</strong>
          <p>Accounts needing attention</p>
        </article>
      </div>

      {loading ? (
        <div className="org-empty-inline">Loading shared connected accounts...</div>
      ) : accounts.length === 0 ? (
        <div className="org-connected-accounts-empty">
          <WifiOff size={18} />
          <div>
            <strong>No organization accounts connected yet</strong>
            <p>Use mock mode to add shared destinations for publishing workflows.</p>
          </div>
          <button
            type="button"
            className="org-secondary-button"
            onClick={() => setSelectedPlatform(platforms[0] || null)}
          >
            Connect First Account
          </button>
        </div>
      ) : (
        <div className="org-connected-account-list">
          {accounts.map((account) => (
            <OrgAccountCard
              key={account.id}
              account={account}
              platform={platformMap.get(account.platform)}
              activity={activityByAccount.get(account.id) || null}
              eligiblePublisherCount={publishEligibleMembers.length}
              onManageAccess={(nextAccount) => setAccessAccount(nextAccount)}
              onViewHealth={(nextAccount) => setHealthAccountId(nextAccount.id)}
              onReconnect={handleReconnect}
              onEdit={(nextAccount) => setEditingAccount(nextAccount)}
              onRemove={handleRemove}
            />
          ))}
        </div>
      )}

      <MockOAuthScreen
        open={Boolean(selectedPlatform) || Boolean(editingAccount)}
        platform={selectedPlatform || platformMap.get(editingAccount?.platform)}
        account={editingAccount}
        mode={editingAccount ? 'edit' : 'connect'}
        scope="organization"
        organizationId={organizationId}
        userId={currentUserId}
        onError={(message) => onToast?.(message, 'error')}
        onClose={() => {
          setSelectedPlatform(null);
          setEditingAccount(null);
        }}
        onSaved={async () => {
          await loadData();
          onToast?.(
            editingAccount
              ? 'Organization account updated.'
              : `${selectedPlatform?.display_name || 'Platform'} connected for this organization.`,
            'success',
          );
        }}
      />

      <AccountHealthModal
        open={Boolean(healthAccountId)}
        accountId={healthAccountId}
        onClose={() => setHealthAccountId(null)}
      />

      <GrantAccessModal
        open={Boolean(accessAccount)}
        account={accessAccount}
        members={members}
        onClose={() => setAccessAccount(null)}
        onSaved={async () => {
          await loadData();
          setAccessAccount(null);
          onToast?.('Posting access updated.', 'success');
        }}
      />
    </section>
  );
}
