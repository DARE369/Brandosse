# Platform Styling, Visual Structure, and Theming Reference

Updated: 2026-05-11  
Audience: Claude or any engineer standardizing the SocialAI UI  
Scope: Whole-platform styling architecture, layout hierarchy, token usage, consistency rules, and a true system-default theme model.

## 1. Purpose of This Document

This document has two jobs:

1. Describe how the platform is styled today across landing, auth, user, admin, and feature workspaces.
2. Define the consistency rules and theme architecture needed to make the platform feel like one product instead of several adjacent style systems.

This is intentionally detailed because SocialAI currently has multiple overlapping token systems, multiple layout shells, and multiple theme activation patterns.

The documentation is meant to help Claude improve the platform without:

- breaking existing working shells
- introducing another isolated mini-design-system
- reinforcing the current token duplication
- implementing theme support in a way that fights the existing CSS cascade

## 2. Styling Architecture at a Glance

### 2.1 Current import order

Global styles are loaded by `app/layout.jsx`, which imports `src/styles/app-entry.css`. That file is now the canonical stylesheet entry for the Next runtime.

Current top-level order in `app-entry.css`:

1. `src/index.css`
2. `src/styles/tokens.css`
3. `src/styles/theme.css`
4. `src/styles/variables.css`
5. `src/styles/global.css`
6. `src/styles/design-system.css`
7. `src/components/Shared/ui/ui-primitives.css`
8. `src/styles/responsive-contract.css`
9. feature, page, admin, org, and video-engine styles

Then page/component CSS is imported inside route components and feature components.

This matters because:

- later files can override earlier globals
- many files define `:root` variables with the same conceptual purpose
- some files use `[data-theme="light"]`, some use `[data-theme="dark"]`, some use `.dark`, some use `html.dark`, and some use `@media (prefers-color-scheme: dark)`

### 2.2 Theme source of truth today

`src/Context/ThemeContext.jsx` is the runtime theme controller.

Current behavior:

- reads `localStorage["socialai-theme"]`
- falls back to `window.matchMedia("(prefers-color-scheme: dark)")`
- writes `data-theme="light"` or `data-theme="dark"` on `<html>`
- writes the resolved theme back to local storage

Important limitation:

- this is not a true `system | light | dark` preference model
- it is effectively a two-state saved theme with a one-time system fallback

### 2.3 Active style clusters

The platform currently has four major visual clusters:

1. Public entry cluster
   - landing
   - auth
   - auth callback
   - dark-first, premium, indigo, DM Sans plus display serif/sans pairing

2. Product workspace cluster
   - user dashboard
   - generate
   - admin shell
   - dark-first, indigo, glassy panels, Plus Jakarta Sans + Sora

3. Utility workspace cluster
   - calendar
   - library
   - settings
   - lighter card-based system driven mostly by `variables.css`

4. Brand Kit cluster
   - full internal mini-design-system
   - dark-first indigo
   - DM Sans + Syne
   - dedicated `--bk-*` token namespace

There are also legacy or stale style files that do not align with the main active direction.

## 3. Current Style Sources and Their Roles

### 3.1 `src/styles/theme.css`

Intended role:

- the cleanest global theme-token file
- defines `[data-theme="dark"]` and `[data-theme="light"]` tokens
- controls `--bg-*`, `--text-*`, `--accent-*`, `--border-*`, `--shadow-*`
- defines smooth theme transitions and `.theme-no-transition`

Practical meaning:

- this should be the foundation of theme switching
- it is the closest thing the codebase has to a canonical root theme layer

### 3.2 `src/styles/variables.css`

Current role:

- mixed token warehouse
- contains older brand palette variables
- contains `.dark` selector-based overrides
- contains global reset styles
- contains utility button/card classes
- contains brand kit tokens `--bk-*`
- contains calendar/library compatibility tokens
- contains another type scale and spacing set

Practical meaning:

- this file is carrying too many responsibilities
- it mixes brand, theme, reset, utilities, and feature-specific tokens in one place
- it is one of the biggest sources of inconsistency

### 3.3 `src/styles/design-system.css`

Current role:

- shared primitives for status badges, platform icons, type scale, spacing, and neutral surfaces
- defines `--color-*`, `--surface-*`, `--status-*`, `--platform-*`, `--font-*`
- applies an `@media (prefers-color-scheme: dark)` override

Practical meaning:

- useful for reusable primitives
- but currently disconnected from `ThemeContext` because it partially relies on media queries instead of only the HTML theme attribute

### 3.4 `src/styles/global.css`

Current role:

- another reset/basic app-level token file
- defines `:root` with `--bg`, `--card-bg`, `--text`, `--primary`, `--accent`
- defines `html.dark` overrides
- defines app shell helpers and generic `.card`, `.btn-primary`

Practical meaning:

- this overlaps with both `theme.css` and `variables.css`
- it introduces another theme selector style that does not match the current `ThemeContext`

### 3.5 `src/styles/App.css`

Current role:

- legacy token file with red/black/white styling
- defines generic `.btn`, `.card`, `body`, headings

Practical meaning:

- visually inconsistent with the active indigo SocialAI product styling
- should be treated as legacy until proven necessary

### 3.6 `src/styles/responsive-contract.css`

Current role:

- the clearest cross-feature layout contract in the codebase
- defines responsive behavior for:
  - generate
  - calendar
  - admin
- protects `min-width: 0`, panel drawer behavior, focus visibility, touch behavior, and compact layout rules

Practical meaning:

- this should remain the source of truth for responsive shell rules
- page CSS should not drift away from it

## 4. Visual Structure of the Whole Platform

This section describes the platform route by route so visual hierarchy can be standardized across the whole product.

### 4.1 Public landing surface

Files:

- `src/pages/Landing/LandingPage.jsx`
- `src/pages/Landing/LandingPage.css`

Visual structure:

- full-viewport dark marketing page
- fixed translucent navbar
- large hero with gradient highlights and background glows
- section wrappers centered around a max-width content column
- premium section labels, strong display headings, softer explanatory text
- feature cards, platform blocks, testimonials, FAQ accordion

Visual language:

- dark-first
- indigo/purple gradients
- DM Sans body
- Syne display styling
- premium marketing feel

Hierarchy model:

- brand and call to action dominate first view
- sections are announced with pill labels
- supporting copy is muted and width-limited
- cards are used for scannable proof and features

### 4.2 Authentication surface

Files:

- `src/layouts/AuthLayout.jsx`
- `src/pages/Auth/Auth.css`
- `src/pages/Auth/AuthCallback.css`

Visual structure:

- split-screen auth layout on larger screens
- left panel is always dark and brand-heavy
- right panel is themeable and form-focused
- top bar contains back link and theme toggle
- form is centered with constrained width and high focus

Hierarchy model:

- brand narrative and reassurance on the left
- conversion and form completion on the right
- form fields are the primary interaction focus
- secondary actions remain visually lighter

Important styling detail:

- auth pages already assume the root theme tokens from `theme.css`
- the left brand panel intentionally stays dark regardless of page theme

### 4.3 Core authenticated user shell

Files:

- `src/pages/Dashboard/UserDashboard.jsx`
- `src/components/User/UserNavbar.jsx`
- `src/components/User/UserSidebar.jsx`
- `src/styles/UserDashboard.css`

Visual structure:

- grid shell
- top navbar across full width
- left sidebar for persistent navigation
- right/main content area for route content

Key shell rules:

- navbar height is effectively the fixed top visual anchor
- sidebar holds navigation grouping, user identity, and logout
- route content panels sit on a layered dark or light background

Visual language:

- Plus Jakarta Sans body
- Sora display headings
- indigo accent
- translucent top bar
- high-contrast cards with subtle glass / shadow feel

This is the strongest active product shell and should be treated as the visual reference for authenticated product surfaces.

### 4.4 User dashboard visual hierarchy

Files:

- `src/pages/Dashboard/UserDashboard.jsx`
- `src/styles/UserDashboard.css`

Structure:

- greeting header and primary CTA
- onboarding checklist for first-time users
- KPI strip
- recent generations widget
- quick actions widget
- account health widget

Hierarchy:

- greeting + CTA = first-level
- KPI strip = second-level dashboard scan
- widgets = third-level operational blocks
- chip, badge, time, and metadata = fourth-level detail

The user dashboard is the clearest example of information hierarchy in the product:

- summary first
- action second
- detail third

### 4.5 Generate workspace

Files:

- `src/pages/GeneratePage/GeneratePageV2.jsx`
- `src/styles/GenerateV2.css`
- `src/styles/GeneratePromptBar.css`

Structure:

- same user shell frame as dashboard
- left session-history rail as overlay drawer
- center generation canvas
- right post-production panel
- bottom fixed input dock

Hierarchy:

- canvas is primary
- session rail is secondary navigation
- post-production panel is secondary workflow detail
- fixed prompt dock is the persistent core action

Visual language:

- extends dashboard tokens through `--gen-*`
- dark-first, studio-like, overlay-driven
- image-first cards
- stronger motion and state feedback than dashboard

Important styling note:

- `GenerateV2.css` is aligned with the dashboard token family
- `GeneratePromptBar.css` defines its own `--gpb-*` root tokens and does not currently inherit cleanly from the shared theme contract

### 4.6 Calendar workspace

Files:

- `src/pages/CalendarPage/CalendarPageV2.jsx`
- `src/styles/CalendarV2.css`
- `src/styles/responsive-contract.css`

Structure:

- top user navbar
- left user sidebar
- main scheduling area
- drafts drawer/docked panel depending on width
- detail modal/panels for scheduling

Hierarchy:

- calendar grid and current date range are primary
- filters and view toggles are secondary
- drafts rail is secondary support
- ghost slots and optimal time insights are tertiary intelligence layers

Visual language:

- card-based
- lighter utility/productivity feel
- depends heavily on `var(--app-bg)`, `--panel-bg`, `--text-main`, `--border-color`

Important styling note:

- calendar is functionally modernized by the responsive contract
- visually it still leans on an older utility token system instead of the main dashboard/admin/generate cluster

### 4.7 Library workspace

Files:

- `src/pages/LibraryPage/LibraryPageV2.jsx`
- `src/styles/LibraryV2.css`

Structure:

- same user shell frame
- route-local top bar
- filter bar
- left rail for categories/pillars
- main content pane with cards or list layouts

Hierarchy:

- route title and actions
- filters and search
- left taxonomy rail
- content cards/table rows

Visual language:

- utilitarian
- light card surfaces
- lower visual drama than dashboard/generate

### 4.8 Settings workspace

Files:

- `src/pages/Settings.jsx`
- `src/styles/Settings.css`

Structure:

- same user shell frame
- max-width content container
- header
- responsive card grid of platform connection cards
- confirmation modal for disconnect

Hierarchy:

- page title and explanation
- platform cards
- card header identity
- platform capabilities
- connection state details
- destructive disconnect action

Visual language:

- clean card-based utility page
- less aligned with the glassy indigo dashboard/admin shell
- relies on `variables.css` tokens and local badge styles

### 4.9 Brand Kit workspace

Files:

- `src/pages/Settings/BrandKitPage.jsx`
- `src/styles/BrandKit.css`
- `src/styles/variables.css` for `--bk-*`

Structure:

- mounted inside the normal user shell
- internally behaves like a mini-application
- setup choice
- extraction/loading flow
- conversational flow
- review forms
- final dashboard
- diff modal

Visual language:

- dark-first
- more editorial/tooling feel
- DM Sans body
- Syne display
- dedicated button/form/pill system
- broader use of accent glows

Practical meaning:

- Brand Kit is internally coherent
- but it is not fully aligned with the typography and token choices of dashboard/admin/generate

### 4.10 Admin workspace

Files:

- `src/admin/AdminLayout.jsx`
- `src/admin/styles/AdminShell.css`
- `src/admin/styles/AdminDashboard.css`

Structure:

- admin sidebar
- sticky admin navbar
- scrollable admin content region
- individual pages using KPI grids, charts, tables, user panels, modals

Visual language:

- mapped from dashboard tokens through `--admin-*`
- Plus Jakarta Sans + Sora
- high-contrast control-plane feel
- consistent with the user dashboard/generate cluster

Important styling note:

- `AdminShell.css` is the active modern admin shell
- `AdminDashboard.css` still contains large amounts of older styling and overlaps with the new shell
- admin currently loads both shells/styles in different places, which increases the risk of cascade conflicts

## 5. Existing Design Primitives

### 5.1 Color systems currently in play

There are several active token namespaces:

- root theme tokens from `theme.css`
  - `--bg-base`
  - `--bg-surface`
  - `--bg-card`
  - `--text-primary`
  - `--text-secondary`
  - `--accent`
  - `--border`

- dashboard/product tokens from `UserDashboard.css`
  - `--dash-*`

- generate tokens derived from dashboard
  - `--gen-*`

- admin tokens derived from dashboard
  - `--admin-*`

- brand kit tokens
  - `--bk-*`

- utility tokens from `variables.css`
  - `--app-bg`
  - `--panel-bg`
  - `--element-bg`
  - `--text-main`
  - `--border-color`

- design-system semantic tokens
  - `--surface-*`
  - `--status-*`
  - `--platform-*`
  - `--color-neutral-*`

This means the platform does not currently have one token model. It has several related but competing ones.

### 5.2 Typography systems currently in play

Fonts in actual use:

- DM Sans
- Syne
- Plus Jakarta Sans
- Sora
- Inter
- JetBrains Mono

Important loading detail:

- font loading should now be handled through Next-supported mechanisms from `app/layout.jsx`, global CSS imports, or `next/font`
- `UserDashboard.css` imports `Plus Jakarta Sans` and `Sora`
- `AdminShell.css` also imports `Plus Jakarta Sans` and `Sora`
- `Syne` is referenced in landing and brand kit tokens but is not yet centrally loaded through a Next font strategy

Practical consequence:

- typography is part of the visual inconsistency
- some surfaces use display typography that may silently fall back if the font is not loaded

### 5.3 Reusable shared primitives that already exist

Good reusable component primitives already in the codebase:

- `src/components/Shared/StatusBadge.jsx`
- `src/components/Shared/PlatformIcon.jsx`
- `src/components/Shared/AuthLoadingOverlay.jsx`

These are important because they represent the right direction:

- componentized semantics
- shared styling classes
- fewer one-off status pills and platform treatments

### 5.4 Common visual building blocks already present

Across the platform, these patterns are already common:

- rounded cards
- elevated CTA buttons
- muted secondary text
- accent-led active states
- badge/pill metadata
- overlay modals and drawers
- translucent top bars
- shadow-based depth instead of heavy borders alone

These should remain part of the visual identity.

## 6. Current Inconsistency Map

This section is the most important styling audit section. These are the main reasons the platform does not yet feel fully unified.

### 6.1 Multiple theme activation mechanisms

Current selectors in use:

- `[data-theme="dark"]`
- `[data-theme="light"]`
- `.dark`
- `html.dark`
- `@media (prefers-color-scheme: dark)`

Problem:

- the runtime theme system sets `data-theme` on `<html>`
- selectors based on `.dark` or `html.dark` are not guaranteed to respond
- media-query-based theme shifts can fight manual user choice

### 6.2 Multiple root token systems

The same conceptual roles are defined in multiple files:

- background
- text
- accent
- border
- shadows
- buttons
- cards

Problem:

- a new feature can easily choose the wrong token family
- light/dark behavior becomes inconsistent
- refactoring becomes harder because token ownership is unclear

### 6.3 Generic utility class collisions

The codebase defines generic class names like:

- `.card`
- `.btn-primary`
- `.btn-secondary`
- `.badge`

across multiple files.

Problem:

- these classes are not owned by one canonical design-system file
- a page import can unintentionally change another page's generic utility behavior

### 6.4 Typography fragmentation

Current pairing by cluster:

- landing/auth/brand kit -> DM Sans + Syne
- dashboard/admin/generate -> Plus Jakarta Sans + Sora
- older utility and legacy files -> Inter

Problem:

- the product feels like multiple applications
- headings, density, and brand tone shift between routes

### 6.5 Product shell mismatch

Currently:

- dashboard/admin/generate form one coherent visual family
- calendar/library/settings form another older utility family
- brand kit forms a third family

Problem:

- users moving between routes experience visible tone changes
- the same product account can feel premium on one page and generic on another

### 6.6 Legacy style files remain active

Examples:

- `src/styles/App.css`
- `src/styles/global.css`
- older sections inside `src/admin/styles/AdminDashboard.css`
- `src/styles/generate.css`

Problem:

- some are partly stale but still imported or still define globals
- they increase uncertainty around which rules are authoritative

### 6.7 Theme toggle implementation mismatch

`src/components/Shared/ThemeToggle.jsx` expects:

- `dark`
- `setDark`

But `ThemeContext` currently provides:

- `theme`
- `toggleTheme`
- `isDark`

Problem:

- the shared toggle is not aligned with the actual context API
- the codebase has multiple theme-toggle implementations instead of one canonical control

### 6.8 No true system-default preference

Current behavior:

- system preference is only used when no local storage value exists
- after first render, the resolved theme is stored as light or dark
- later OS theme changes no longer affect the app because stored light/dark now exists

Problem:

- there is no persistent `system` mode
- the current behavior looks like system support but is not a full system-follow implementation

## 7. Canonical Visual Consistency Rules

This section defines the target visual hierarchy the whole platform should converge toward.

### 7.1 Page hierarchy

Every authenticated product page should follow the same hierarchy model:

1. Shell frame
   - navbar
   - sidebar
   - content viewport

2. Page header
   - title
   - short description
   - primary action

3. Summary layer
   - KPIs
   - filters
   - status summaries

4. Primary work area
   - table
   - canvas
   - grid
   - form
   - calendar

5. Secondary work area
   - rails
   - detail panels
   - side drawers
   - metadata panes

6. Overlay layer
   - modals
   - confirmations
   - full-screen drawers on mobile

This hierarchy already exists in the best routes. New routes should follow it.

### 7.2 Typography hierarchy

Recommended canonical hierarchy:

- Display / hero / page title
  - strongest weight
  - tight tracking
  - used sparingly

- Section title
  - clearly secondary to page title
  - used for major regions within a page

- Card title
  - compact and scannable
  - should not visually compete with the page title

- Body text
  - default readable size
  - medium contrast

- Supporting text / muted text
  - lower contrast
  - metadata, helper text, timestamps, descriptions

- Labels / captions / badge text
  - smallest scale
  - uppercase only when semantically useful

Typography rule:

- one product-wide body font family
- one product-wide display font family
- one mono font family
- page clusters should not introduce their own independent pairings unless the surface is intentionally branded as a marketing experience

### 7.3 Surface hierarchy

Recommended surface layers:

- page background
- shell surface
- primary panel/card surface
- secondary panel surface
- hover/active elevated surface
- overlay backdrop
- modal/drawer surface

Visual rule:

- depth should be communicated by a mix of background step, border, and shadow
- not by unrelated colors
- panels in the same layer should use the same radius logic and elevation logic

### 7.4 Accent usage hierarchy

Accent color should mean one of these:

- primary CTA
- active navigation
- focused control
- selected state
- important interactive state

Accent should not be used for:

- large blocks of passive text
- decorative backgrounds with no meaning
- multiple competing CTA colors on the same surface

### 7.5 Semantic color rules

Status colors should keep one meaning everywhere:

- success / published / healthy
- warning / publishing / needs attention
- danger / failed / destructive
- neutral / draft / inactive

These should be driven by shared semantic tokens, not per-page hardcoded hex values.

### 7.6 Spacing and radius rules

Use one spacing ladder and one radius ladder platform-wide.

Recommended structure:

- 4px micro spacing
- 8px compact spacing
- 12px small spacing
- 16px default spacing
- 24px section spacing
- 32px page-block spacing
- 48px large section spacing

Radii should also be constrained to a platform scale:

- small for controls
- medium for cards
- large for modals / hero surfaces
- pill for badges/toggles

### 7.7 Motion and focus rules

Transitions should be short and purposeful:

- 150ms to 220ms for most hover/focus transitions
- slightly longer for drawers and panel shifts

Every interactive control should have:

- visible hover state
- visible focus-visible state
- visible disabled state

The responsive contract already enforces explicit focus outlines. That should be kept.

### 7.8 Responsive hierarchy rules

For smaller viewports:

- keep one primary task area in focus
- convert side panels to drawers
- keep critical actions visible without hover
- prefer stacked layout over squeezed multi-column density

This rule is already formalized in `responsive-contract.css` and `docs/mobile-tablet-layout-contract.md`.

## 8. Recommended Canonical Styling Model

This is the structure Claude should aim for when consolidating styling.

### 8.1 One root theme layer

`theme.css` should become the single root theme entry for:

- theme-controlled backgrounds
- text colors
- border colors
- accent colors
- semantic colors
- global shadow steps
- `color-scheme`

### 8.2 One shared design-system layer

`design-system.css` should own:

- type scale
- spacing scale
- radius scale
- z-index conventions
- status badge styles
- platform icon styles
- focus ring styles
- generic semantic primitives

### 8.3 Feature alias tokens, not feature color systems

Feature files may alias shared tokens like this:

- `--dash-*`
- `--gen-*`
- `--admin-*`
- `--bk-*`

But those aliases should map to the shared root theme model instead of inventing new independent palettes.

That means:

- feature tokens are allowed
- feature theme systems are not

### 8.4 Page CSS ownership rules

New page CSS should:

- style layout and local components
- consume shared tokens
- avoid redefining core brand colors in `:root`
- avoid creating generic `.card` or `.btn-primary` utilities

Only shared layers should define global utilities.

## 9. True System-Default Theme Support

This section documents how system-default theming should work across the platform.

### 9.1 Current state

Current theme logic in `ThemeContext`:

- accepts only stored `light` or `dark`
- uses system preference only as a fallback
- stores the resolved theme back to local storage
- updates `data-theme` on `<html>`

Result:

- theme is not truly preference-based
- OS theme changes do not keep syncing after the first resolved theme is stored

### 9.2 Target behavior

The app should support three user theme preferences:

- `light`
- `dark`
- `system`

Definitions:

- `light`: always light
- `dark`: always dark
- `system`: follow the operating system preference in real time

### 9.3 Theme state model

Recommended state split:

- `themePreference`
  - `light | dark | system`

- `resolvedTheme`
  - `light | dark`

The most important rule:

- store the preference, not the resolved theme

### 9.4 Storage model

Recommended local storage key:

- `socialai-theme-preference`

Recommended values:

- `light`
- `dark`
- `system`

Optional longer-term persistence:

- sync the same value to `user_settings.theme_preference`

Important note:

- there is already a `user_settings.theme` default insert path in `src/services/supabase.js`
- it is not currently wired to the active theme system
- if backend persistence is added, prefer `theme_preference` over storing only a resolved theme

### 9.5 Theme resolution algorithm

Recommended logic:

```js
const preference = storedPreference || "system";
const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
const resolvedTheme =
  preference === "system"
    ? (systemDark ? "dark" : "light")
    : preference;
```

Then:

- set `document.documentElement.dataset.theme = resolvedTheme`
- set `document.documentElement.dataset.themePreference = preference`
- set `document.documentElement.style.colorScheme = resolvedTheme`

### 9.6 React context contract

Recommended `ThemeContext` API:

```js
{
  themePreference,      // "light" | "dark" | "system"
  resolvedTheme,        // "light" | "dark"
  isDark,               // boolean derived from resolvedTheme
  setThemePreference,   // setter
  toggleThemeMode       // optional convenience helper
}
```

Key rule:

- components should read `resolvedTheme` or `isDark`
- settings/profile controls should write `themePreference`

### 9.7 Media query listener behavior

The `prefers-color-scheme` listener should only affect the UI when:

- `themePreference === "system"`

If the user explicitly picks light or dark:

- OS theme changes should not change the UI

### 9.8 No-flash boot behavior

To avoid theme flash before React mounts, add a Next-compatible boot script from `app/layout.jsx` that resolves and applies theme immediately.

Recommended boot logic:

```html
<script>
  (function () {
    try {
      var pref = localStorage.getItem("socialai-theme-preference") || "system";
      var systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      var resolved = pref === "system" ? (systemDark ? "dark" : "light") : pref;
      document.documentElement.setAttribute("data-theme", resolved);
      document.documentElement.setAttribute("data-theme-preference", pref);
      document.documentElement.style.colorScheme = resolved;
    } catch (e) {}
  })();
</script>
```

This should run before the React bundle so CSS has the correct theme on first paint.

### 9.9 CSS contract for theme switching

For a clean theme system, the platform should standardize on:

- `[data-theme="dark"]`
- `[data-theme="light"]`

and stop relying on:

- `.dark`
- `html.dark`
- media-query-based root overrides for application theming

Media queries can still be used for responsive behavior, but not as a competing root theme system.

### 9.10 UI controls for theme selection

Theme selection should exist in two places:

1. Persistent user-facing settings
   - `Settings` page
   - radio group or segmented control with Light / Dark / System

2. Quick-access control
   - profile menu
   - optional compact toggle or submenu

The current binary toggle in `ProfileMenu` and `AuthLayout` should eventually evolve into:

- a three-option chooser
- or a toggle plus a visible "Use system" option

### 9.11 Special surfaces and exceptions

Even with system-default theming, some surfaces can remain intentionally fixed:

- the left auth brand panel can stay dark
- some marketing art treatments can remain dark-first

Rule:

- decorative exceptions are acceptable
- functional surfaces should still inherit the resolved platform theme

### 9.12 Acceptance criteria for system theme support

The platform should be considered to support system-default theming correctly when:

1. User can select Light, Dark, or System.
2. System preference persists as `system`, not as a resolved light/dark value.
3. OS theme changes update the app only when preference is `system`.
4. Root theme is applied before React mounts.
5. All major surfaces visually respond to `[data-theme]`.
6. No important surface still depends on `.dark` or `html.dark`.

## 10. Recommended Consistency Work for Claude

If Claude is asked to improve the platform styling, this is the preferred order of operations.

### 10.1 Phase 1: Lock the theme contract

Tasks:

- implement `themePreference` with `system | light | dark`
- add root boot script or `next/script` strategy in `app/layout.jsx`
- standardize selectors on `[data-theme]`
- remove or migrate `.dark` and `html.dark` dependencies
- fix theme toggle components to use one context API

### 10.2 Phase 2: Choose one typography system for the product

Recommended choice:

- one body font
- one display font
- one mono font

Then:

- load those centrally through `app/layout.jsx`, global CSS, or `next/font`
- remove duplicate CSS imports from feature styles where possible
- stop mixing unrelated font pairs by route unless the route is intentionally marketing-only

### 10.3 Phase 3: Consolidate token ownership

Tasks:

- keep `theme.css` for root theme tokens
- keep `design-system.css` for scale and primitives
- shrink `variables.css` to only what is still truly necessary
- move brand-kit-specific tokens into a dedicated brand-kit token file if that surface remains specialized
- remove stale utility duplicates from `global.css` and `App.css`

### 10.4 Phase 4: Normalize shells

Priority cluster:

- dashboard
- generate
- admin
- calendar
- library
- settings

Goal:

- same shell-level spacing language
- same panel elevation language
- same header/action hierarchy
- same input and button conventions

### 10.5 Phase 5: Normalize semantic components

Create or expand shared primitives for:

- buttons
- input fields
- select menus
- modal shells
- cards
- section headers
- badges
- empty states
- loading states
- table wrappers

### 10.6 Phase 6: Retire stale style paths

Candidates for cleanup or deprecation:

- `src/styles/App.css`
- overlapping sections of `src/styles/global.css`
- `src/styles/generate.css` if no longer used by active routes
- older sections of `src/admin/styles/AdminDashboard.css` that duplicate shell behavior

## 11. Rules for Adding New UI After Standardization

When adding a new route or major feature, Claude should follow these rules:

1. Do not create a new `:root` token family unless the feature truly requires a self-contained subsystem.
2. Do not define generic class names like `.card` or `.btn-primary` in a page-local CSS file.
3. Use the root theme tokens and design-system scale first, then alias locally only when necessary.
4. Keep one page title, one supporting description, and one clear primary action at the top of a page.
5. Keep metadata muted and supportive, not visually dominant.
6. Use the responsive contract for drawer behavior, `min-width: 0`, and focus treatment.
7. Use shared semantic components like `StatusBadge` and `PlatformIcon` instead of page-local reinventions.
8. If a feature needs a special sub-style-system, document why and scope the token namespace clearly.

## 12. Bottom Line

The platform already has strong visual building blocks, but they are split across several parallel styling systems:

- a solid root theme layer
- a separate variable warehouse
- a shared primitive layer
- strong page-specific shells
- several legacy and overlapping global files

The best current visual baseline for the authenticated product is:

- dashboard
- generate
- admin shell

The biggest styling consistency work still needed is:

- token consolidation
- typography unification
- calendar/library/settings alignment
- true `system | light | dark` theme support
- removal of conflicting theme selectors and duplicated global utilities
