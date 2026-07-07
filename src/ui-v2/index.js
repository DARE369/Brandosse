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
export { MobileNavDrawer } from "./shell/MobileNavDrawer";
