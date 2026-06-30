# Platform Admin Page: Moderation

## Page Purpose (Plain Language)
This page is the unified moderation queue for reviewing, editing, scheduling, force publishing, archiving, deletion requests, and regeneration workflows across users.

## Route and Access Rules
- Route: `/app/admin/moderation`
- Alias: `/app/admin/content/review` redirects here.
- Parent guard: `<ProtectedRoute requireAdmin>`
- In-page scope:
  - super admin sees cross-org queue.
  - org admin is scoped by accessible users/org.

## Component Composition
- Route wrapper: `AdminModerationPage`
- Main workspace: `AdminModerationWorkspace`
- Major in-page modules:
  - queue list with grouping/date buckets
  - detail drawer (`view` / `edit`)
  - quality panel
  - force action modal
  - delete/archive modal
  - regeneration workspace

## State, Hooks, Services Used
- React Query:
  - `fetchAdminPostsPage`
  - `fetchModerationFilterOptions`
  - `fetchConnectedAccountsForUser`
  - `fetchQualityReviewDetail`
- Local state:
  - filters, pagination, selected rows
  - active item, drawer mode, edit draft
  - modal state and busy action state
  - regeneration state/result
- Main moderation service calls (`moderationApi`):
  - `saveModerationEdits`
  - `forceModerationAction`
  - `markItemsApproved`
  - `archiveItems`
  - `submitDeletionRequests`
  - `rescoreModerationItem`
  - `runRegenerationRequest`
  - `promoteGeneratedVersion`
  - `analyzeUploadedMedia`

## Data Contracts Touched
- Tables read:
  - `profiles`, `posts`, `generations`, `content_quality_reviews`
  - `organizations`, `admin_roles`, `connected_accounts`, `media_assets`
- Tables written:
  - `posts`
  - `content_quality_reviews`
  - `content_library_items` (upsert for ensured posts)
  - `admin_action_requests` (org-admin deletion requests)
  - `audit_logs` through `insertAuditLog`
- Edge functions:
  - `admin-list-posts` (primary list API)
  - optional paths: `admin-regenerate-post`, `admin-analyze-media`, `admin-promote-content-version`
- Realtime:
  - channels on `posts` and `generations` invalidate moderation query.

## Inbound Dependencies
- Complaint detail page links here with query params (`post`/`generation`).
- User detail `posts` tab embeds this workspace in scoped mode.
- User calendar can route into moderation with selected post.

## Outbound Dependencies
- View user action routes to `/app/admin/users/:userId`.
- Actions write to downstream audit and admin action request workflows.

## Current Working Relationships
- Primary list is edge-function driven with fallback direct query path when function is unavailable.
- Queue actions enforce readiness checks before force publish/schedule.
- Regeneration flow can ensure post existence before invoking regeneration.
- Query params (`post`, `generation`) open matching item when loaded.

## Missing or Partial Relationships
- Reviewer assignment is disabled and intentionally not wired.
- Optional edge functions can be missing in environment; UI shows fallback/deploy messages.
- No explicit link from moderation item to complaint case history even when related.

## No Relation Exists Yet
- No relation to pipeline/task ownership model for review assignment and SLA.
- No relation to a canonical "approval execution" page for `admin_action_requests`.

## Recommended Wiring Contract
- Add moderation capability handshake at startup:
  - discover deployed edge functions
  - disable unavailable actions proactively.
- Add reviewer ownership field and audit contract before enabling assignment control.
- Add complaint reference chip when post/generation is linked to complaint records.

## Risks If Wired Incorrectly
- Force actions without strict readiness and scope validation can publish wrong content/accounts.
- Missing idempotency in repeated action retries can create duplicate post rows or inconsistent states.
- Partial deployment of optional functions without capability gating degrades operator trust.
