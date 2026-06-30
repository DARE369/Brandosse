# Org Admin Page: Brand Kit

## Page Purpose (Plain Language)
This page defines brand rules for a brand project so team outputs stay on-brand across voice, messaging, hashtags, visual identity, and approved brand assets.

## Route and Access Rules
- Route: `/app/org/:orgId/admin/brand-kit`
- Router behavior:
  - This route is not wrapped in `OrgAdminRoute`.
  - Membership is still required by `OrgMemberRoute` at org-shell level.
- In-page edit gate:
  - `canEdit = isOrgAdmin || org_brand_kit_editor`
  - Admins can also manage editor assignments.

## Component Composition
- Container: `src/org/admin/BrandKitPage.jsx`
- Key composition:
  - Identity, Voice, Guidance, Visual sections with edit/save states
  - `EditorAccessCard` for admin-managed editor grants
  - Asset previews and library jump links

## State, Hooks, Services Used
- `useOrgContext` for org and active brand project scope.
- `useAuth` for current user id.
- Service calls:
  - `fetchOrgBrandKit`
  - `upsertOrgBrandKit`
  - `syncOrgBrandKitEditors`
  - `fetchOrganizationMembers`
  - `fetchOrgAssets`
- Local state:
  - `brandKit`, `draft`, `editingSection`, `savingSection`
  - editor membership selection state

## Data Contracts Touched
- Reads:
  - `org_brand_kits`
  - `org_brand_kit_editors`
  - `organization_members`
  - `profiles`
  - `org_asset_library`
- Writes:
  - `org_brand_kits` via `org-brand-kit-upsert` edge function
  - `org_brand_kit_editors` via direct table writes
  - `brand_projects.brand_settings` mirror update via edge function

## Inbound Dependencies
- Admin sidebar links this route for org-admin users.
- Non-admin editor access currently depends on direct URL/navigation (no dedicated sidebar entry).
- Active brand project context controls which brand kit row is loaded.

## Outbound Dependencies
- Links to `/app/org/:orgId/library` for asset management.
- Feeds downstream generation guidance through persisted brand-kit fields and mirrored brand settings.

## Current Working Relationships
- Section saves are scoped and persisted incrementally.
- Completeness score and AI prompt composition are computed in DB trigger logic.
- Admins can delegate edit rights to non-admin members through `org_brand_kit_editors`.

## Missing or Partial Relationships
- Route-level access and navigation do not fully reflect editor entitlement:
  - Backend/page allow editors, but admin sidebar entry is admin-only.
- No explicit server-side validation in the edge function that selected logo asset ids belong to the same organization/project scope.
- No version history/diff timeline for brand-kit changes.

## No Relation Exists Yet
- No explicit relation from brand-kit updates to a change-event feed in org admin.
- No explicit relation from brand-kit saves to regeneration prompts or pipeline revalidation prompts in UI.

## Recommended Wiring Contract
- Make route entitlement explicit:
  - either wrap route in a new `OrgBrandKitEditorRoute`
  - or keep member route and add centralized `canAccessBrandKit` checks + non-admin sidebar entry.
- Add asset ownership validation in `org-brand-kit-upsert` for logo fields.
- Add `org_brand_kit_change_events` (or audit metadata) for versioned traceability.

## Risks If Wired Incorrectly
- Granting editor access in backend without discoverable UI entry creates hidden capability and support confusion.
- Missing asset ownership checks can allow cross-project references and broken branding context.
- Unversioned overwrite behavior can silently lose critical brand policy edits.

