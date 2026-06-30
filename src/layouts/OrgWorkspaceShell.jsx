import React, { useEffect, useState } from 'react';
import toast, { Toaster } from 'react-hot-toast';
import { useAppNavigation } from '../Context/AppNavigationContext';
import OrgTopNavbar from '../org/components/OrgTopNavbar';
import OrgSidebar from '../org/components/OrgSidebar';
export default function OrgWorkspaceShell({ children }) {
  const { location } = useAppNavigation();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    if (location.state?.orgAdminDenied) {
      toast.error('You do not have access to that admin screen.');
      window.history.replaceState({}, '', location.pathname);
    }

    if (location.state?.orgAccessDenied) {
      toast.error('You no longer have access to that organization.');
      window.history.replaceState({}, '', location.pathname);
    }
  }, [location.pathname, location.state]);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileSidebarOpen) return undefined;

    function handleEscape(event) {
      if (event.key === 'Escape') {
        setMobileSidebarOpen(false);
      }
    }

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [mobileSidebarOpen]);

  return (
    <div className={`org-shell ${mobileSidebarOpen ? 'mobile-nav-open' : ''}`.trim()}>
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 5000,
          className: 'org-toast',
        }}
      />
      <OrgTopNavbar
        mobileNavOpen={mobileSidebarOpen}
        onMobileNavToggle={() => setMobileSidebarOpen((open) => !open)}
      />
      <div className="org-body">
        {mobileSidebarOpen ? (
          <button
            type="button"
            className="org-mobile-sidebar-backdrop"
            aria-label="Close organization navigation"
            onClick={() => setMobileSidebarOpen(false)}
          />
        ) : null}
        <OrgSidebar
          mobileOpen={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
          onNavigate={() => setMobileSidebarOpen(false)}
        />
        <main className="org-content">
          {children}
        </main>
      </div>
    </div>
  );
}
