"use client";

import React from 'react';
import AppRedirect from '@/next/AppRedirect';
import { useAuth } from '../../Context/AuthContext';
import { useAppNavigation } from '../../Context/AppNavigationContext';
import AuthLoadingOverlay from '../../components/Shared/AuthLoadingOverlay';
import { updateLastUsedContext } from '../../org/services/orgService';
import ContextCard from '../../org/components/ContextCard';
import { getOrganizationHomePath } from '../../org/utils/orgHomePath';
export default function ContextSelectorPage() {
  const { navigate } = useAppNavigation();
  const {
    user,
    profile,
    isAdmin,
    loading,
    accessLoading,
    orgMemberships = [],
    lastUsedContext,
  } = useAuth();

  if (loading || accessLoading) {
    return (
      <AuthLoadingOverlay
        title="Preparing your contexts"
        description="Loading your personal and organization workspaces."
      />
    );
  }

  if (!user) {
    return <AppRedirect to="/login" replace />;
  }

  if (isAdmin) {
    return <AppRedirect to="/app/admin" replace />;
  }

  if (!orgMemberships.length) {
    return <AppRedirect to="/app/dashboard" replace />;
  }

  const lastOrgId = lastUsedContext?.last_organization_id || null;
  const personalPrimary = lastUsedContext?.last_context_type === 'personal';

  const handleSelectPersonal = async () => {
    await updateLastUsedContext({
      userId: user.id,
      contextType: 'personal',
    });
    navigate('/app/dashboard');
  };

  const handleSelectOrganization = async (membership) => {
    await updateLastUsedContext({
      userId: user.id,
      contextType: 'organization',
      organizationId: membership.organizationId,
      brandProjectId: membership.defaultBrandProjectId || null,
    });
    navigate(getOrganizationHomePath(membership.organizationId, membership.role));
  };

  return (
    <main className="context-selector-page">
      <div className="context-selector-shell">
        <div className="context-selector-brand">SocialAI</div>
        <h1>Where are you working today?</h1>
        <p>Choose a workspace to continue.</p>

        <div className="context-selector-grid">
          <ContextCard
            title="Personal Workspace"
            subtitle={profile?.email || 'Individual workspace'}
            badge="Individual"
            description="Your personal generate, calendar, and library space."
            primary={personalPrimary}
            imageUrl={profile?.avatar_url || null}
            onClick={handleSelectPersonal}
          />

          {orgMemberships.map((membership) => (
            <ContextCard
              key={membership.organizationId}
              title={membership.organization?.name || 'Organization'}
              subtitle={(membership.role || 'member').replace(/_/g, ' ')}
              badge={(membership.role || 'member').replace(/_/g, ' ')}
              description="Shared workspace"
              primary={lastOrgId === membership.organizationId}
              imageUrl={membership.organization?.logoUrl || null}
              color={membership.organization?.brandColor || 'var(--color-primary)'}
              onClick={() => handleSelectOrganization(membership)}
            />
          ))}
        </div>
      </div>
    </main>
  );
}
