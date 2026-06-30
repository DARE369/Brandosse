# UI Consistency Audit And Review Plan

Date: 2026-04-29  
Skill basis: `ui-ux-pro-max` accessibility, touch, performance, style consistency, responsive layout, typography, color, motion, forms, navigation, and data UI guidance.

## Executive Summary

The project has a strong start toward a shared design system, but the UI is currently split across several overlapping generations of styling:

- Shared token files are loaded globally in `src/main.jsx`, including `tokens.css`, `theme.css`, `variables.css`, `global.css`, `design-system.css`, `responsive-contract.css`, and `GeneratePromptBar.css`.
- The app has three major shell families: personal dashboard (`--dash-*`), organization workspace (`--org-*`), and platform admin (`--admin-*`).
- Those shell tokens mostly map back to shared semantic tokens now, which is good.
- Older compatibility layers and legacy CSS still redefine colors, buttons, cards, shadows, headings, tables, badges, and global class names.
- `AdminDashboard.css` is the largest risk because it is imported by many admin components and still contains broad selectors such as global `h1`, `td`, `.card`, `.status-badge`, and admin navbar/sidebar definitions.
- Existing audit data shows 52 authored stylesheet files, 6 unimported or likely legacy stylesheets, and 53 source files with inline styles. A current quick scan found 117 inline style instances and 3,201 raw color declarations across CSS/JSX style surfaces.

The next review should not create a new look from scratch. It should consolidate the current best direction into one governed design system, then migrate each dashboard/page family onto it.

## Product Surfaces Reviewed

Public and auth:
- Landing, login, register, password reset, invitation accept, client review, context selector.

Personal app:
- Dashboard, Generate, Calendar, Library, Help, Settings, Brand Kit, Connected Accounts, mock publish flows.

Organization workspace:
- Overview, My Workspace, My Office, Pipeline, Org Calendar, Asset Library, Common Room, Team Activity, org admin screens.

Platform admin:
- Admin overview, users, user detail, accounts, organizations, moderation, complaints, logs, analytics, settings.

## Main UI Decisions Observed

### 1. Token Strategy

Good:
- `src/styles/tokens.css` defines typography, spacing, radius, shadows, color, status, and theme aliases.
- `src/styles/design-system.css` adds shared status badge and platform icon primitives.
- `src/styles/responsive-contract.css` documents responsive behavior for generate, calendar, and admin.

Risks:
- `theme.css`, `variables.css`, and `tokens.css` all define or remap overlapping aliases.
- `variables.css` still starts with a teal/purple/pink theme, then later defines Brand Kit and Calendar/Library compatibility tokens.
- The active visual language is indigo-forward, but legacy comments and variables still describe teal as the primary brand.

Decision:
- Make `tokens.css` the canonical token source.
- Keep shell aliases (`--dash-*`, `--org-*`, `--admin-*`) only as compatibility bridges.
- Move old compatibility variables into clearly named legacy sections and stop adding new styles against them.

### 2. Shell Consistency

Good:
- Personal, org, and admin shells now share a similar indigo + elevated surface direction.
- Nav/sidebar patterns are conceptually aligned: top bar, left rail, content area, cards, stats, filters.

Risks:
- Each shell has different navbar heights, sidebar widths, card radii, panel effects, and content padding.
- Org and admin shells use heavier glass/elevation than personal pages, which can make the app feel like separate products.

Decision:
- Keep role-specific information architecture, but unify the grammar:
  - same spacing scale
  - same nav/sidebar density rules
  - same card/panel radius families
  - same button heights and action hierarchy
  - same empty/loading/error states

### 3. Admin Styling

Good:
- `AdminShell.css` and `AdminWorkspace.css` contain a more modern token-backed admin system.

Risks:
- `AdminDashboard.css` still contains legacy admin shell, dashboard, content manager, analytics, moderation, modal, table, and utility-style CSS in one file.
- `AdminDashboard.css` imports are widespread across admin components.
- A local CSS scan found 221 unique classes in `AdminDashboard.css`; 60 were not found in current admin JS/JSX usage by the existing `analyze_css.js` heuristic.
- Broad selectors like global heading color, `td`, and `.card` are fragile.

Decision:
- Treat `AdminDashboard.css` as a migration source, not a foundation.
- Move active patterns into scoped admin primitives or page-specific CSS.
- Delete or archive unused legacy classes only after screenshot verification.

### 4. Shared Primitives

Good:
- There are shared classes for buttons, badges, form controls, status badges, platform icons, cards, and panels.

Risks:
- Generic names such as `.card`, `.badge`, `.btn-primary`, `.modal-overlay`, `.status-badge`, `.empty-state`, and `.sidebar-toggle-btn` are reused across unrelated surfaces.
- Calendar/generate/admin/org styles can unintentionally affect one another through global class collisions.

Decision:
- Introduce one canonical primitive layer:
  - `UiButton`
  - `UiIconButton`
  - `UiCard`
  - `UiPanel`
  - `UiBadge`
  - `UiStatusBadge`
  - `UiTabs`
  - `UiFilterBar`
  - `UiTable`
  - `UiModal`
  - `UiDrawer`
  - `UiEmptyState`
  - `UiPageHeader`
  - `UiStatCard`
- Keep domain wrappers only when they add real product semantics.

### 5. Accessibility And Interaction

Good:
- A global focus-visible baseline exists.
- Most modern controls use actual buttons and inputs.
- Lucide is available and heavily used.

Risks:
- Some images are missing `alt`.
- Many inputs rely heavily on placeholders or wrapper labels; this should be audited field by field.
- Only `GeneratePromptBar.css` currently has a detected `prefers-reduced-motion` block.
- Many transitions use `transition: all`, and hover transforms are common.

Decision:
- Add a global reduced-motion policy.
- Require accessible names for icon-only buttons.
- Use visible labels or screen-reader labels consistently.
- Enforce minimum 44px interactive targets for touch.

### 6. Responsive Behavior

Good:
- `responsive-contract.css` already establishes intended width ranges and no-horizontal-scroll goals.
- Generate and calendar have explicit mobile drawer behavior.

Risks:
- Responsive rules are split between global contract files and feature CSS files.
- Admin has both old mobile sidebar rules and newer shell rules.
- Some table/data views rely on horizontal scroll, while others collapse into cards.

Decision:
- Define one responsive contract per UI pattern, not per page:
  - shell
  - page header
  - filters
  - stat grid
  - data table
  - drawer/modal
  - card grid
  - calendar/scheduler

## Target Design Direction

The app should feel like a professional AI social media operations platform:

- Quiet, dense, and work-focused for dashboards and admin tools.
- Content-first for generation, calendar, and library workflows.
- Slightly more expressive on landing/auth, while still sharing core brand tokens.
- Indigo can remain the primary action/accent, but the palette should not become one-note purple/blue.
- Use semantic status colors only for states: success, warning, danger, info.
- Reserve gradients and glass effects for shell depth and primary CTA moments; avoid applying them to every card.

## Design Governance Rules

New UI work should follow these rules immediately:

- No new raw hex colors in CSS/JSX except platform brand colors, uploaded brand kit values, charts, or third-party logos.
- No new unscoped global names like `.card`, `.badge`, `.modal-overlay`, `.status-badge`, `.btn-primary`, or `.empty-state`.
- No new `transition: all`; use explicit properties.
- No icon-only button without `aria-label` and, where helpful, visible tooltip text.
- No card-in-card layouts unless the inner card is a repeated item or a modal/tool surface.
- No new page-specific button systems unless they wrap the shared primitive.
- New tables must define both desktop and mobile behavior.
- New forms must have visible labels or equivalent accessible labels.

## Phased Review And Improvement Plan

### Phase 0 - Freeze The Drift

Goal: prevent more inconsistency while the cleanup happens.

Actions:
- Document canonical tokens and primitive classes.
- Add a simple CSS/JSX audit script for raw hex, generic global class names, `transition: all`, missing `alt`, and icon buttons without labels.
- Mark legacy files and classes as migration candidates.

Priority files:
- `src/styles/tokens.css`
- `src/styles/global.css`
- `src/styles/design-system.css`
- `src/styles/responsive-contract.css`
- `src/styles/variables.css`
- `src/styles/theme.css`

### Phase 1 - Unify The Core Tokens

Goal: one source of truth for color, spacing, radius, type, elevation, and motion.

Actions:
- Normalize token names around semantic intent: page, surface, elevated, subtle, border, text, action, status.
- Keep dark/light values paired.
- Decide the allowed radius scale for product UI:
  - controls: 8px or pill when semantically a chip
  - cards/panels: 12px or 16px
  - modals/drawers: 16px or 20px
- Reduce decorative gradients and heavy shadows in dashboards.

### Phase 2 - Build Shared Primitives

Goal: shared component and class vocabulary used everywhere.

Actions:
- Implement or consolidate primitive components for buttons, icon buttons, inputs, selects, badges, status badges, page headers, panels, cards, tabs, filters, tables, modals, drawers, empty states, and stat cards.
- Update `StatusBadge.jsx` and admin status badge variants to use one status mapping.
- Standardize platform icon/color behavior.

### Phase 3 - Harmonize The Three Shells

Goal: personal, org, and admin dashboards feel like one product.

Actions:
- Align navbar/sidebar dimensions and interaction states.
- Align page content padding across desktop/tablet/mobile.
- Align title/subtitle/action placement.
- Align nav active states and collapsed behavior.
- Keep shell labels and menu structure role-specific, but make visual treatment consistent.

Priority files:
- `src/styles/UserDashboard.css`
- `src/styles/OrgWorkspace.css`
- `src/admin/styles/AdminShell.css`
- `src/admin/styles/AdminWorkspace.css`
- `src/components/User/UserNavbar.jsx`
- `src/components/User/UserSidebar.jsx`
- `src/org/components/OrgTopNavbar.jsx`
- `src/org/components/OrgSidebar.jsx`
- `src/admin/components/AdminNavbar/AdminNavbar.jsx`
- `src/admin/components/AdminSidebar/AdminSidebar.jsx`

### Phase 4 - Migrate Admin Legacy CSS

Goal: remove the biggest source of cross-page drift.

Actions:
- Split `AdminDashboard.css` into scoped active modules.
- Remove obsolete shell/navbar/sidebar rules already replaced by `AdminShell.css`.
- Replace broad selectors with `.admin-*` scoped primitives.
- Replace dormant Tailwind-like class usage in admin components with project CSS primitives.
- Retest admin users, detail, content manager, moderation, analytics, accounts, complaints, logs, and settings.

Priority files:
- `src/admin/styles/AdminDashboard.css`
- `src/admin/components/UserDetailsPanel/UserDetailsPanel.jsx`
- `src/admin/components/ContentManager/*`
- `src/admin/components/ContentModeration/*`
- `src/admin/pages/AdminAnalyticsPage.jsx`
- `src/admin/pages/AdminModeration/AdminModerationPage.css`

### Phase 5 - Normalize High-Traffic Personal Pages

Goal: make day-to-day user flows consistent.

Actions:
- Align Generate, Calendar, Library, Settings, Help, Brand Kit, and Dashboard against shared primitives.
- Replace page-specific close/back/action buttons with shared button variants.
- Standardize modal/drawer dimensions, headers, and footers.
- Convert inline styles that affect layout, color, radius, or typography into CSS classes/tokens.

Priority files:
- `src/styles/GenerateV2.css`
- `src/styles/GeneratePromptBar.css`
- `src/styles/CalendarV2.css`
- `src/styles/LibraryV2.css`
- `src/styles/Settings.css`
- `src/styles/BrandKit.css`
- `src/components/Generate/*`
- `src/pages/CalendarPage/components/*`

### Phase 6 - Normalize Organization Workspace Pages

Goal: make collaboration surfaces feel like the same workspace.

Actions:
- Align org admin forms and member workspace cards.
- Normalize task/pipeline/calendar/library status chips.
- Replace ad-hoc org page button classes with shared org wrappers over primitives.
- Standardize channel, task, asset, and schedule modal patterns.

Priority files:
- `src/org/styles/OrgAdmin.css`
- `src/org/styles/PipelineBoard.css`
- `src/org/styles/OrgCalendar.css`
- `src/org/styles/AssetLibrary.css`
- `src/org/styles/CommonRoom.css`
- `src/org/styles/MyWorkspace.css`
- `src/org/components/tasks/*`
- `src/org/components/calendar/*`

### Phase 7 - Public/Auth Polish

Goal: keep public pages expressive but aligned.

Actions:
- Keep landing/auth more branded, but use the same color, type, button, focus, and form tokens.
- Remove obsolete auth/login styles.
- Make onboarding/context selector visually consistent with post-login shells.

Priority files:
- `src/pages/Landing/LandingPage.css`
- `src/pages/Auth/Auth.css`
- `src/pages/Auth/AuthCallback.css`
- `src/pages/InvitationAccept/InvitationAcceptPage.css`
- `src/pages/ClientReview/ClientReview.css`
- `src/pages/ContextSelector/ContextSelector.css`

## Review Checklist For Every Page

- Page title, subtitle, primary action, and secondary actions follow one layout.
- Surface hierarchy is clear: page background, panel, card, raised overlay.
- Text sizes match the component density.
- Buttons have one primary action per view.
- Icon-only controls have accessible names.
- Inputs have labels and visible error/helper states.
- Empty, loading, success, warning, and error states are present.
- Content does not overflow at 375px, 768px, 1024px, and 1440px.
- Touch targets are at least 44px where practical.
- Motion respects reduced-motion settings.
- No page-specific raw colors unless justified.
- Tables have mobile behavior.
- Charts do not rely on color alone.

## Suggested Implementation Order

1. Add audit guardrails and design-system rules.
2. Consolidate tokens and primitive classes.
3. Harmonize personal/org/admin shells.
4. Migrate admin legacy CSS.
5. Migrate Generate and Calendar.
6. Migrate Library, Settings, Help, Brand Kit.
7. Migrate org workspace pages.
8. Polish public/auth pages.
9. Run visual QA across desktop, tablet, and mobile.

## Acceptance Criteria

- Dashboards and pages use one canonical token system.
- No unscoped global component class names remain in active page CSS.
- Admin no longer depends on monolithic legacy `AdminDashboard.css` for unrelated component groups.
- Raw color usage is limited to approved exceptions.
- Every core route passes responsive review at 375px, 768px, 1024px, and 1440px.
- Every icon-only button has an accessible label.
- All meaningful images have alt text.
- All shared modals/drawers use consistent header/body/footer structure.
- Dashboard, org, and admin shells share visual rhythm while preserving their roles.
