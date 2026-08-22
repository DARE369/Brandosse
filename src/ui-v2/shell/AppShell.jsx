"use client";

/**
 * AppShell — the one definition of the application chrome.
 *
 * LOCK L5.6.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Before this, every migrated page hand-wrote the same shell: nine copies of
 * the `<AppHeader>` block with its credit pill, notification bell and avatar
 * menu, and TEN separate definitions of an identical `ThemeToggleButton`.
 *
 * That is the same defect L5.7 had just fixed one level down, where nine copies
 * of `NAV_ITEMS` had drifted so that five pages showed Analytics and four did
 * not. Duplicated chrome drifts exactly the same way — it simply had not been
 * measured yet. Migrating the four remaining legacy pages by copying the block
 * a tenth time would have made the problem worse while appearing to fix it.
 *
 * ── Contract ────────────────────────────────────────────────────────────────
 * Pages supply only what is genuinely page-specific: which nav entry is active,
 * and their content. Everything else — theme, credits, notifications, avatar,
 * mobile drawer — is resolved here, once.
 */

import { useState } from "react";
import { useAuth } from "../../Context/AuthContext";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import { useCreditBalance } from "../../hooks/useCreditBalance";
import { UiV2ThemeProvider, useUiV2Theme } from "../ThemeProvider";
import { IconButton } from "../primitives/IconButton";
import { Skeleton } from "../primitives/Skeleton";
import { AppHeader, CreditPill } from "./AppHeader";
import { MobileNavDrawer } from "./MobileNavDrawer";
import { NotificationBell } from "./NotificationBell";
import { AvatarMenu } from "./AvatarMenu";
import { NAV_ITEMS } from "./navItems";

/** Was defined identically in ten separate page files. */
function ThemeToggleButton() {
  const { isDark, toggleTheme } = useUiV2Theme();
  return (
    <IconButton title={isDark ? "Switch to light mode" : "Switch to dark mode"} onClick={toggleTheme}>
      {isDark ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" strokeLinecap="round" />
          <circle cx="12" cy="12" r="4.5" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20 14.5A8.5 8.5 0 119.5 4a7 7 0 0010.5 10.5z" />
        </svg>
      )}
    </IconButton>
  );
}

function AppShellInner({ activeKey, children, mainClassName = "", rightExtra = null }) {
  const { navigate } = useAppNavigation();
  const { user, profile } = useAuth();
  const credits = useCreditBalance(user?.id ?? null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const initials = (
    (profile?.full_name ? profile.full_name[0] : "U") +
    (profile?.full_name?.split(" ")[1]?.[0] ?? "")
  ).toUpperCase();

  // Percentage of the lifetime purchase still unspent. With nothing ever
  // purchased there is nothing to be a percentage OF, so show 100 rather than
  // dividing by zero and rendering NaN.
  const creditPct = credits.lifetimePurchased > 0
    ? Math.max(0, Math.min(100, Math.round((credits.balance / credits.lifetimePurchased) * 100)))
    : 100;

  return (
    <>
      <AppHeader
        navItems={NAV_ITEMS}
        activeKey={activeKey}
        onNavClick={(item) => navigate(item.href)}
        onBurgerClick={() => setMobileNavOpen(true)}
        right={(
          <>
            {rightExtra}
            {credits.ready ? (
              <CreditPill pct={`${creditPct}%`} label={`${credits.balance.toLocaleString()} cr`} />
            ) : (
              // A skeleton rather than "0 cr" — showing a real-looking zero
              // while the balance is still loading is the same class of lie as
              // the account badges fixed under L2.1.
              <Skeleton width="76px" height="26px" radius="999px" />
            )}
            <ThemeToggleButton />
            <NotificationBell userId={user?.id} onNavigate={navigate} />
            <AvatarMenu
              initials={initials || "U"}
              name={profile?.full_name}
              email={user?.email}
              onNavigate={navigate}
            />
          </>
        )}
      />

      <MobileNavDrawer
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        navItems={NAV_ITEMS}
        activeKey={activeKey}
        onNavClick={(item) => navigate(item.href)}
      />

      <main className={mainClassName} id="main-content">
        {children}
      </main>
    </>
  );
}

export function AppShell({ activeKey, children, className = "", mainClassName = "", rightExtra = null }) {
  return (
    <UiV2ThemeProvider className={className}>
      <AppShellInner activeKey={activeKey} mainClassName={mainClassName} rightExtra={rightExtra}>
        {children}
      </AppShellInner>
    </UiV2ThemeProvider>
  );
}
