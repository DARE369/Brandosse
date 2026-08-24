# src/ui-v2 — Design System v2

Fresh, isolated component library for the 2026-07-05 UI rewrite. This is the
**only** source of design tokens/components for any screen migrated under the
plan in memory `design-system-v2` (owner-approved full replacement of the old
"Midnight Aurora" system and the packet-based Calendar/Library rebuild).

## Rules (non-negotiable — the owner set these explicitly)

1. **No imports from old UI into `src/ui-v2/**`.** Never import from
   `src/components/**`, `src/styles/**`, `src/legacy/**`, `src/calendar/**`,
   `src/org/**` (or any old stylesheet/theme file) into anything under this
   directory. Business logic (services, hooks, stores, Supabase calls) is NOT
   off-limits — only old *presentation* code is. Pages under
   `src/app`/`app/app/**` that use `ui-v2` may still import old services/hooks;
   they just render with `ui-v2` components instead of old styled ones.

   The business logic `ui-v2/shell` may reach is **allowlisted by exact path**
   in `scripts/check-ui-v2-isolation.cjs` (`ALLOWED_INTERNAL`). Adding to that
   list is a review decision, not a convenience — the friction is deliberate.
   Stylesheets under `ui-v2` may not import outside `ui-v2` at all.
2. **Tokens live only in `tokens.css`.** All colors/spacing/radii/fonts consumed
   by components must go through `--uiv2-*` CSS variables. No raw hex in a
   component file except inside `tokens.css` itself.
3. **Every migrated screen must implement loading / empty / error / success**
   states before it's considered done — see the four `.dc.html` mockups for
   the spec of each state per screen.
4. **Delete the old page's UI code once a screen migrates** so it can't leak
   back in.
5. Run `node scripts/check-ui-v2-isolation.cjs` before committing changes under
   `src/ui-v2/` — it runs in CI and fails the build on rule 1. Also run
   `node scripts/check-app-shell.cjs`, which fails if a page hand-composes the
   chrome instead of using `AppShell`.

## What's here

- `tokens.css` — primitives + dark/light semantic tokens, scoped via
  `[data-uiv2-theme="dark"|"light"]` (not `:root`/`html`), so a v2 screen can
  mount inside an app shell that hasn't fully migrated yet.
- `ThemeProvider.jsx` — `<UiV2ThemeProvider>` + `useUiV2Theme()`. Isolated from
  the old `ThemeContext`; persists to its own `localStorage` key
  (`uiv2-theme`).
- `primitives/` — `Button`, `IconButton`, `Card`, `Badge`, `Skeleton`,
  `EmptyState`, `StatCard`, `Modal`, `Drawer`, `Dropdown`, `Toast`
  (`UiV2ToastProvider`/`useUiV2Toast`).
- `shell/AppShell.jsx` — **the** app chrome (LOCK L5.6). Every personal route
  renders this and nothing else: it owns the theme provider, header, nav,
  mobile drawer, credit pill, notifications, avatar menu, skip link, and the
  `<main>` landmark. Pages pass `activeKey` and their content, plus optional
  `leftExtra` / `rightLead` / `rightActions` / `overlays` slots for the few
  genuinely page-specific controls. `minimal` renders the bare header for
  loading and signed-out states.
- `shell/navItems.js` — **the** nav definition (LOCK L5.7). Never redeclare
  `NAV_ITEMS` in a page.
- `shell/ThemeToggleButton.jsx` — the light/dark switch, for focused flows
  (the connect wizard) that take the toggle without the rest of the chrome.
- `shell/AppHeader.jsx` — the presentational header `AppShell` composes. Pages
  do not render it directly; the guard rejects that.

## Using it in a page

```jsx
import { AppShell, IconButton } from "@/ui-v2";

export default function DashboardPage() {
  return (
    <AppShell
      activeKey="dashboard"
      className={styles.shell}
      mainClassName={styles.main}
      rightActions={<IconButton title="Settings">...</IconButton>}
    >
      {/* page content */}
    </AppShell>
  );
}
```

Credits, theme, notifications, avatar and nav are **not** the page's business —
`AppShell` resolves all of them. A page that reaches for `AppHeader`,
`CreditPill`, `NotificationBell`, `AvatarMenu` or `MobileNavDrawer` directly,
or that declares its own `NAV_ITEMS` or `ThemeToggleButton`, fails
`scripts/check-app-shell.cjs`.

## Not built yet (add when the first screen that needs it is migrated)

Per-screen one-off patterns (variant chips, filter pills, drag-drop day
cells, filmstrip carousels, etc.) belong in that screen's own folder, not
here — only promote a pattern into `src/ui-v2/primitives` once a *second*
screen needs the same thing.
