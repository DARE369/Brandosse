import React, { useEffect, useMemo, useState } from 'react';
import { Building2, LockKeyhole, ShieldCheck } from 'lucide-react';
import PlatformIcon from '../../components/Shared/PlatformIcon';
import { useAuth } from '../../Context/AuthContext';
import { getAccountsForUser } from '../../services/platforms/connectionService';
import {
  fetchOrganizationMembers,
  isOrgAdminRole,
  resolveOrgPermissions,
} from '../../org/services/orgService';
import { Card, Badge, EmptyState } from '../../ui-v2';
import styles from './OrgAccountsReadOnlyTab.module.css';

function getMemberDisplayName(member) {
  return member?.profile?.full_name || member?.profile?.email || 'Organization admin';
}

function canMemberUseAccount(account, membership, userId) {
  if (!account || !membership || !userId) return false;
  if (isOrgAdminRole(membership.role)) return true;

  const permissions = resolveOrgPermissions({
    role: membership.role,
    overrides: membership.permissions,
  });

  if (!permissions.can_publish) return false;

  const grantedMemberIds = Array.isArray(account.granted_member_ids)
    ? account.granted_member_ids.filter(Boolean)
    : [];

  if (grantedMemberIds.length === 0) return true;
  return grantedMemberIds.includes(userId);
}

export default function OrgAccountsReadOnlyTab({ onToast }) {
  const { user, orgMemberships = [] } = useAuth();
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [managerByOrg, setManagerByOrg] = useState(new Map());

  useEffect(() => {
    let active = true;

    async function load() {
      if (!user?.id || orgMemberships.length === 0) {
        if (active) {
          setAccounts([]);
          setManagerByOrg(new Map());
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      try {
        const accountRows = await getAccountsForUser(user.id, 'organization');
        const organizationIds = [...new Set(orgMemberships.map((membership) => membership.organizationId).filter(Boolean))];
        const memberSets = await Promise.all(
          organizationIds.map(async (organizationId) => ({
            organizationId,
            members: await fetchOrganizationMembers(organizationId),
          })),
        );

        if (!active) return;

        const nextManagerByOrg = new Map();
        memberSets.forEach(({ organizationId, members }) => {
          const manager = members.find((member) => isOrgAdminRole(member.role)) || members[0] || null;
          nextManagerByOrg.set(organizationId, getMemberDisplayName(manager));
        });

        setAccounts(accountRows);
        setManagerByOrg(nextManagerByOrg);
      } catch (error) {
        console.error('Failed to load organization accounts:', error);
        if (active) {
          setAccounts([]);
          setManagerByOrg(new Map());
          onToast?.(error?.message || 'Could not load organization accounts.', 'error');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [onToast, orgMemberships, user?.id]);

  const groups = useMemo(() => {
    const membershipMap = new Map(orgMemberships.map((membership) => [membership.organizationId, membership]));
    const grouped = orgMemberships
      .map((membership) => ({
        organizationId: membership.organizationId,
        membership,
        accounts: accounts.filter((account) => account.organization_id === membership.organizationId),
      }))
      .filter((group) => group.accounts.length > 0);

    accounts.forEach((account) => {
      if (!account.organization_id || membershipMap.has(account.organization_id)) return;
      grouped.push({
        organizationId: account.organization_id,
        membership: null,
        accounts: [account],
      });
    });

    return grouped;
  }, [accounts, orgMemberships]);

  return (
    <div className={styles.wrap}>
      <div className={styles.headRow}>
        <div>
          <div className={styles.title}>Organization Accounts</div>
          <div className={styles.sub}>These shared destinations are managed by each organization admin. Access changes happen inside the org workspace.</div>
        </div>
        <Badge tone="accent">{accounts.length} shared</Badge>
      </div>

      <Card>
        <div className={styles.banner}>
          <Building2 size={16} aria-hidden="true" />
          <div>
            <strong>Shared social accounts</strong>
            <p>Organization accounts are read-only here. Contact your org admin if you need access updates.</p>
          </div>
        </div>
      </Card>

      {loading ? (
        <Card><div className={styles.loading}>Loading organization accounts…</div></Card>
      ) : groups.length === 0 ? (
        <Card><EmptyState dashed title="No shared accounts" description="No organization accounts are shared with your memberships yet." /></Card>
      ) : (
        groups.map((group) => {
          const membership = group.membership;
          const orgName = membership?.organization?.name || 'Organization';
          const managedBy = managerByOrg.get(group.organizationId) || 'Organization admin';

          return (
            <Card key={group.organizationId}>
              <div className={styles.groupHead}>
                <div>
                  <div className={styles.groupTitle}>{orgName}</div>
                  <div className={styles.sub}>Managed by {managedBy}</div>
                </div>
                <span className={styles.groupCount}>{group.accounts.length} shared account{group.accounts.length === 1 ? '' : 's'}</span>
              </div>

              <div className={styles.list}>
                {group.accounts.map((account) => {
                  const hasPostingAccess = canMemberUseAccount(account, membership, user?.id);
                  return (
                    <div key={account.id} className={styles.row}>
                      <span className={styles.iconWrap}><PlatformIcon platform={account.platform} size="sm" /></span>
                      <div className={styles.main}>
                        <div className={styles.titleRow}>
                          <strong>{account.display_name || account.account_name || account.username || account.platform}</strong>
                          {account.username ? <span className={styles.handle}>@{account.username}</span> : null}
                        </div>
                        <div className={styles.metaRow}>
                          <span>{account.platform_display_name || account.platform}</span>
                          <span>{account.profile_type || 'Business'}</span>
                          <span>Managed by {managedBy}</span>
                        </div>
                      </div>
                      <div className={styles.badges}>
                        <Badge tone="accent"><LockKeyhole size={12} aria-hidden="true" /> Organization Account</Badge>
                        {hasPostingAccess ? <Badge tone="success"><ShieldCheck size={12} aria-hidden="true" /> Posting Access Granted</Badge> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
