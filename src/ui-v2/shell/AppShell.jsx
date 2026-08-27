"use client";

/**
 * AppShell — the one definition of the application chrome.
 *
 * LOCK L5.6.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Before this, every migrated page hand-wrote the same shell: ten copies of
 * the `<AppHeader>` block with its credit pill, notification bell and avatar
 * menu, and ten separate definitions of an identical `ThemeToggleButton`.
 *
 * That is the same defect L5.7 had just fixed one level down, where nine copies
 * of `NAV_ITEMS` had drifted so that five pages showed Analytics and four did
 * not. Duplicated chrome drifts exactly the same way. It already had: Calendar
 * rendered nothing where every other page rendered a loading skeleton, and
 * Billing hardcoded the credit meter to `pct="100%"` regardless of the actual
 * balance — a full bar over an empty account.
 *
 * ── Contract ────────────────────────────────────────────────────────────────
 * Pages supply only what is genuinely page-specific: which nav entry is active,
 * any page-specific header controls, and their content. Everything else —
 * theme, credits, notifications, avatar, mobile drawer, skip link — is
 * resolved here, once.
 *
 * Slots, in render order across the header's right side:
 *
 *   rightLead     status indicators that read as part of the page, not the
 *                 chrome (Studio's "Video rendering…" ticker)
 *   [credit pill] always, from the shared store
 *   rightActions  page-specific icon buttons (Studio's video-jobs drawer,
 *                 Dashboard's settings shortcut)
 *   [theme] [notifications] [avatar]   always, in this order, on every screen
 *
 * `leftExtra` forwards to AppHeader's left slot (Dashboard's search box).
 * `overlays` renders after </main>, inside the theme provider — for the
 * toasters, modals and bottom sheets that must not be nested in the page's
 * main landmark (Studio's schedule dialog, Library's filter sheet).
 * `minimal` renders the bare header — no nav, no controls — for the loading
 * and signed-out states that must not offer navigation they cannot service.
 */

import { useState } from "react";
import { useAuth } from "../../Context/AuthContext";
import { useAppNavigation } from "../../Context/AppNavigationContext";
import { useCreditBalance } from "../../hooks/useCreditBalance";
import { useActiveJobCount } from "../../hooks/video-engine/useActiveJobCount";
import { UiV2ThemeProvider } from "../ThemeProvider";
import { UiV2ToastProvider } from "../primitives/Toast";
import { Skeleton } from "../primitives/Skeleton";
import { AppHeader, CreditPill } from "./AppHeader";
import { MobileNavDrawer } from "./MobileNavDrawer";
import { NotificationBell } from "./NotificationBell";
import { AvatarMenu } from "./AvatarMenu";
import { ThemeToggleButton } from "./ThemeToggleButton";
import { NAV_ITEMS } from "./navItems";
import styles from "./AppShell.module.css";

/**
 * Percentage of the lifetime purchase still unspent. With nothing ever
 * purchased there is nothing to be a percentage OF, so show 100 rather than
 * dividing by zero and rendering NaN.
 */
export function creditMeterPct({ balance, lifetimePurchased }) {
  if (!(lifetimePurchased > 0)) return 100;
  return Math.max(0, Math.min(100, Math.round((balance / lifetimePurchased) * 100)));
}

function AppShellInner({
  activeKey,
  children,
  mainClassName = "",
  leftExtra = null,
  rightLead = null,
  rightActions = null,
  overlays = null,
  minimal = false,
}) {
  const { navigate } = useAppNavigation();
  const { user, profile } = useAuth();
  const credits = useCreditBalance(user?.id ?? null);
  // Clipping runs for minutes and is meant to be left alone. Without this the
  // product went silent about an unattended job the moment you navigated away.
  const activeVideoJobs = useActiveJobCount(user?.id ?? null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const initials = (
    (profile?.full_name ? profile.full_name[0] : "U") +
    (profile?.full_name?.split(" ")[1]?.[0] ?? "")
  ).toUpperCase();

  if (minimal) {
    return (
      <>
        <AppHeader navItems={[]} right={null} />
        <main className={mainClassName} id="main-content">
          {children}
        </main>
      </>
    );
  }

  return (
    <>
      <a href="#main-content" className={styles.skipLink}>Skip to content</a>

      <AppHeader
        navItems={NAV_ITEMS}
        navBadges={activeVideoJobs > 0 ? { video: activeVideoJobs } : null}
        activeKey={activeKey}
        onNavClick={(item) => navigate(item.href)}
        onBurgerClick={() => setMobileNavOpen(true)}
        leftExtra={leftExtra}
        right={(
          <>
            {rightLead}
            {credits.ready ? (
              <CreditPill pct={`${creditMeterPct(credits)}%`} label={`${credits.balance.toLocaleString()} cr`} />
            ) : (
              // A skeleton rather than "0 cr" — showing a real-looking zero
              // while the balance is still loading is the same class of lie as
              // the account badges fixed under L2.1.
              <Skeleton width="76px" height="26px" radius="999px" />
            )}
            {rightActions}
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

      {overlays}
    </>
  );
}

export function AppShell({
  activeKey,
  children,
  className = "",
  mainClassName = "",
  leftExtra = null,
  rightLead = null,
  rightActions = null,
  overlays = null,
  minimal = false,
}) {
  return (
    // The toast provider lives here, under the theme provider, for the same
    // reason the header and the nav do: it is chrome. Toast.jsx existed and was
    // mounted by nobody, so every screen that wanted an undo affordance had to
    // grow its own — which is how nine copies of NAV_ITEMS happened. Mounting it
    // once means `useUiV2Toast` works in any component rendered INSIDE AppShell.
    // Note the consequence: a page component that renders <AppShell> is above
    // this provider and cannot call the hook itself; its body must be a child.
    <UiV2ThemeProvider className={className}>
      <UiV2ToastProvider>
      <AppShellInner
        activeKey={activeKey}
        mainClassName={mainClassName}
        leftExtra={leftExtra}
        rightLead={rightLead}
        rightActions={rightActions}
        overlays={overlays}
        minimal={minimal}
      >
        {children}
      </AppShellInner>
      </UiV2ToastProvider>
    </UiV2ThemeProvider>
  );
}
