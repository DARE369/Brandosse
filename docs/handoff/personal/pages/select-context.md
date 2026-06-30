# Page: `/select-context`

## Page Purpose (Plain Language)
This page lets users choose whether to work in their personal workspace or one of their organization workspaces.

## Route and Access Rules
- Route: `/select-context`
- Access: protected (`ProtectedRoute` required).
- Auto-redirect rules:
  - admin user -> `/app/admin`
  - no org memberships -> `/app/dashboard`.

## Component Composition
- `src/pages/ContextSelector/ContextSelectorPage.jsx`
- Uses reusable `ContextCard` UI for personal and org options.

## State, Hooks, Services
- Auth context inputs:
  - `user`, `profile`, `isAdmin`, `orgMemberships`, `lastUsedContext`
- Service call:
  - `updateLastUsedContext` from `orgService`.
- Navigation helper:
  - `getOrganizationHomePath`.

## Data Contracts Touched
- Table:
  - `context_last_used` (upsert/update)
- Realtime channels: none.

## Inbound Dependencies
- Auth redirect logic routes users here when they have active org memberships and no stronger redirect target.

## Outbound Dependencies
- Personal selection -> `/app/dashboard`
- Org selection -> `/app/org/:orgId/(overview|workspace)` based on role.

## Current Working Relationships
- Properly records selected workspace context before navigating.
- Uses auth-resolved membership list and role to compute org destination.

## Missing or Partial Relationships
- No explicit error surface if context update fails before navigation.
- No brand project selector even when user has multi-project org context.

## No Relation Exists Yet
- No relationship from this page into onboarding education for first-time org members.

## Recommended Wiring Contract
- Add optional post-selection payload:
  - selected brand project id
  - selection reason and timestamp.
- Handle update failures with user-visible fallback notification.

## Risks if Wired Incorrectly
- Incorrect context writes can cause future redirect loops or wrong default workspace.
- Adding project selection without server-side validation may violate membership scoping.
