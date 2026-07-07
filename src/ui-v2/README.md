# src/ui-v2 — Design System v2

Fresh, isolated component library for the 2026-07-05 UI rewrite. This is the
**only** source of design tokens/components for any screen migrated under the
plan in memory `design-system-v2` (owner-approved full replacement of the old
"Midnight Aurora" system and the packet-based Calendar/Library rebuild).

## Rules (non-negotiable — the owner set these explicitly)

1. **No imports from old UI into `src/ui-v2/**`.** Never import from
   `src/components/**`, `src/styles/**`, `src/legacy/**`, `src/calendar/**` (or
   any old stylesheet/theme file) into anything under this directory. Business
   logic (services, hooks, stores, Supabase calls) is NOT off-limits — only
   old *presentation* code is. Pages under `src/app`/`app/app/**` that use
   `ui-v2` may still import old services/hooks; they just render with
   `ui-v2` components instead of old styled ones.
2. **Tokens live only in `tokens.css`.** All colors/spacing/radii/fonts consumed
   by components must go through `--uiv2-*` CSS variables. No raw hex in a
   component file except inside `tokens.css` itself.
3. **Every migrated screen must implement loading / empty / error / success**
   states before it's considered done — see the four `.dc.html` mockups for
   the spec of each state per screen.
4. **Delete the old page's UI code once a screen migrates** so it can't leak
   back in.
5. Run `node scripts/check-ui-v2-isolation.js` before committing changes under
   `src/ui-v2/` — it fails the build if any file here imports a path outside
   `src/ui-v2/` other than `react`, `react-dom`, or `next/*`.

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
- `shell/AppHeader.jsx` — the sticky top nav shared by all 4 mockups
  (brand mark, nav links + mobile burger, search/extra slot, right-side slot
  for credits/theme-toggle/notif/avatar — screens compose the right slot
  themselves since the exact icon set differs per screen).

## Using it in a page

```jsx
import { UiV2ThemeProvider, UiV2ToastProvider, AppHeader, CreditPill, IconButton, Avatar } from "@/ui-v2";

export default function DashboardPage() {
  return (
    <UiV2ThemeProvider>
      <UiV2ToastProvider>
        <AppHeader
          navItems={NAV_ITEMS}
          activeKey="dashboard"
          right={
            <>
              <CreditPill pct="62%" label="1,240 cr" />
              <IconButton title="Toggle theme">...</IconButton>
              <Avatar initials="ME" />
            </>
          }
        />
        {/* page content */}
      </UiV2ToastProvider>
    </UiV2ThemeProvider>
  );
}
```

## Not built yet (add when the first screen that needs it is migrated)

Per-screen one-off patterns (variant chips, filter pills, drag-drop day
cells, filmstrip carousels, etc.) belong in that screen's own folder, not
here — only promote a pattern into `src/ui-v2/primitives` once a *second*
screen needs the same thing.
