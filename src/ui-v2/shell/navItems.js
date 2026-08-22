/**
 * navItems.js — the single definition of the primary navigation.
 *
 * LOCK L5.7.
 *
 * ── The defect this replaces ────────────────────────────────────────────────
 * Nine pages each declared their own `const NAV_ITEMS` array, and they had
 * drifted. Measured 2026-08-22:
 *
 *   6 items (with Analytics) — AnalyticsPage, BillingPage, HelpPage, Settings
 *   5 items (no Analytics)   — Dashboard, Studio, Library, Calendar, BrandKit
 *
 * So whether Analytics appeared in the nav depended on which page the user was
 * standing on. Nobody chose that; it is what nine copies of the same array do
 * over time.
 *
 * None of the nine listed the video surface at all, so /app/video/jobs was
 * reachable only by typing the URL (audit finding P9-002).
 *
 * ── Rule ────────────────────────────────────────────────────────────────────
 * Import NAV_ITEMS from here. Never redeclare it in a page. If a route should
 * be reachable, it belongs in this array; if it should not, it should not be
 * a route.
 */

export const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", href: "/app/dashboard" },
  { key: "studio",    label: "Studio",    href: "/app/generate" },
  { key: "library",   label: "Library",   href: "/app/library" },
  { key: "calendar",  label: "Calendar",  href: "/app/calendar" },
  // The video surface is the CLIPPING pipeline (submit a URL or upload, get
  // vertical clips) — not the generative video path. It was reachable only by
  // typing the URL despite being the product's strongest capability.
  { key: "video",     label: "Videos",    href: "/app/video/jobs" },
  { key: "analytics", label: "Analytics", href: "/app/analytics" },
  { key: "brand-kit", label: "Brand Kit", href: "/app/settings/brand-kit" },
];

/**
 * Resolve the active nav key from a pathname, so a page does not have to
 * hardcode which entry is current. Longest-prefix match, so /app/settings/
 * brand-kit selects brand-kit rather than a shorter accidental match.
 */
export function activeNavKey(pathname) {
  const path = String(pathname || "");
  let best = null;
  for (const item of NAV_ITEMS) {
    if (path === item.href || path.startsWith(`${item.href}/`)) {
      if (!best || item.href.length > best.href.length) best = item;
    }
  }
  return best?.key ?? null;
}
