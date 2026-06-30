# Platform Admin Page: Settings

## Page Purpose (Plain Language)
This page is the admin workspace preferences and self-security area. It exposes profile identity, password-reset action, local UI preferences, and notification-type toggles.

## Route and Access Rules
- Route: `/app/admin/settings`
- Parent guard: `<ProtectedRoute requireAdmin>`
- Scope behavior:
  - available to both super admin and org admin
  - settings are currently local-device values, not organization-scoped persisted config

## Component Composition
- Container: `src/admin/pages/AdminSettingsPage.jsx`
- Tabbed subviews:
  - `profile`
  - `security`
  - `preferences`
  - `notifications`

## State, Hooks, Services Used
- Router state:
  - `tab` query param via `useSearchParams`
- Persisted local state:
  - `useLocalPersist("socialai-admin-settings", ...)`
- Admin scope helpers:
  - `getAdminRoleLabel`
  - `getAdminScopeLabel`
- Auth action:
  - `supabase.auth.resetPasswordForEmail`

## Data Contracts Touched
- Reads:
  - auth user/profile via outlet context (`adminAccess`)
  - local storage key `socialai-admin-settings`
- Writes:
  - local storage preferences only
  - Supabase auth password reset email trigger
- Realtime:
  - none

## Inbound Dependencies
- Opened from admin sidebar and profile-menu navigation.
- Uses role/scope context from `AdminLayout` outlet.

## Outbound Dependencies
- No route-level outbound links.
- Security tab triggers password reset email delivery flow.

## Current Working Relationships
- Tab state is URL-addressable (`?tab=...`) for shareable deep links.
- Preference toggles persist per browser/device.
- Password reset action reuses existing Supabase auth flow.

## Missing or Partial Relationships
- Preferences do not drive actual behavior in notification center, logs, or table pagination.
- Avatar upload and 2FA controls are placeholders (UI only, backend not wired).
- No active-session management implementation.

## No Relation Exists Yet
- No relation between notification-type toggles and backend notification delivery/filtering.
- No relation between theme selection and a global admin theming contract beyond local preference.

## Recommended Wiring Contract
- Add persistent admin settings contract (table or profile metadata) with RLS.
- Apply settings to:
  - notification-center default filters
  - list page default page size
  - realtime subscription preference behavior
- Replace placeholder controls with capability checks and explicit unavailable states.

## Risks If Wired Incorrectly
- Local-only preferences create cross-device inconsistency for on-call operators.
- Persisting arbitrary preference blobs without schema validation can break clients.
- Security controls shown as available before backend enforcement can create false trust.
