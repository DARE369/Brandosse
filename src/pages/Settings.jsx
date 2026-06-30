"use client";

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '../Context/AuthContext';
import UserNavbar from '../components/User/UserNavbar';
import UserSidebar from '../components/User/UserSidebar';
import ConnectedAccountsTab from './Settings/ConnectedAccountsTab';
import OrgAccountsReadOnlyTab from './Settings/OrgAccountsReadOnlyTab';
import PersonalSettingsFoundationTab from './Settings/PersonalSettingsFoundationTab';
import { UiEmptyState, UiIconButton, UiPageHeader, UiTabs } from '../components/Shared/ui';
export default function Settings() {
  const { user, orgMemberships = [] } = useAuth();
  const [toast, setToast] = useState(null);
  const [activeTab, setActiveTab] = useState('profile');

  useEffect(() => {
    if (orgMemberships.length === 0 && activeTab === 'organization') {
      setActiveTab('profile');
    }
  }, [activeTab, orgMemberships.length]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const showToast = (message, type = 'info') => {
    setToast({ message, type });
  };

  const tabOptions = [
    { id: 'profile', label: 'Profile' },
    { id: 'preferences', label: 'Preferences' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'connected', label: 'Connected Accounts' },
    ...(user && orgMemberships.length > 0
      ? [{ id: 'organization', label: 'Organization Accounts' }]
      : []),
  ];

  return (
    <div className="dashboard-shell">
      <UserNavbar />
      <UserSidebar />

      <main className="settings-shell">
        <div className="settings-container">
          <UiPageHeader
            className="settings-page-header"
            eyebrow="Personal workspace"
            title="Settings"
            description="Manage your profile, preferences, notifications, and connected publishing accounts."
          />

          {user ? (
            <UiTabs
              className="settings-tab-bar settings-tab-bar-extended"
              tabs={tabOptions.map((tab) => ({ value: tab.id, label: tab.label }))}
              value={activeTab}
              onChange={setActiveTab}
              ariaLabel="Settings sections"
            />
          ) : null}

          {toast ? (
            <div className={`toast toast-${toast.type}`}>
              {toast.message}
              <UiIconButton
                onClick={() => setToast(null)}
                type="button"
                ariaLabel="Dismiss notification"
                size="sm"
                variant="ghost"
              >
                <X size={15} aria-hidden="true" />
              </UiIconButton>
            </div>
          ) : null}

          {user ? (
            <>
              {(activeTab === 'profile' || activeTab === 'preferences' || activeTab === 'notifications') ? (
                <PersonalSettingsFoundationTab section={activeTab} onToast={showToast} />
              ) : null}

              {activeTab === 'connected' ? (
                <ConnectedAccountsTab onToast={showToast} />
              ) : null}

              {activeTab === 'organization' ? (
                <OrgAccountsReadOnlyTab onToast={showToast} />
              ) : null}
            </>
          ) : (
            <section className="connected-accounts-tab">
              <UiEmptyState
                className="connected-accounts-empty"
                title="Sign in required"
                description="Sign in to manage your connected accounts."
              />
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
