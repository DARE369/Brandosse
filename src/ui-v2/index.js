// Barrel export for the v2 design system. Import from "@/ui-v2" in migrated
// screens rather than deep-importing individual files, so the public surface
// stays deliberate.

export { UiV2ThemeProvider, useUiV2Theme } from "./ThemeProvider";

export { Button } from "./primitives/Button";
export { IconButton } from "./primitives/IconButton";
export { Card } from "./primitives/Card";
export { Badge } from "./primitives/Badge";
export { Skeleton } from "./primitives/Skeleton";
export { EmptyState } from "./primitives/EmptyState";
export { StatCard } from "./primitives/StatCard";
export { Modal } from "./primitives/Modal";
export { Drawer } from "./primitives/Drawer";
export { Dropdown } from "./primitives/Dropdown";
export { UiV2ToastProvider, useUiV2Toast } from "./primitives/Toast";
export { useOutsideDismiss } from "./primitives/useOutsideDismiss";

export { AppHeader, NavLink, CreditPill, Avatar } from "./shell/AppHeader";

// The product mark. Every surface that draws the logo renders THIS — app
// chrome, mobile drawer, landing page, auth pages — and the favicon set is
// generated from the same geometry by scripts/generate-brand-icons.mjs.
export { StudioMark } from "./brand/StudioMark";

// LOCK L5.7 — the single nav definition. Never redeclare NAV_ITEMS in a page.
export { NAV_ITEMS, activeNavKey } from "./shell/navItems";

// LOCK L5.6 — the single definition of the app chrome. Pages supply activeKey
// and content; they must NOT hand-write the header/drawer/theme-toggle block.
export { AppShell, creditMeterPct } from "./shell/AppShell";
export { MobileNavDrawer } from "./shell/MobileNavDrawer";
export { NotificationBell } from "./shell/NotificationBell";
export { AvatarMenu } from "./shell/AvatarMenu";
export { ThemeToggleButton } from "./shell/ThemeToggleButton";
