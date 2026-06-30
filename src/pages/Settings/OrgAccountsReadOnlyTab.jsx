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
    <section className="connected-accounts-tab org-accounts-readonly">
      <header className="connected-accounts-header">
        <div>
          <h1>Organization Accounts</h1>
          <p>These shared destinations are managed by each organization admin. Access changes happen inside the org workspace.</p>
        </div>
        <span className="connected-accounts-badge">{accounts.length} shared</span>
      </header>

      <article className="org-accounts-readonly-banner">
        <Building2 size={16} />
        <div>
          <strong>Shared social accounts</strong>
          <p>Organization accounts are read-only here. Contact your org admin if you need access updates.</p>
        </div>
      </article>

      {loading ? (
        <div className="connected-accounts-empty">Loading organization accounts...</div>
      ) : groups.length === 0 ? (
        <div className="connected-accounts-empty">No organization accounts are shared with your memberships yet.</div>
      ) : (
        <div className="org-accounts-readonly-groups">
          {groups.map((group) => {
            const membership = group.membership;
            const orgName = membership?.organization?.name || 'Organization';
            const managedBy = managerByOrg.get(group.organizationId) || 'Organization admin';

            return (
              <section key={group.organizationId} className="org-accounts-readonly-group">
                <div className="org-accounts-readonly-group-heading">
                  <div>
                    <h2>{orgName}</h2>
                    <p>Managed by {managedBy}</p>
                  </div>
                  <span>{group.accounts.length} shared account{group.accounts.length === 1 ? '' : 's'}</span>
                </div>

                <div className="org-accounts-readonly-list">
                  {group.accounts.map((account) => {
                    const hasPostingAccess = canMemberUseAccount(account, membership, user?.id);
                    return (
                      <article key={account.id} className="org-accounts-readonly-card">
                        <div className="org-accounts-readonly-card-main">
                          <span className="org-accounts-readonly-card-platform">
                            <PlatformIcon platform={account.platform} size="sm" />
                          </span>
                          <div>
                            <div className="org-accounts-readonly-card-title">
                              <strong>{account.display_name || account.account_name || account.username || account.platform}</strong>
                              {account.username ? <span>@{account.username}</span> : null}
                            </div>
                            <div className="org-accounts-readonly-card-subtitle">
                              <span>{account.platform_display_name || account.platform}</span>
                              <span>{account.profile_type || 'Business'}</span>
                              <span>Managed by {managedBy}</span>
                            </div>
                          </div>
                        </div>

                        <div className="org-accounts-readonly-card-badges">
                          <span className="org-accounts-pill shared">
                            <LockKeyhole size={12} />
                            Organization Account
                          </span>
                          {hasPostingAccess ? (
                            <span className="org-accounts-pill granted">
                              <ShieldCheck size={12} />
                              Posting Access Granted
                            </span>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
