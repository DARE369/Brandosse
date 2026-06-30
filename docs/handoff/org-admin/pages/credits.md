# Org Admin Page: Credit Management

## Page Purpose (Plain Language)
This page shows the organization credit pool, how much has been used, and which member requests are still pending.

## Route and Access Rules
- Route: `/app/org/:orgId/admin/credits`
- Guard: `OrgAdminRoute`

## Component Composition
- Container: `src/org/admin/CreditManagementPage.jsx`
- Key blocks:
  - three summary stat cards
  - credit-request table
  - empty-state fallback

## State, Hooks, Services Used
- `useOrgContext` for org metadata.
- `useOrgCredits` for pool/usage/requests.
- `useOrgCredits` depends on `fetchCreditRequests` in `creditService`.

## Data Contracts Touched
- Reads:
  - `organizations.monthly_credit_pool`
  - `organizations.credits_used_this_period`
  - `credit_requests`
- Writes currently in page:
  - none
- Related available backend write path (not wired in page):
  - `credit-request-action` edge function

## Inbound Dependencies
- Admin sidebar `Credit Management`.
- Top-navbar credit pill also links to this page.

## Outbound Dependencies
- None directly from current UI actions.
- Intended dependency: approved/partial requests should update member credit limits and notify requesters.

## Current Working Relationships
- Summary metrics and request listing load correctly.
- Pending count is derived from live request status values.

## Missing or Partial Relationships
- No approve/deny/partial controls despite deployed `credit-request-action`.
- Request row does not resolve requester profile names (shows raw `requested_by` id).
- No explicit display of amount approved, reviewer, reviewed timestamp.

## No Relation Exists Yet
- No relation to `credit_events` history from this page.
- No relation between approvals and immediate UI refresh of effective member limits.

## Recommended Wiring Contract
- Add row actions:
  - approve
  - deny
  - partial approve
- Use `credit-request-action` as canonical mutation endpoint.
- Extend table columns to include reviewer and post-review details, plus optimistic refresh.

## Risks If Wired Incorrectly
- Direct table writes that bypass edge function will skip notification and permission-limit update logic.
- Incorrect approval math can inflate member limits beyond intended governance.

